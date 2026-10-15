import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StockService } from '../stock/stock.service';
import { requestContext, type SessionUser } from '../common/request-context';
import { dateStr } from '../common/manila';
import { FranchiseArService } from './franchise-ar.service';

const peso = (x: unknown) => `₱${Number(x ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * DRs made for a franchise by the warehouse or a main branch (owner request 2026-10-15). The DR is connected to the franchise: it is told at once, checks the goods
 * and confirms receipt (the franchise's stock goes up then) or reports a problem, after which the Franchise Coordinator edits the DR and the franchise checks it again.
 * An unpaid DR also shows in Franchise AR as unpaid goods.
 */
@Injectable()
export class FranchiseDrService {
  constructor(private prisma: PrismaService, private audit: AuditService, private notify: NotificationsService, private stock: StockService, private ar: FranchiseArService) {}

  private headOffice(user: SessionUser) { return user.permissions.has('franchise.dr.view') && !user.permissions.has('franchise.dr.receive'); }

  /** Called when a franchise DR is saved: the receipt is waiting and everyone concerned is told. */
  async onSale(sale: { id: string; drSiNo: string; locationId: string; grandTotal: unknown; paymentMode: string; dueDate: Date | null }, franchiseLocationId: string, user: SessionUser) {
    await this.prisma.db.franchiseDrReceipt.create({ data: { salesDocId: sale.id, franchiseLocationId, fromLocationId: sale.locationId } });
    const from = await this.prisma.db.location.findUniqueOrThrow({ where: { id: sale.locationId }, select: { name: true } });
    const credit = sale.paymentMode === 'AR_PDC';
    await this.ar.tell(franchiseLocationId, { type: 'FRANCHISE_DR', title: `New DR ${sale.drSiNo} from ${from.name} for the franchise: ${peso(sale.grandTotal)}${credit ? `, on credit${sale.dueDate ? ` due ${dateStr(sale.dueDate)}` : ''}` : ''}`, body: 'The franchise checks the goods and confirms receipt (or reports a problem) under Franchise DRs.', link: '/franchise-drs' });
    await this.audit.log({ action: 'FRANCHISE_DR', entityType: 'SalesDoc', entityId: sale.id, after: { franchiseLocationId }, userId: user.id });
  }

  /** The DR was replaced by a corrected one: the old receipt is closed and the new one waits. */
  async onAmended(oldSaleId: string, newSale: { id: string; drSiNo: string; locationId: string; grandTotal: unknown; paymentMode: string; dueDate: Date | null }, franchiseLocationId: string, user: SessionUser) {
    await this.prisma.db.franchiseDrReceipt.updateMany({ where: { salesDocId: oldSaleId }, data: { status: 'SUPERSEDED' } });
    await this.onSale(newSale, franchiseLocationId, user);
    await this.ar.tell(franchiseLocationId, { type: 'FRANCHISE_DR_EDITED', title: `DR ${newSale.drSiNo} was corrected by ${user.fullName}: now ${peso(newSale.grandTotal)}. Please check the goods again and confirm.`, link: '/franchise-drs' });
  }

  private async rows(where: object, user: SessionUser) {
    const rs = await this.prisma.db.franchiseDrReceipt.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
    const docs = await requestContext.runSystem(async () => await this.prisma.db.salesDoc.findMany({ where: { id: { in: rs.map((r) => r.salesDocId) } }, include: { lines: { include: { product: { select: { name: true, sku: true } }, batch: { select: { flavor: true, expiryDate: true, batchNo: true } } } } } }));
    const locs = new Map((await this.prisma.db.location.findMany({ select: { id: true, name: true } })).map((l) => [l.id, l.name]));
    void user;
    return rs.map((r) => { const d = docs.find((x) => x.id === r.salesDocId); const lines = new Map<string, { product: string; sku: string; flavor: string | null; qty: number; unitPrice: number }>();
      for (const l of d?.lines ?? []) { if (l.qty <= 0) continue; const k = `${l.productId}|${l.batch.flavor ?? ''}|${l.unitPrice}`; const c = lines.get(k) ?? { product: l.product.name, sku: l.product.sku, flavor: l.batch.flavor ?? null, qty: 0, unitPrice: Number(l.unitPrice) }; c.qty += l.qty; lines.set(k, c); }
      return { id: r.id, saleId: r.salesDocId, drSiNo: d?.drSiNo ?? '', date: d ? dateStr(d.docDate) : '', status: r.status, franchise: locs.get(r.franchiseLocationId) ?? '', franchiseLocationId: r.franchiseLocationId, from: locs.get(r.fromLocationId) ?? '', total: Number(d?.grandTotal ?? 0), paymentMode: d?.paymentMode ?? '', dueDate: d?.dueDate ? dateStr(d.dueDate) : null, voided: !!d?.voidedAt,
        receivedByName: r.receivedByName, receivedAt: r.receivedAt, disputeNote: r.disputeNote, lines: [...lines.values()] }; });
  }

  async list(user: SessionUser, q: { status?: string }) {
    if (!user.permissions.has('franchise.dr.view')) throw new ForbiddenException();
    const own = user.roleKey.startsWith('FRANCHISE_') && user.roleKey !== 'FRANCHISE_COORDINATOR' && user.roleKey !== 'ASST_FRANCHISE_COORDINATOR' ? { franchiseLocationId: { in: user.locationIds } } : {};
    const rs = await this.rows({ ...own, status: q.status ? q.status : { not: 'SUPERSEDED' } }, user);
    return rs.filter((r) => !r.voided);
  }

  /** The franchise confirms the goods: its stock goes up by what the DR sent (the same batches, flavors and costs). */
  async receive(user: SessionUser, id: string) {
    const r = await this.prisma.db.franchiseDrReceipt.findUnique({ where: { id } }); if (!r) throw new NotFoundException();
    if (!user.permissions.has('franchise.dr.receive') || !user.locationIds.includes(r.franchiseLocationId)) throw new ForbiddenException('Only the franchise that the DR is for confirms its receipt');
    if (!['PENDING', 'DISPUTED'].includes(r.status)) throw new BadRequestException('This DR has already been handled');
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: r.franchiseLocationId }, select: { franchiseAssociateReceives: true, franchiseOwnerUserId: true, name: true } });
    if (user.roleKey === 'FRANCHISE_SALES_ASSOCIATE' && !loc.franchiseAssociateReceives) throw new ForbiddenException('Your franchise owner receives the stock; ask them to confirm this DR');
    const doc = await requestContext.runSystem(async () => await this.prisma.db.salesDoc.findUniqueOrThrow({ where: { id: r.salesDocId } }));
    if (doc.voidedAt) throw new BadRequestException('This DR was voided');
    const out = await requestContext.runSystem(async () => this.prisma.db.$transaction(async (tx) => {
      const rows = await tx.stockLedger.findMany({ where: { documentType: 'SalesDoc', documentId: doc.id, qtyDelta: { lt: 0 }, movementType: { in: ['SALE', 'FREEBIE_ISSUE'] } } });
      await this.stock.post(tx, rows.map((x) => ({ locationId: r.franchiseLocationId, productId: x.productId, batchId: x.batchId, qtyDelta: -x.qtyDelta, movementType: 'TRANSFER_IN' as const, documentType: 'FranchiseDr', documentId: r.id, unitCost: x.unitCost, createdBy: user.id })));
      return tx.franchiseDrReceipt.update({ where: { id }, data: { status: 'RECEIVED', receivedBy: user.id, receivedByName: user.fullName, receivedAt: new Date(), disputeNote: null } });
    }));
    await this.audit.log({ action: 'FRANCHISE_DR_RECEIVED', entityType: 'SalesDoc', entityId: doc.id, after: { by: user.fullName } });
    await this.ar.tell(r.franchiseLocationId, { type: 'FRANCHISE_DR_RECEIVED', title: `${loc.name} received DR ${doc.drSiNo} (${user.fullName})`, link: '/franchise-drs' }, [doc.preparedBy]);
    return out;
  }

  /** The franchise reports that the goods do not match the DR: the coordinators are told and edit the DR. */
  async dispute(user: SessionUser, id: string, note: string) {
    const r = await this.prisma.db.franchiseDrReceipt.findUnique({ where: { id } }); if (!r) throw new NotFoundException();
    if (!user.permissions.has('franchise.dr.receive') || !user.locationIds.includes(r.franchiseLocationId)) throw new ForbiddenException();
    if (r.status !== 'PENDING') throw new BadRequestException('Only a DR waiting for the franchise can be reported');
    if (!note?.trim() || note.trim().length < 3) throw new BadRequestException('Say what is wrong (item, quantity, flavor …)');
    const doc = await requestContext.runSystem(async () => await this.prisma.db.salesDoc.findUniqueOrThrow({ where: { id: r.salesDocId } }));
    await this.prisma.db.franchiseDrReceipt.update({ where: { id }, data: { status: 'DISPUTED', disputeNote: note.trim(), disputedBy: user.id, disputedAt: new Date() } });
    await this.ar.tell(r.franchiseLocationId, { type: 'FRANCHISE_DR_PROBLEM', title: `${user.fullName} reports a problem on DR ${doc.drSiNo}: ${note.trim()}`, body: 'The Franchise Coordinator edits the DR; the franchise then checks it again.', link: '/franchise-drs' }, [doc.preparedBy]);
    await this.audit.log({ action: 'FRANCHISE_DR_PROBLEM', entityType: 'SalesDoc', entityId: doc.id, after: { note } });
    return { id };
  }

  /** The receipt of a DR (for the DR page): where it stands. */
  async forSale(saleId: string) {
    const r = await this.prisma.db.franchiseDrReceipt.findUnique({ where: { salesDocId: saleId } });
    return r ? { id: r.id, status: r.status, receivedByName: r.receivedByName, receivedAt: r.receivedAt, disputeNote: r.disputeNote } : null;
  }

  async assertEditable(saleId: string) {
    const r = await this.prisma.db.franchiseDrReceipt.findUnique({ where: { salesDocId: saleId } });
    if (r?.status === 'RECEIVED') throw new BadRequestException('The franchise has already received this DR and its stock went up. Ask the franchise to report the problem first, or make a return / transfer for the difference.');
  }
}
