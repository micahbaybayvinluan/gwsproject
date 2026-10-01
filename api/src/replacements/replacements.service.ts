import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { SequenceService } from '../common/sequence.service';
import { StockService } from '../stock/stock.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../common/audit.service';
import { MasterService } from '../master/master.service';
import { ReceivingService } from '../receiving/receiving.service';
import { dateStr, daysBetween, todayManila } from '../common/manila';
import { D, round2 } from '../common/money';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';
import type { RoleKey } from '../common/permissions';

/** Everyone who is told of every replacement ticket: the auditors, Accounting and the Owner (the sales associate involved and the branch are added per ticket). */
export const REPLACEMENT_ROLES: RoleKey[] = ['ADMIN', 'HEAD_AUDITOR', 'ASST_AUDITOR', 'AUDIT_ASSOCIATE', 'ACCOUNTING_HEAD', 'ACCOUNTING_ASSOCIATE'];
/** A customer return is expected to be replaced within this many days of the DR; later ones are flagged. */
export const REPLACEMENT_WINDOW_DAYS = 30;
const REMIND_CUSTOMER_AFTER = 3; const REMIND_SUPPLIER_AFTER = 7;
const REASONS = ['DAMAGED', 'DEFECTIVE', 'WRONG_ITEM', 'EXPIRED', 'OTHER'] as const;

const peso = (x: Prisma.Decimal.Value) => `₱${D(x).toNumber().toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Replacement tickets (owner request 2026-10-02).
 * CUSTOMER ticket: a customer returned an item to a branch; the ticket names the DR / SI it was sold on. Any branch except a franchise ticks it when it hands the replacement (same or
 *   another product; the price difference against the DR is worked out), the Head Auditor approves, then it is closed. The auditors, Accounting, the Owner and the sales associate
 *   of the DR are told at every step.
 * SUPPLIER ticket: items we return to a supplier. The Head Auditor approves the return (stock leaves); the ticket stays open, tagged to the supplier, until replacement items arrive
 *   on a supplier delivery linked to it. Only that arrival closes it.
 */
@Injectable()
export class ReplacementsService implements OnModuleInit {
  constructor(private prisma: PrismaService, private seq: SequenceService, private stock: StockService, private approvals: ApprovalsService, private notify: NotificationsService, private audit: AuditService, private master: MasterService, private receiving: ReceivingService) {}

  onModuleInit() {
    this.approvals.register('REPLACEMENT_TICKET', (r, outcome, actor) => this.onReplacementDecision(r.documentId, outcome, actor?.id ?? null, actor?.note), 'ReplacementTicket');
    this.approvals.register('SUPPLIER_RETURN', (r, outcome, actor) => this.onSupplierReturnDecision(r.documentId, outcome, actor?.id ?? null, actor?.note), 'ReplacementTicket');
    this.receiving.onPosted((docId) => this.onReceivingPosted(docId));
  }

  private link(id: string) { return `/replacements/${id}`; }
  private async tell(n: { type: string; title: string; body?: string; link?: string }, extraUserIds: (string | null | undefined)[] = []) {
    await this.notify.toRoles(REPLACEMENT_ROLES, n);
    const ids = [...new Set(extraUserIds.filter((x): x is string => !!x))]; if (ids.length) await this.notify.toUsers(ids, n);
  }
  /** The people a customer ticket concerns: who opened it, who replaced it, and the sales associate who made the DR. */
  private async involved(t: { createdBy: string; replacedBy?: string | null; salesDocId?: string | null }, ...more: (string | null | undefined)[]) {
    const doc = t.salesDocId ? await this.prisma.db.salesDoc.findUnique({ where: { id: t.salesDocId }, select: { preparedBy: true } }) : null;
    return [t.createdBy, t.replacedBy, doc?.preparedBy, ...more];
  }
  private assertCan(user: SessionUser) {
    if (user.roleKey.startsWith('FRANCHISE')) throw new ForbiddenException('Franchises do not use replacement tickets; a franchise returns goods through the Franchise Coordinator');
    if (!user.permissions.has('replacement.create')) throw new ForbiddenException('You are not allowed to open or tick replacement tickets');
  }
  private async whereAt(user: SessionUser, requested?: string | null) {
    const id = user.locationScoped ? user.locationIds[0] : requested; if (!id) throw new BadRequestException('Choose the branch');
    if (user.locationScoped && requested && !user.locationIds.includes(requested)) throw new ForbiddenException('Outside your branch');
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id } });
    if (loc.type === 'FRANCHISE' || loc.type === 'VIRTUAL' || loc.type === 'CONSIGNEE') throw new BadRequestException('Choose a GWS branch or the warehouse');
    return loc;
  }

  // ── finding the DR ──
  /** The DR / SI the customer bought on: found across every branch (never a franchise's), with how much of each line can still be returned. */
  async findDr(q: string) {
    const text = q.trim(); if (text.length < 2) return [];
    return requestContext.runSystem(async () => {
      const docs = await this.prisma.db.salesDoc.findMany({ where: { voidedAt: null, location: { type: { not: 'FRANCHISE' } }, OR: [{ drSiNo: { contains: text, mode: 'insensitive' } }, { controlNo: { contains: text, mode: 'insensitive' } }, { customerName: { contains: text, mode: 'insensitive' } }, { customerPhone: { contains: text } }] }, include: { location: { select: { id: true, name: true } }, customer: { select: { name: true } }, lines: { include: { product: { select: { id: true, sku: true, name: true } } } } }, orderBy: { docDate: 'desc' }, take: 8 });
      const used = await this.prisma.db.replacementTicket.groupBy({ by: ['salesLineId'], where: { kind: 'CUSTOMER', status: { not: 'CANCELLED' }, salesLineId: { in: docs.flatMap((d) => d.lines.map((l) => l.id)) } }, _sum: { qty: true } });
      const prep = await this.prisma.db.user.findMany({ where: { id: { in: docs.map((d) => d.preparedBy) } }, select: { id: true, fullName: true } });
      return docs.map((d) => ({ id: d.id, controlNo: d.controlNo, drSiNo: d.drSiNo, date: dateStr(d.docDate), branch: d.location.name, customer: d.customer?.name ?? d.customerName ?? null, phone: d.customerPhone, preparedBy: prep.find((p) => p.id === d.preparedBy)?.fullName ?? null, outsideWindow: daysBetween(d.docDate, todayManila()) > REPLACEMENT_WINDOW_DAYS,
        lines: d.lines.filter((l) => !l.isFreebie || D(l.unitPrice).gt(0)).map((l) => ({ lineId: l.id, productId: l.productId, sku: l.product.sku, product: l.product.name, qty: l.qty, unitPrice: l.unitPrice, available: l.qty - (used.find((u) => u.salesLineId === l.id)?._sum.qty ?? 0) })) }));
    });
  }

  // ── customer ticket ──
  async createCustomer(user: SessionUser, input: { salesLineId: string; qty: number; reason: string; notes?: string; locationId?: string }) {
    this.assertCan(user);
    if (!REASONS.includes(input.reason as never)) throw new BadRequestException('Choose why the item came back');
    if (!Number.isInteger(input.qty) || input.qty <= 0) throw new BadRequestException('The quantity must be a whole number above 0');
    const loc = await this.whereAt(user, input.locationId);
    const out = await requestContext.runSystem(async () => {
      const line = await this.prisma.db.salesLine.findUnique({ where: { id: input.salesLineId }, include: { doc: { include: { location: { select: { id: true, name: true, type: true } }, customer: { select: { name: true } } } }, product: { select: { name: true } } } });
      if (!line || line.doc.voidedAt) throw new BadRequestException('That DR / SI line was not found (or the sale was voided)');
      if (line.doc.location.type === 'FRANCHISE') throw new BadRequestException('A franchise sale is handled by the franchise itself');
      const used = (await this.prisma.db.replacementTicket.aggregate({ where: { kind: 'CUSTOMER', status: { not: 'CANCELLED' }, salesLineId: line.id }, _sum: { qty: true } }))._sum.qty ?? 0;
      if (input.qty > line.qty - used) throw new BadRequestException(`Only ${line.qty - used} of ${line.product.name} on DR ${line.doc.drSiNo} can still be returned (${line.qty} sold, ${used} already on a ticket)`);
      const late = daysBetween(line.doc.docDate, todayManila()) > REPLACEMENT_WINDOW_DAYS;
      const t = await this.prisma.db.$transaction(async (tx) => {
        const ticketNo = await this.seq.form(tx, 'RT', loc.id);
        return tx.replacementTicket.create({ data: { ticketNo, kind: 'CUSTOMER', locationId: loc.id, productId: line.productId, batchId: line.batchId, qty: input.qty, unitValue: line.unitPrice, reason: input.reason, notes: input.notes, salesDocId: line.docId, salesLineId: line.id, drSiNo: line.doc.drSiNo, saleLocationId: line.doc.locationId, saleControlNo: line.doc.controlNo, saleTier: line.priceTier, customerName: line.doc.customer?.name ?? line.doc.customerName, customerPhone: line.doc.customerPhone, createdBy: user.id } });
      });
      return { t, line, late, saleBranch: line.doc.location.name, preparedBy: line.doc.preparedBy };
    });
    await this.audit.log({ action: 'CREATE', entityType: 'ReplacementTicket', entityId: out.t.id, after: out.t });
    await this.tell({ type: 'REPLACEMENT_OPENED', title: `Replacement ticket ${out.t.ticketNo}: ${input.qty} × ${out.line.product.name} returned at ${loc.name} (DR ${out.line.doc.drSiNo}, sold at ${out.saleBranch}, ${input.reason.toLowerCase().replace('_', ' ')})${out.late ? ` — OUTSIDE the ${REPLACEMENT_WINDOW_DAYS}-day window` : ''}`, body: 'Any branch (not a franchise) can tick it once the customer has been given the replacement.', link: this.link(out.t.id) }, [out.preparedBy, user.id]);
    // the other branches are told too, so any of them can replace it
    await this.notify.toRoles(['SALES_ASSOCIATE', 'WAREHOUSE_IN_CHARGE', 'WAREHOUSE_ASSOCIATE'], { type: 'REPLACEMENT_OPENED', title: `Replacement ticket ${out.t.ticketNo} is open: ${input.qty} × ${out.line.product.name} for the customer of DR ${out.line.doc.drSiNo}`, link: this.link(out.t.id) });
    return this.get(user, out.t.id);
  }

  /** A branch ticks it: the replacement is handed to the customer (same or another product). The price difference against the DR is worked out; the Head Auditor approves. */
  async replace(user: SessionUser, id: string, input: { productId?: string; qty?: number; unitPrice?: number; note?: string; locationId?: string }) {
    this.assertCan(user);
    const loc = await this.whereAt(user, input.locationId);
    const t = await requestContext.runSystem(() => this.prisma.db.replacementTicket.findUnique({ where: { id } }));
    if (!t || t.kind !== 'CUSTOMER') throw new NotFoundException();
    if (t.status !== 'OPEN') throw new BadRequestException(t.status === 'REPLACED' ? 'This ticket was already ticked and waits for the Head Auditor' : 'This ticket is no longer open');
    const productId = input.productId ?? t.productId; const qty = input.qty ?? t.qty;
    if (!Number.isInteger(qty) || qty <= 0) throw new BadRequestException('The replacement quantity must be a whole number above 0');
    const price = input.unitPrice != null ? D(input.unitPrice) : await this.master.priceFor(productId, t.saleTier && !['AGENT'].includes(t.saleTier) ? t.saleTier : 'RETAIL', todayManila());
    if (price == null) throw new BadRequestException('That product has no price in the list; type the price');
    const product = await this.prisma.db.product.findUniqueOrThrow({ where: { id: productId }, select: { name: true } });
    const replacementValue = round2(price.mul(qty)); const returnedValue = round2(D(t.unitValue).mul(t.qty));
    const diff = replacementValue.minus(returnedValue);
    await requestContext.runSystem(async () => {
      await this.prisma.db.$transaction(async (tx) => {
        const picks = await this.stock.pickFefo(tx, loc.id, productId, qty);
        await this.stock.post(tx, picks.map((p) => ({ locationId: loc.id, productId, batchId: p.batchId, qtyDelta: -p.qty, movementType: 'REPLACEMENT_OUT' as const, documentType: 'ReplacementTicket', documentId: t.id, unitCost: p.unitCost, businessDate: todayManila(), createdBy: user.id })));
        await tx.replacementTicket.update({ where: { id }, data: { status: 'REPLACED', replacedAt: new Date(), replacedBy: user.id, replacedLocationId: loc.id, replacementProductId: productId, replacementQty: qty, replacementUnitPrice: price.toFixed(2), replacementPicks: picks.map((p) => ({ batchId: p.batchId, qty: p.qty, unitCost: p.unitCost.toString() })) as unknown as Prisma.InputJsonValue, priceDifference: diff.toFixed(2), differenceNote: input.note ?? null } });
      });
      const req = await this.approvals.request({ type: 'REPLACEMENT_TICKET', documentType: 'ReplacementTicket', documentId: id, requestedBy: user.id, summary: { controlNo: t.ticketNo, locationId: loc.id, locationName: `${loc.name} · DR ${t.drSiNo}`, customer: t.customerName, total: diff.toFixed(2), step: `Approve = the replacement (${qty} × ${product.name}) closes the ticket. ${diff.gt(0) ? `Customer pays ${peso(diff)}` : diff.lt(0) ? `Customer is refunded / credited ${peso(diff.abs())}` : 'No price difference'}.` } });
      await this.prisma.db.replacementTicket.update({ where: { id }, data: { approvalRequestId: req.id } });
    });
    await this.audit.log({ action: 'REPLACE', entityType: 'ReplacementTicket', entityId: id, after: { productId, qty, price: price.toFixed(2), difference: diff.toFixed(2), at: loc.id } });
    await this.tell({ type: 'REPLACEMENT_DONE', title: `${t.ticketNo} (DR ${t.drSiNo}) replaced at ${loc.name} by ${user.fullName}: ${qty} × ${product.name}. ${diff.gt(0) ? `Price difference ${peso(diff)} to be paid by the customer` : diff.lt(0) ? `Price difference ${peso(diff.abs())} to be refunded / credited to the customer` : 'No price difference'}`, body: 'The Head Auditor approves it in My Approvals.', link: this.link(id) }, await this.involved(t, user.id));
    return this.get(user, id);
  }

  private async onReplacementDecision(id: string, outcome: 'APPROVED' | 'REJECTED', actorId: string | null, note?: string) {
    await requestContext.runSystem(async () => {
      const t = await this.prisma.db.replacementTicket.findUniqueOrThrow({ where: { id } });
      if (t.status !== 'REPLACED') return;
      if (outcome === 'APPROVED') {
        await this.prisma.db.replacementTicket.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date() } });
        await this.tell({ type: 'REPLACEMENT_CLOSED', title: `${t.ticketNo} (DR ${t.drSiNo}) approved by the Head Auditor and closed`, link: this.link(id) }, await this.involved(t));
        return;
      }
      // not approved: the replacement stock goes back and the ticket is open again
      const picks = (t.replacementPicks as unknown as { batchId: string; qty: number; unitCost: string }[] | null) ?? [];
      await this.prisma.db.$transaction(async (tx) => {
        if (t.replacedLocationId && t.replacementProductId) await this.stock.post(tx, picks.map((p) => ({ locationId: t.replacedLocationId!, productId: t.replacementProductId!, batchId: p.batchId, qtyDelta: p.qty, movementType: 'ADJUST_COUNT' as const, documentType: 'ReplacementTicket', documentId: t.id, unitCost: p.unitCost, businessDate: todayManila(), createdBy: actorId ?? undefined })));
        await tx.replacementTicket.update({ where: { id }, data: { status: 'OPEN', replacedAt: null, replacedBy: null, replacedLocationId: null, replacementProductId: null, replacementQty: null, replacementUnitPrice: null, replacementPicks: Prisma.DbNull, priceDifference: null, differenceNote: null, approvalRequestId: null } });
      });
      await this.tell({ type: 'REPLACEMENT_REJECTED', title: `The Head Auditor did not approve the replacement on ${t.ticketNo} (DR ${t.drSiNo})${note ? `: ${note}` : ''}. The stock was put back and the ticket is open again.`, link: this.link(id) }, await this.involved(t));
    });
  }

  /** The branch confirms the price difference was collected from / refunded to the customer. Accounting is told. */
  async settle(user: SessionUser, id: string, input: { note?: string }) {
    const t = await requestContext.runSystem(() => this.prisma.db.replacementTicket.findUnique({ where: { id } }));
    if (!t || t.kind !== 'CUSTOMER') throw new NotFoundException();
    if (!['REPLACED', 'CLOSED'].includes(t.status) || !t.priceDifference || D(t.priceDifference).isZero()) throw new BadRequestException('There is no price difference to settle');
    if (t.differenceSettledAt) throw new BadRequestException('Already settled');
    const allowed = user.permissions.has('replacement.view') || (user.permissions.has('replacement.create') && (!user.locationScoped || user.locationIds.includes(t.replacedLocationId ?? '')));
    if (!allowed) throw new ForbiddenException('Only the branch that gave the replacement (or the auditors / Accounting) confirms this');
    await requestContext.runSystem(() => this.prisma.db.replacementTicket.update({ where: { id }, data: { differenceSettledAt: new Date(), differenceSettledBy: user.id, differenceNote: input.note ?? t.differenceNote } }));
    await this.audit.log({ action: 'SETTLE_DIFFERENCE', entityType: 'ReplacementTicket', entityId: id, after: { by: user.id, note: input.note } });
    const d = D(t.priceDifference);
    await this.tell({ type: 'REPLACEMENT_SETTLED', title: `${t.ticketNo}: the price difference ${peso(d.abs())} was ${d.gt(0) ? 'collected from' : 'refunded / credited to'} the customer (confirmed by ${user.fullName})`, link: this.link(id) }, await this.involved(t));
    return this.get(user, id);
  }

  // ── supplier ticket ──
  async createSupplier(user: SessionUser, input: { productId: string; qty: number; batchId?: string; supplierId?: string; reason: string; notes?: string; locationId?: string }) {
    this.assertCan(user);
    if (!REASONS.includes(input.reason as never)) throw new BadRequestException('Choose why the items go back');
    if (!Number.isInteger(input.qty) || input.qty <= 0) throw new BadRequestException('The quantity must be a whole number above 0');
    const loc = await this.whereAt(user, input.locationId);
    const t = await requestContext.runSystem(async () => {
      const product = await this.prisma.db.product.findUniqueOrThrow({ where: { id: input.productId }, select: { name: true, supplierId: true } });
      const supplierId = input.supplierId ?? product.supplierId; if (!supplierId) throw new BadRequestException('Choose the supplier that must replace this item');
      await this.prisma.db.supplier.findUniqueOrThrow({ where: { id: supplierId } });
      const have = (await this.prisma.db.stockBalance.aggregate({ where: { locationId: loc.id, productId: input.productId, batchId: input.batchId }, _sum: { qty: true } }))._sum.qty ?? 0;
      if (have < input.qty) throw new BadRequestException(`${loc.name} has only ${have} of ${product.name}${input.batchId ? ' in that batch' : ''}`);
      const cost = await this.master.costFor(input.productId);
      const created = await this.prisma.db.$transaction(async (tx) => {
        const ticketNo = await this.seq.form(tx, 'RT', loc.id);
        return tx.replacementTicket.create({ data: { ticketNo, kind: 'SUPPLIER', status: 'PENDING_RETURN', locationId: loc.id, productId: input.productId, batchId: input.batchId ?? null, qty: input.qty, unitValue: cost?.toFixed(2) ?? '0', reason: input.reason, notes: input.notes, supplierId, createdBy: user.id } });
      });
      const sup = await this.prisma.db.supplier.findUniqueOrThrow({ where: { id: supplierId }, select: { name: true, code: true } });
      const req = await this.approvals.request({ type: 'SUPPLIER_RETURN', documentType: 'ReplacementTicket', documentId: created.id, requestedBy: user.id, summary: { controlNo: created.ticketNo, locationId: loc.id, locationName: `${loc.name} → supplier ${sup.code}`, lines: 1, units: input.qty, step: `Approve = ${input.qty} × ${product.name} leaves ${loc.name} for the supplier; the ticket stays open until the replacement arrives` } });
      await this.prisma.db.replacementTicket.update({ where: { id: created.id }, data: { approvalRequestId: req.id } });
      return { created, product, sup };
    });
    await this.audit.log({ action: 'CREATE', entityType: 'ReplacementTicket', entityId: t.created.id, after: t.created });
    await this.tell({ type: 'SUPPLIER_RETURN_OPENED', title: `Return-to-supplier ticket ${t.created.ticketNo}: ${input.qty} × ${t.product.name} from ${loc.name} to ${user.permissions.has('supplier.view.name') ? t.sup.name : t.sup.code} (${input.reason.toLowerCase().replace('_', ' ')})`, body: 'The Head Auditor approves the return; the ticket closes only when replacement items arrive.', link: this.link(t.created.id) }, [user.id]);
    return this.get(user, t.created.id);
  }

  private async onSupplierReturnDecision(id: string, outcome: 'APPROVED' | 'REJECTED', actorId: string | null, note?: string) {
    await requestContext.runSystem(async () => {
      const t = await this.prisma.db.replacementTicket.findUniqueOrThrow({ where: { id } });
      if (t.status !== 'PENDING_RETURN') return;
      if (outcome === 'REJECTED') {
        await this.prisma.db.replacementTicket.update({ where: { id }, data: { status: 'CANCELLED', closedAt: new Date(), closedNote: note ?? 'Not approved by the Head Auditor' } });
        await this.tell({ type: 'SUPPLIER_RETURN_REJECTED', title: `The Head Auditor did not approve the return ${t.ticketNo}${note ? `: ${note}` : ''}`, link: this.link(id) }, [t.createdBy]);
        return;
      }
      await this.prisma.db.$transaction(async (tx) => {
        const picks = await this.stock.pickFefo(tx, t.locationId, t.productId, t.qty, { preferBatchId: t.batchId ?? undefined, exactBatchId: t.batchId ?? undefined, allowExpired: true });
        await this.stock.post(tx, picks.map((p) => ({ locationId: t.locationId, productId: t.productId, batchId: p.batchId, qtyDelta: -p.qty, movementType: 'RETURN_TO_SUPPLIER' as const, documentType: 'ReplacementTicket', documentId: t.id, unitCost: p.unitCost, businessDate: todayManila(), createdBy: actorId ?? undefined })));
        await tx.replacementTicket.update({ where: { id }, data: { status: 'AWAITING_REPLACEMENT', sentAt: new Date() } });
      });
      await this.tell({ type: 'SUPPLIER_RETURN_APPROVED', title: `${t.ticketNo} approved: the items left for the supplier. The ticket stays open until the replacement items arrive.`, link: this.link(id) }, [t.createdBy]);
    });
  }

  /** A supplier delivery linked to a ticket was posted: the arrived items count; only enough arrival closes the ticket (the difference in value against what we sent is worked out). */
  private async onReceivingPosted(docId: string) {
    await requestContext.runSystem(async () => {
      const doc = await this.prisma.db.receivingDoc.findUnique({ where: { id: docId }, include: { lines: { include: { product: { select: { name: true } } } } } });
      if (!doc?.replacementTicketId) return;
      const t = await this.prisma.db.replacementTicket.findUnique({ where: { id: doc.replacementTicketId } });
      if (!t || !['AWAITING_REPLACEMENT', 'PARTIAL'].includes(t.status)) return;
      await this.prisma.db.$transaction(async (tx) => {
        for (const l of doc.lines) {
          const qty = l.qty + l.freeQty; if (qty <= 0) continue;
          await tx.replacementReceipt.upsert({ where: { ticketId_receivingDocId_productId: { ticketId: t.id, receivingDocId: doc.id, productId: l.productId } }, create: { ticketId: t.id, receivingDocId: doc.id, productId: l.productId, qty, unitCost: l.unitCost ?? 0 }, update: { qty } });
        }
        const all = await tx.replacementReceipt.findMany({ where: { ticketId: t.id } });
        const receivedQty = all.reduce((s, r) => s + r.qty, 0); const receivedValue = all.reduce((s, r) => s.plus(D(r.unitCost).mul(r.qty)), D(0));
        const closed = receivedQty >= t.qty;
        await tx.replacementTicket.update({ where: { id: t.id }, data: { receivedQty, receivedValue: receivedValue.toFixed(2), status: closed ? 'CLOSED' : 'PARTIAL', closedAt: closed ? new Date() : null, priceDifference: closed ? receivedValue.minus(D(t.unitValue).mul(t.qty)).toFixed(2) : null } });
      });
      const fresh = await this.prisma.db.replacementTicket.findUniqueOrThrow({ where: { id: t.id } });
      const sup = await this.prisma.db.supplier.findUnique({ where: { id: fresh.supplierId ?? '' }, select: { code: true } });
      const diff = fresh.priceDifference ? D(fresh.priceDifference) : null;
      await this.tell({ type: fresh.status === 'CLOSED' ? 'SUPPLIER_REPLACEMENT_CLOSED' : 'SUPPLIER_REPLACEMENT_PARTIAL', title: fresh.status === 'CLOSED' ? `${fresh.ticketNo} closed: replacement from ${sup?.code ?? 'the supplier'} arrived (${fresh.receivedQty} of ${fresh.qty}) on ${doc.controlNo}${diff && !diff.isZero() ? `. Value difference ${peso(diff.abs())} ${diff.gt(0) ? 'more than we sent (we owe the supplier)' : 'less than we sent (the supplier owes us)'}` : ''}` : `${fresh.ticketNo}: ${fresh.receivedQty} of ${fresh.qty} replacement items arrived on ${doc.controlNo}; the ticket stays open`, link: this.link(fresh.id) }, [fresh.createdBy]);
    });
  }

  async cancel(user: SessionUser, id: string, reason: string) {
    if (!reason || reason.trim().length < 3) throw new BadRequestException('Give the reason');
    const t = await requestContext.runSystem(() => this.prisma.db.replacementTicket.findUnique({ where: { id } }));
    if (!t) throw new NotFoundException();
    if (!(t.status === 'OPEN' || t.status === 'PENDING_RETURN')) throw new BadRequestException('Only a ticket that has not moved yet can be cancelled; a ticked or sent one is decided by the Head Auditor');
    if (!(user.roleKey === 'ADMIN' || user.permissions.has('approval.act.REPLACEMENT_TICKET') || t.createdBy === user.id)) throw new ForbiddenException('Only the person who opened it, the Head Auditor or the Owner can cancel it');
    await requestContext.runSystem(async () => { await this.approvals.cancelForDocument('ReplacementTicket', id); await this.prisma.db.replacementTicket.update({ where: { id }, data: { status: 'CANCELLED', closedAt: new Date(), closedNote: reason } }); });
    await this.audit.log({ action: 'CANCEL', entityType: 'ReplacementTicket', entityId: id, after: { reason } });
    await this.tell({ type: 'REPLACEMENT_CANCELLED', title: `${t.ticketNo} was cancelled by ${user.fullName}: ${reason}`, link: this.link(id) }, [t.createdBy]);
    return this.get(user, id);
  }

  // ── reading ──
  async list(user: SessionUser, q: { kind?: string; status?: string; supplierId?: string; open?: boolean }) {
    const scoped = user.locationScoped && !user.permissions.has('replacement.view');
    const where: Prisma.ReplacementTicketWhereInput = { kind: q.kind || undefined, supplierId: q.supplierId || undefined, status: q.status ? q.status : q.open ? { in: ['OPEN', 'REPLACED', 'PENDING_RETURN', 'AWAITING_REPLACEMENT', 'PARTIAL'] } : undefined };
    // any branch sees every open customer ticket (so any of them can replace it); supplier tickets belong to the branch that sent them
    if (scoped) where.AND = [{ OR: [{ kind: 'CUSTOMER', status: 'OPEN' }, { locationId: { in: user.locationIds } }, { replacedLocationId: { in: user.locationIds } }, { createdBy: user.id }] }];
    return requestContext.runSystem(async () => {
      const rows = await this.prisma.db.replacementTicket.findMany({ where, orderBy: [{ createdAt: 'desc' }], take: 300 });
      return this.decorate(rows, user);
    });
  }
  async get(user: SessionUser, id: string) {
    return requestContext.runSystem(async () => {
      const t = await this.prisma.db.replacementTicket.findUnique({ where: { id }, include: { receipts: true } });
      if (!t) throw new NotFoundException();
      if (user.locationScoped && !user.permissions.has('replacement.view') && !(t.kind === 'CUSTOMER' && t.status === 'OPEN') && !user.locationIds.includes(t.locationId) && !user.locationIds.includes(t.replacedLocationId ?? '') && t.createdBy !== user.id) throw new ForbiddenException();
      const [d] = await this.decorate([t], user);
      const recvDocs = await this.prisma.db.receivingDoc.findMany({ where: { id: { in: t.receipts.map((r) => r.receivingDocId) } }, select: { id: true, controlNo: true } });
      const prods = await this.prisma.db.product.findMany({ where: { id: { in: t.receipts.map((r) => r.productId) } }, select: { id: true, name: true } });
      return { ...d, receipts: t.receipts.map((r) => ({ receivingDocId: r.receivingDocId, controlNo: recvDocs.find((x) => x.id === r.receivingDocId)?.controlNo ?? '', product: prods.find((p) => p.id === r.productId)?.name ?? '', qty: r.qty, ...(user.permissions.has('cost.view') ? { unitCost: r.unitCost } : {}) })) };
    });
  }
  private async decorate(rows: Prisma.ReplacementTicketGetPayload<object>[], user: SessionUser) {
    const ids = (f: (r: (typeof rows)[number]) => (string | null)[]) => [...new Set(rows.flatMap(f).filter((x): x is string => !!x))];
    const [products, locs, users, suppliers] = await Promise.all([
      this.prisma.db.product.findMany({ where: { id: { in: ids((r) => [r.productId, r.replacementProductId]) } }, select: { id: true, sku: true, name: true } }),
      this.prisma.db.location.findMany({ where: { id: { in: ids((r) => [r.locationId, r.replacedLocationId, r.saleLocationId]) } }, select: { id: true, name: true } }),
      this.prisma.db.user.findMany({ where: { id: { in: ids((r) => [r.createdBy, r.replacedBy]) } }, select: { id: true, fullName: true } }),
      this.prisma.db.supplier.findMany({ where: { id: { in: ids((r) => [r.supplierId]) } }, select: { id: true, code: true, name: true } }),
    ]);
    const canCost = user.permissions.has('cost.view'); const canSupName = user.permissions.has('supplier.view.name');
    const today = todayManila();
    return rows.map((r) => ({
      id: r.id, ticketNo: r.ticketNo, kind: r.kind, status: r.status, reason: r.reason, notes: r.notes, qty: r.qty,
      product: products.find((p) => p.id === r.productId) ?? null, location: locs.find((l) => l.id === r.locationId)?.name ?? '', createdBy: users.find((u) => u.id === r.createdBy)?.fullName ?? '', createdAt: r.createdAt, ageDays: r.closedAt ? daysBetween(r.createdAt, r.closedAt) : daysBetween(r.createdAt, today),
      drSiNo: r.drSiNo, salesDocId: r.salesDocId, saleControlNo: r.saleControlNo, saleBranch: locs.find((l) => l.id === r.saleLocationId)?.name ?? null, customerName: r.customerName, customerPhone: r.customerPhone, unitPaid: r.kind === 'CUSTOMER' ? r.unitValue : undefined,
      replaced: r.replacedAt ? { at: r.replacedAt, by: users.find((u) => u.id === r.replacedBy)?.fullName ?? '', branch: locs.find((l) => l.id === r.replacedLocationId)?.name ?? '', product: products.find((p) => p.id === r.replacementProductId) ?? null, qty: r.replacementQty, unitPrice: r.replacementUnitPrice } : null,
      priceDifference: r.priceDifference, differenceSettledAt: r.differenceSettledAt, differenceNote: r.differenceNote,
      supplier: r.supplierId ? { id: r.supplierId, code: suppliers.find((s) => s.id === r.supplierId)?.code ?? '', name: canSupName ? suppliers.find((s) => s.id === r.supplierId)?.name ?? '' : null } : null,
      sentAt: r.sentAt, receivedQty: r.receivedQty, closedAt: r.closedAt, closedNote: r.closedNote, ...(canCost && r.kind === 'SUPPLIER' ? { unitCost: r.unitValue, receivedValue: r.receivedValue } : {}),
    }));
  }

  /** Per supplier: what is still owed to us in replacements, and how long suppliers take. */
  async summary(user: SessionUser) {
    if (!user.permissions.has('replacement.view')) throw new ForbiddenException();
    return requestContext.runSystem(async () => {
      const rows = await this.prisma.db.replacementTicket.findMany({ where: { kind: 'SUPPLIER', status: { not: 'CANCELLED' } } });
      const sups = await this.prisma.db.supplier.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.supplierId!))] } }, select: { id: true, code: true, name: true } });
      const canName = user.permissions.has('supplier.view.name');
      const suppliers = sups.map((s) => { const mine = rows.filter((r) => r.supplierId === s.id); const open = mine.filter((r) => r.status !== 'CLOSED'); const closed = mine.filter((r) => r.status === 'CLOSED' && r.closedAt && r.sentAt);
        return { id: s.id, code: s.code, name: canName ? s.name : null, tickets: mine.length, openTickets: open.length, unitsOwed: open.reduce((t, r) => t + r.qty - r.receivedQty, 0), oldestOpenDays: open.length ? Math.max(...open.map((r) => daysBetween(r.sentAt ?? r.createdAt, todayManila()))) : 0, avgDaysToReplace: closed.length ? Math.round(closed.reduce((t, r) => t + daysBetween(r.sentAt!, r.closedAt!), 0) / closed.length) : null }; }).sort((a, b) => b.unitsOwed - a.unitsOwed);
      const customer = await this.prisma.db.replacementTicket.groupBy({ by: ['status'], where: { kind: 'CUSTOMER' }, _count: { _all: true } });
      return { suppliers, customerByStatus: Object.fromEntries(customer.map((c) => [c.status, c._count._all])) };
    });
  }

  /** Daily: tickets nobody has ticked / no replacement has arrived for are reminded to the auditors, Accounting, the Owner and whoever opened them. */
  async runDaily(now = todayManila()) {
    const open = await this.prisma.db.replacementTicket.findMany({ where: { status: { in: ['OPEN', 'AWAITING_REPLACEMENT', 'PARTIAL'] } } });
    let reminded = 0;
    for (const t of open) {
      const since = t.sentAt ?? t.createdAt; const days = daysBetween(since, now); const limit = t.kind === 'CUSTOMER' ? REMIND_CUSTOMER_AFTER : REMIND_SUPPLIER_AFTER;
      if (days < limit || (t.remindedAt && daysBetween(t.remindedAt, now) < 3)) continue;
      await this.prisma.db.replacementTicket.update({ where: { id: t.id }, data: { remindedAt: now } });
      await this.tell({ type: 'REPLACEMENT_OVERDUE', title: t.kind === 'CUSTOMER' ? `⚑ ${t.ticketNo} (DR ${t.drSiNo}): the customer is still waiting for the replacement (${days} days)` : `⚑ ${t.ticketNo}: no replacement from the supplier yet (${days} days since it was sent, ${t.receivedQty} of ${t.qty} arrived)`, link: this.link(t.id) }, [t.createdBy]);
      reminded++;
    }
    return { reminded };
  }
}
