import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../common/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuditService } from '../common/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { toDateOnly, todayManila, yesterdayManila, dateStr } from '../common/manila';
import { D, sum, ZERO } from '../common/money';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';

export const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 1] as const;

/** §8.4 Daily close at 00:00 Manila, cash count, post-close edit requests (diff stored, applied on approval). */
@Injectable()
export class ClosingService implements OnModuleInit {
  constructor(private prisma: PrismaService, private approvals: ApprovalsService, private audit: AuditService, private notify: NotificationsService) {}

  onModuleInit() {
    this.approvals.register('POST_CLOSE_EDIT', (req, outcome, actor) => this.onEditDecision(req.documentId, outcome, actor?.id ?? null));
    this.approvals.register('POST_CLOSE_EDIT_FRANCHISE', (req, outcome, actor) => this.onEditDecision(req.documentId, outcome, actor?.id ?? null));
  }

  async isClosed(locationId: string, businessDate: Date, tx: Tx | null = null): Promise<boolean> {
    const db = (tx ?? this.prisma.db);
    if (dateStr(businessDate) < dateStr(todayManila())) {
      // any past day is closed once the midnight job has run for it; if the job missed it, treat as closed too
      const row = await db.dailyClose.findUnique({ where: { locationId_businessDate: { locationId, businessDate } } });
      return !!row || true;
    }
    return false;
  }

  /** Expected cash = cash sales − cash-paid expenses (§8.4). */
  async summary(locationId: string, businessDate: Date) {
    const sales = await this.prisma.db.salesDoc.findMany({ where: { locationId, docDate: businessDate, voidedAt: null } });
    const expenses = await this.prisma.db.expenseDoc.findMany({ where: { locationId, docDate: businessDate, voidedAt: null } });
    const cashSalesOnly = sum(sales.filter((s) => s.paymentMode === 'CASH').map((s) => s.grandTotal));
    // cash AR collections received at this location on the day also land in the drawer
    const collections = await this.prisma.db.paymentAllocation.findMany({ where: { payment: { paymentMode: 'CASH', voidedAt: null, businessDate }, salesDoc: { locationId } }, select: { amount: true } });
    const cashCollections = sum(collections.map((c) => c.amount));
    const cashSales = cashSalesOnly.plus(cashCollections);
    const cashExpenses = sum(expenses.filter((e) => e.paidFrom === 'CASH_DRAWER').map((e) => e.amount));
    const close = await this.prisma.db.dailyClose.findUnique({ where: { locationId_businessDate: { locationId, businessDate } } });
    return { locationId, businessDate: dateStr(businessDate), cashSalesOnly, cashCollections, cashSales, cashExpenses, expectedCash: cashSales.minus(cashExpenses), totalCashDeposit: cashSales.minus(cashExpenses), salesCount: sales.length, expenseCount: expenses.length, closed: !!close, close };
  }

  /** Associate fills the Money Breakdown; variance recorded, not blocking (§18.3). */
  async cashCount(locationId: string, date: string | undefined, breakdown: Record<string, number>, user: SessionUser) {
    if (user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException();
    const businessDate = date ? toDateOnly(date) : todayManila();
    const counted = DENOMINATIONS.reduce((s, d) => s.plus(D(breakdown[String(d)] ?? 0).mul(d)), ZERO);
    const s = await this.summary(locationId, businessDate);
    const row = await this.prisma.db.dailyClose.upsert({
      where: { locationId_businessDate: { locationId, businessDate } },
      create: { locationId, businessDate, closedAt: new Date(0), closedBy: null, cashSales: s.cashSales.toFixed(2), cashExpenses: s.cashExpenses.toFixed(2), expectedCash: s.expectedCash.toFixed(2), countedCash: counted.toFixed(2), cashVariance: counted.minus(s.expectedCash).toFixed(2), moneyBreakdown: breakdown, totalCashDeposit: s.totalCashDeposit.toFixed(2) },
      update: { countedCash: counted.toFixed(2), cashVariance: counted.minus(s.expectedCash).toFixed(2), moneyBreakdown: breakdown, cashSales: s.cashSales.toFixed(2), cashExpenses: s.cashExpenses.toFixed(2), expectedCash: s.expectedCash.toFixed(2), totalCashDeposit: s.totalCashDeposit.toFixed(2) },
    });
    await this.audit.log({ action: 'CASH_COUNT', entityType: 'DailyClose', entityId: row.id, after: row });
    return row;
  }

  /** Midnight job: close yesterday for every selling company location (franchises too — their edits route to the owner). */
  async closeDay(businessDate: Date = yesterdayManila()) {
    const locations = await this.prisma.db.location.findMany({ where: { isSelling: true, active: true, type: { in: ['WAREHOUSE', 'BRANCH', 'FRANCHISE'] } } });
    let n = 0;
    for (const loc of locations) {
      const existing = await this.prisma.db.dailyClose.findUnique({ where: { locationId_businessDate: { locationId: loc.id, businessDate } } });
      if (existing && existing.closedAt.getTime() > 0) continue;
      const s = await this.summary(loc.id, businessDate);
      await this.prisma.db.dailyClose.upsert({
        where: { locationId_businessDate: { locationId: loc.id, businessDate } },
        create: { locationId: loc.id, businessDate, closedAt: new Date(), cashSales: s.cashSales.toFixed(2), cashExpenses: s.cashExpenses.toFixed(2), expectedCash: s.expectedCash.toFixed(2), totalCashDeposit: s.totalCashDeposit.toFixed(2) },
        update: { closedAt: new Date(), cashSales: s.cashSales.toFixed(2), cashExpenses: s.cashExpenses.toFixed(2), expectedCash: s.expectedCash.toFixed(2), totalCashDeposit: s.totalCashDeposit.toFixed(2) },
      });
      n++;
    }
    return { closed: n, businessDate: dateStr(businessDate) };
  }
  closes(user: SessionUser, locationId?: string) { if (locationId && user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException(); return this.prisma.db.dailyClose.findMany({ where: { locationId: locationId ?? (user.locationScoped ? { in: user.locationIds } : { not: '' }) }, include: { location: { select: { code: true, name: true } } }, orderBy: { businessDate: 'desc' }, take: 120 }); }

  // ── Post-close edit requests ──
  /** Stores before/after diff; nothing changes until approved. Company branch → Head AND Asst; franchise → Owner (+ Admin if it touches a warehouse Transfer-In). */
  async requestEdit(input: { documentType: 'SalesDoc' | 'ExpenseDoc' | 'TransferDoc'; documentId: string; reason: string; after: Record<string, unknown> }, user: SessionUser) {
    const before = await this.loadDoc(input.documentType, input.documentId);
    const locationId = (before as { locationId?: string; toLocationId?: string }).locationId ?? (before as { toLocationId: string }).toLocationId;
    if (user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException();
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: locationId } });
    const isFranchise = loc.type === 'FRANCHISE';
    let extraRoles: ('ADMIN')[] = [];
    if (isFranchise && input.documentType === 'TransferDoc') {
      const t = before as { fromLocation?: { type: string } };
      if (t.fromLocation?.type === 'WAREHOUSE') extraRoles = ['ADMIN'];
    }
    const edit = await this.prisma.db.$transaction(async (tx) => {
      const e = await tx.postCloseEdit.create({ data: { documentType: input.documentType, documentId: input.documentId, locationId, requestedBy: user.id, reason: input.reason, before: JSON.parse(JSON.stringify(before)), after: input.after as Prisma.InputJsonValue, approvalRequestId: '' } });
      const req = await this.approvals.request({ type: isFranchise ? 'POST_CLOSE_EDIT_FRANCHISE' : 'POST_CLOSE_EDIT', documentType: 'PostCloseEdit', documentId: e.id, requestedBy: user.id, extraRoles, summary: { controlNo: (before as { controlNo?: string }).controlNo, locationId, locationName: loc.name, documentType: input.documentType, reason: input.reason, before: pick(before as Record<string, unknown>, Object.keys(input.after)), after: input.after } }, tx);
      return tx.postCloseEdit.update({ where: { id: e.id }, data: { approvalRequestId: req.id } });
    });
    await this.audit.log({ action: 'EDIT_REQUEST', entityType: input.documentType, entityId: input.documentId, before, after: input.after });
    return edit;
  }
  listEdits(user: SessionUser) { return this.prisma.db.postCloseEdit.findMany({ where: user.locationScoped ? { locationId: { in: user.locationIds } } : {}, orderBy: { createdAt: 'desc' }, take: 200 }); }

  private async loadDoc(type: string, id: string): Promise<unknown> {
    const db = this.prisma.db;
    const doc = type === 'SalesDoc' ? await db.salesDoc.findUnique({ where: { id }, include: { lines: true } }) : type === 'ExpenseDoc' ? await db.expenseDoc.findUnique({ where: { id } }) : await db.transferDoc.findUnique({ where: { id }, include: { lines: true, fromLocation: true } });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  /** Apply the approved diff. Only header-level scalar fields are patched (qty/price changes must be done via void + re-entry, which is itself an edit request). */
  private async onEditDecision(editId: string, outcome: 'APPROVED' | 'REJECTED', actorId: string | null) {
    await requestContext.runSystem(async () => {
      const e = await this.prisma.db.postCloseEdit.findUniqueOrThrow({ where: { id: editId } });
      if (outcome === 'REJECTED' || e.appliedAt) return;
      const after = e.after as Record<string, unknown>;
      const allowed: Record<string, string[]> = {
        SalesDoc: ['drSiNo', 'channel', 'channelSub', 'paymentMode', 'paymentAccountId', 'customerId', 'agentId', 'riderId', 'customerName', 'deliveryFee', 'shippingFee', 'shippingExpense', 'marketplaceCharges', 'riderIncentive', 'dueDate', 'notes', 'cardMid', 'cardSlipNo', 'cardApprovalCode', 'cardBatchNo', 'voidReason'],
        ExpenseDoc: ['accountId', 'payee', 'amount', 'paidFrom', 'paidFromAccountId', 'notes', 'voidReason'],
        TransferDoc: ['notes', 'returnReason', 'voidReason'],
      };
      const data: Record<string, unknown> = {};
      for (const k of allowed[e.documentType] ?? []) if (k in after) data[k] = k === 'dueDate' && after[k] ? toDateOnly(String(after[k])) : after[k];
      if (after.voidReason) Object.assign(data, { status: 'VOIDED', voidedAt: new Date(), voidedBy: actorId });
      if (e.documentType === 'SalesDoc') {
        const d = data as Prisma.SalesDocUncheckedUpdateInput;
        if (d.deliveryFee != null || d.shippingFee != null) { const cur = await this.prisma.db.salesDoc.findUniqueOrThrow({ where: { id: e.documentId } }); const gt = cur.productTotal.plus(D((d.deliveryFee as string) ?? cur.deliveryFee)).plus(D((d.shippingFee as string) ?? cur.shippingFee)); d.grandTotal = gt.toFixed(2); if (cur.paymentMode !== 'AR_PDC') d.amountPaid = gt.toFixed(2); }
        await this.prisma.db.salesDoc.update({ where: { id: e.documentId }, data: { ...d, updatedBy: actorId } });
        if (after.voidReason) { const doc = await this.prisma.db.salesDoc.findUniqueOrThrow({ where: { id: e.documentId }, include: { lines: true } }); await this.prisma.db.$transaction(async (tx) => { for (const l of doc.lines) { await tx.stockLedger.create({ data: { locationId: doc.locationId, productId: l.productId, batchId: l.batchId, qtyDelta: l.qty, movementType: 'SALE_RETURN', documentType: 'SalesDoc', documentId: doc.id, unitCost: l.unitCost, businessDate: todayManila(), createdBy: actorId } }); await tx.stockBalance.update({ where: { locationId_productId_batchId: { locationId: doc.locationId, productId: l.productId, batchId: l.batchId } }, data: { qty: { increment: l.qty } } }); } }); }
      } else if (e.documentType === 'ExpenseDoc') await this.prisma.db.expenseDoc.update({ where: { id: e.documentId }, data: { ...(data as Prisma.ExpenseDocUncheckedUpdateInput), updatedBy: actorId } });
      else await this.prisma.db.transferDoc.update({ where: { id: e.documentId }, data: { ...(data as Prisma.TransferDocUncheckedUpdateInput), updatedBy: actorId } });
      await this.prisma.db.postCloseEdit.update({ where: { id: editId }, data: { appliedAt: new Date() } });
      await this.audit.log({ action: 'POST_CLOSE_EDIT_APPLIED', entityType: e.documentType, entityId: e.documentId, before: e.before, after: data, userId: actorId });
    });
  }
}
function pick(o: Record<string, unknown>, keys: string[]) { return Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]])); }
