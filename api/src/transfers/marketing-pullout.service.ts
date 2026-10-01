import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { StockService, MARKETING_DESTINATIONS } from '../stock/stock.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../common/audit.service';
import { PostingService } from '../gl/posting.service';
import { r9bStockExpense } from '../gl/posting-rules';
import { dateStr, toDateOnly, todayManila } from '../common/manila';
import { D, sum } from '../common/money';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';

const LABEL: Record<string, string> = { 'MKT-PROTHIN': 'Prothin Marketing', 'MKT-GWS': 'GWS Marketing', 'BO-BAD': 'BO (bad orders)' };

/**
 * Stock given out to Prothin Marketing / GWS Marketing, or written off as bad orders (BO) (owner request 2026-10-01).
 * Any branch (or the warehouse) with stock makes a pull-out to one of the three destinations; the Head Auditor approves; the stock then leaves the branch at once.
 * The sender may endorse it to Accounting as an expense; Accounting accepts it (journal: Dr marketing expense / spoilage for BO, Cr inventory at cost).
 * A summary lists everything given out and what has been expensed.
 */
@Injectable()
export class MarketingPulloutService implements OnModuleInit {
  constructor(private prisma: PrismaService, private stock: StockService, private approvals: ApprovalsService, private notify: NotificationsService, private audit: AuditService, private posting: PostingService) {}

  onModuleInit() {
    this.approvals.register('MARKETING_PULLOUT', (r, outcome, actor) => this.onDecision(r.documentId, outcome, actor?.id ?? null, actor?.note), 'TransferDoc');
    this.approvals.register('PULLOUT_EXPENSE', (r, outcome, actor) => this.onExpense(r.documentId, outcome, actor?.id ?? null, actor?.note), 'TransferDoc');
  }

  private include = { fromLocation: { select: { id: true, code: true, name: true } }, toLocation: { select: { id: true, code: true, name: true } }, lines: { include: { product: { select: { id: true, sku: true, name: true, category: { select: { accountingClass: true } } } }, batch: { select: { unitCost: true } } } } } as const;

  /** The Head Auditor decided. Approved: the stock leaves the branch and is in the destination at once (no confirmation needed there). */
  private async onDecision(docId: string, outcome: 'APPROVED' | 'REJECTED', actorId: string | null, note?: string) {
    await requestContext.runSystem(async () => {
      const doc = await this.prisma.db.transferDoc.findUniqueOrThrow({ where: { id: docId }, include: this.include });
      if (doc.status !== 'SUBMITTED') return;
      if (outcome === 'REJECTED') {
        await this.prisma.db.transferDoc.update({ where: { id: docId }, data: { status: 'REJECTED' } });
        await this.notify.toUsers([doc.preparedBy], { type: 'MARKETING_PULLOUT_REJECTED', title: `The Head Auditor did not approve ${doc.controlNo} to ${doc.toLocation.name}${note ? `: ${note}` : ''}`, link: `/transfers/${docId}` });
        return;
      }
      await this.prisma.db.$transaction(async (tx) => {
        await this.stock.post(tx, doc.lines.flatMap((l) => [
          { locationId: doc.fromLocationId, productId: l.productId, batchId: l.batchId, qtyDelta: -l.qtySent, movementType: 'TRANSFER_OUT' as const, documentType: 'TransferDoc', documentId: doc.id, unitCost: l.batch.unitCost, businessDate: doc.docDate, createdBy: actorId ?? undefined },
          { locationId: doc.toLocationId, productId: l.productId, batchId: l.batchId, qtyDelta: l.qtySent, movementType: 'TRANSFER_IN' as const, documentType: 'TransferDoc', documentId: doc.id, unitCost: l.batch.unitCost, businessDate: doc.docDate, createdBy: actorId ?? undefined },
        ]));
        for (const l of doc.lines) await tx.transferLine.update({ where: { id: l.id }, data: { qtyReceived: l.qtySent } });
        await tx.transferDoc.update({ where: { id: docId }, data: { status: 'RECEIVED', approvedAt: new Date(), receivedAt: new Date(), receivedBy: actorId } });
      });
      await this.notify.toUsers([doc.preparedBy], { type: 'MARKETING_PULLOUT_APPROVED', title: `${doc.controlNo} to ${doc.toLocation.name} was approved by the Head Auditor: the stock left ${doc.fromLocation.name}`, link: `/transfers/${docId}` });
      if (doc.endorseExpense) await this.requestExpense(docId, doc.preparedBy);
    });
  }

  /** Sends the pull-out to Accounting to be booked as an expense (at cost). */
  private async requestExpense(docId: string, requestedBy: string) {
    const doc = await this.prisma.db.transferDoc.findUniqueOrThrow({ where: { id: docId }, include: this.include });
    const value = sum(doc.lines.map((l) => l.batch.unitCost.mul(l.qtySent)));
    const req = await this.approvals.request({ type: 'PULLOUT_EXPENSE', documentType: 'TransferDoc', documentId: docId, requestedBy, summary: { controlNo: doc.controlNo, locationId: doc.fromLocationId, locationName: `${doc.fromLocation.name} → ${doc.toLocation.name}`, lines: doc.lines.length, units: doc.lines.reduce((t, l) => t + l.qtySent, 0), total: value.toFixed(2), step: `Accept = booked as ${doc.toLocation.code === 'BO-BAD' ? 'spoilage / bad-order' : 'marketing'} expense at cost` } });
    await this.prisma.db.transferDoc.update({ where: { id: docId }, data: { endorseExpense: true, expenseStatus: 'PENDING', approvalRequestId: req.id } });
    await this.notify.toRoles(['ACCOUNTING_HEAD', 'ACCOUNTING_ASSOCIATE'], { type: 'PULLOUT_EXPENSE', title: `${doc.controlNo}: stock given to ${doc.toLocation.name} is endorsed to Accounting as an expense (${doc.fromLocation.name})`, link: '/approvals' });
  }

  private async onExpense(docId: string, outcome: 'APPROVED' | 'REJECTED', actorId: string | null, note?: string) {
    await requestContext.runSystem(async () => {
      const doc = await this.prisma.db.transferDoc.findUniqueOrThrow({ where: { id: docId }, include: this.include });
      if (doc.expenseStatus !== 'PENDING') return;
      if (outcome === 'REJECTED') {
        await this.prisma.db.transferDoc.update({ where: { id: docId }, data: { expenseStatus: 'REJECTED', endorseExpense: false } });
        await this.notify.toRoles(['HEAD_AUDITOR'], { type: 'PULLOUT_EXPENSE_REJECTED', title: `Accounting did not accept ${doc.controlNo} as an expense${note ? `: ${note}` : ''}`, link: `/transfers/${docId}` });
        await this.notify.toUsers([doc.preparedBy], { type: 'PULLOUT_EXPENSE_REJECTED', title: `Accounting did not accept ${doc.controlNo} as an expense${note ? `: ${note}` : ''}`, link: `/transfers/${docId}` });
        return;
      }
      await this.prisma.db.$transaction(async (tx) => {
        await this.posting.post(tx, { type: 'TransferDoc', id: docId, date: todayManila(), createdBy: actorId }, (r) => r9bStockExpense(r, { fromLocationId: doc.fromLocationId, destinationCode: doc.toLocation.code, controlNo: doc.controlNo, lines: doc.lines.map((l) => ({ accountingClass: l.product.category.accountingClass, qty: l.qtySent, unitCost: l.batch.unitCost })) }));
        await tx.transferDoc.update({ where: { id: docId }, data: { expenseStatus: 'POSTED', expenseAt: new Date(), expenseBy: actorId } });
      });
      await this.notify.toUsers([doc.preparedBy], { type: 'PULLOUT_EXPENSE_POSTED', title: `${doc.controlNo} was booked by Accounting as an expense`, link: `/transfers/${docId}` });
    });
  }

  /** Endorse an approved pull-out to Accounting as an expense (when it was not endorsed at the start, or Accounting returned it). */
  async endorse(id: string, user: SessionUser) {
    const doc = await requestContext.runSystem(() => this.prisma.db.transferDoc.findUnique({ where: { id }, select: { id: true, controlNo: true, transferType: true, status: true, preparedBy: true, expenseStatus: true, fromLocationId: true } }));
    if (!doc) throw new NotFoundException();
    if (doc.transferType !== 'MARKETING_PULLOUT') throw new BadRequestException('Only a Marketing / BO pull-out is endorsed as an expense');
    if (!(user.roleKey === 'ADMIN' || doc.preparedBy === user.id || user.permissions.has('approval.act.MARKETING_PULLOUT') || (user.locationScoped && user.locationIds.includes(doc.fromLocationId) && user.permissions.has('transfer.create')))) throw new ForbiddenException('Only the sender, the Head Auditor or the Owner can endorse it');
    if (doc.status !== 'RECEIVED') throw new BadRequestException('It can be endorsed once the Head Auditor has approved it');
    if (doc.expenseStatus === 'PENDING' || doc.expenseStatus === 'POSTED') throw new BadRequestException(doc.expenseStatus === 'POSTED' ? 'Accounting has already booked it' : 'It is already with Accounting');
    await requestContext.runSystem(() => this.requestExpense(id, doc.preparedBy));
    await this.audit.log({ action: 'ENDORSE_EXPENSE', entityType: 'TransferDoc', entityId: id, after: { by: user.id } });
    return { ok: true };
  }

  /** What was given out to each destination in a period, item by item, and how much of it Accounting has booked as expense. */
  async summary(user: SessionUser, q: { from?: string; to?: string; destination?: string; locationId?: string }) {
    const from = q.from ?? dateStr(new Date(todayManila().getTime() - 30 * 86400000)); const to = q.to ?? dateStr(todayManila());
    const canCost = user.permissions.has('cost.view');
    const dests = q.destination && (MARKETING_DESTINATIONS as readonly string[]).includes(q.destination) ? [q.destination] : [...MARKETING_DESTINATIONS];
    const scope = user.locationScoped ? user.locationIds : q.locationId ? [q.locationId] : null;
    const docs = await requestContext.runSystem(() => this.prisma.db.transferDoc.findMany({ where: { transferType: 'MARKETING_PULLOUT', status: { in: ['SUBMITTED', 'RECEIVED'] }, docDate: { gte: toDateOnly(from), lte: toDateOnly(to) }, toLocation: { code: { in: dests } }, fromLocationId: scope ? { in: scope } : undefined }, include: this.include, orderBy: { docDate: 'desc' } }));
    const destinations = dests.map((code) => {
      const mine = docs.filter((d) => d.toLocation.code === code); const done = mine.filter((d) => d.status === 'RECEIVED'); const waiting = mine.filter((d) => d.status === 'SUBMITTED');
      const units = (d: (typeof mine)[number]) => d.lines.reduce((t, l) => t + l.qtySent, 0); const val = (d: (typeof mine)[number]) => sum(d.lines.map((l) => l.batch.unitCost.mul(l.qtySent)));
      const products = new Map<string, { productId: string; sku: string; name: string; units: number; expensedUnits: number; value: Prisma.Decimal; expensedValue: Prisma.Decimal }>();
      for (const d of done) for (const l of d.lines) {
        const cur = products.get(l.productId) ?? { productId: l.productId, sku: l.product.sku, name: l.product.name, units: 0, expensedUnits: 0, value: D(0), expensedValue: D(0) };
        cur.units += l.qtySent; cur.value = cur.value.plus(l.batch.unitCost.mul(l.qtySent));
        if (d.expenseStatus === 'POSTED') { cur.expensedUnits += l.qtySent; cur.expensedValue = cur.expensedValue.plus(l.batch.unitCost.mul(l.qtySent)); }
        products.set(l.productId, cur);
      }
      const sumUnits = (xs: typeof mine) => xs.reduce((t, d) => t + units(d), 0);
      return {
        code, name: LABEL[code] ?? code,
        totals: { forms: done.length, units: sumUnits(done), expensedUnits: sumUnits(done.filter((d) => d.expenseStatus === 'POSTED')), pendingExpenseUnits: sumUnits(done.filter((d) => d.expenseStatus === 'PENDING')), notEndorsedUnits: sumUnits(done.filter((d) => !d.expenseStatus || d.expenseStatus === 'REJECTED')), waitingForHeadAuditorForms: waiting.length, waitingForHeadAuditorUnits: sumUnits(waiting), ...(canCost ? { value: sum(done.map(val)).toFixed(2), expensedValue: sum(done.filter((d) => d.expenseStatus === 'POSTED').map(val)).toFixed(2) } : {}) },
        products: [...products.values()].sort((a, b) => b.units - a.units).map((p) => ({ productId: p.productId, sku: p.sku, name: p.name, units: p.units, expensedUnits: p.expensedUnits, ...(canCost ? { value: p.value.toFixed(2), expensedValue: p.expensedValue.toFixed(2) } : {}) })),
        docs: mine.map((d) => ({ id: d.id, controlNo: d.controlNo, date: dateStr(d.docDate), from: d.fromLocation.name, status: d.status, units: units(d), endorsed: d.endorseExpense, expenseStatus: d.expenseStatus, notes: d.notes, ...(canCost ? { value: val(d).toFixed(2) } : {}) })),
      };
    });
    return { from, to, canCost, destinations };
  }
}
