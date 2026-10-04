import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { SettingsService } from '../common/settings.service';
import { SequenceService } from '../common/sequence.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { PostingService } from '../gl/posting.service';
import { r4FranchiseCollection } from '../gl/posting-rules';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';
import { D } from '../common/money';
import { addDays, dateStr, daysBetween, todayManila, toDateOnly } from '../common/manila';
import type { RoleKey } from '../common/permissions';

const ZERO = new Prisma.Decimal(0);
const r2 = (x: Prisma.Decimal.Value) => D(x).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
/** Who is told of every franchise receivable event (owner request 2026-09-30): the Owner, both auditors, Accounting and the Franchise Coordinators; the franchise owner is added per franchise. */
export const FRANCHISE_AR_ROLES: RoleKey[] = ['ADMIN', 'HEAD_AUDITOR', 'ASST_AUDITOR', 'ACCOUNTING_HEAD', 'ACCOUNTING_ASSOCIATE', 'FRANCHISE_COORDINATOR', 'ASST_FRANCHISE_COORDINATOR'];
export const PAY_MODES = ['BANK_TRANSFER', 'GCASH', 'CHEQUE', 'CASH'] as const;

type Inv = Prisma.FranchiseInvoiceGetPayload<object>;
export interface Rules { termsDays: number; penaltyPct: number; dailyPct: number; effectiveFrom: string; flagDays: number; remindDaysBefore: number }

/**
 * Receivables of the franchises (owner request 2026-09-30, memo 2026-07-31).
 * - Goods transferred to a franchise are billed at the franchise price when the franchise receives them (invoice FAR-<transfer no>), due after the terms.
 * - From the day after the due date (and not before the memo takes effect on 2026-08-01): one-time penalty of 2% of the unpaid balance, plus 0.1% of the unpaid balance for every
 *   day until settled (₱100,000: 1 day ₱2,100 · 5 days ₱2,500 · 10 days ₱3,000 · 30 days ₱5,000). Simple interest: never on the penalty or on earlier interest.
 * - A payment settles the penalty first, then the interest, then the goods.
 * - Quantities that change after receiving (difference resolved by the Head Auditor / Owner) change the invoice by themselves and everyone involved is told.
 * - Extensions are asked for in the system and decided by the Owner; auditors, Accounting and the Franchise Coordinators are flagged.
 * - Unpaid two months after the due date: flagged with the actions the memo allows (demand, suspend credit, cash-before-delivery).
 */
@Injectable()
export class FranchiseArService implements OnModuleInit {
  constructor(private prisma: PrismaService, private audit: AuditService, private settings: SettingsService, private seq: SequenceService, private notify: NotificationsService, private approvals: ApprovalsService, private posting: PostingService) {}

  onModuleInit() { this.approvals.register('FRANCHISE_AR_EXTENSION', (r, outcome, actor) => this.onExtension(r.documentId, outcome, actor), 'FranchiseArExtension'); }

  // ── rules and arithmetic ──
  async rules(): Promise<Rules> {
    const g = <T,>(k: string) => this.settings.get<T>(k);
    return { termsDays: Number(await g('franchise.ar.terms_days')), penaltyPct: Number(await g('franchise.ar.penalty_pct')), dailyPct: Number(await g('franchise.ar.daily_interest_pct')), effectiveFrom: String(await g('franchise.ar.effective_from')), flagDays: Number(await g('franchise.ar.flag_days')), remindDaysBefore: Number(await g('franchise.ar.remind_days_before')) };
  }
  /** What the invoice stands at on a date: penalty and interest are computed from the stored state, so the result never depends on when a job ran. */
  static project(inv: Inv, rules: Rules, asOf: Date) {
    const unpaid = D(inv.amount).minus(inv.principalPaid);
    let penalty = D(inv.penalty), interest = D(inv.interest);
    let penaltyAppliedOn = inv.penaltyAppliedOn, interestThrough = inv.interestThrough;
    const eff = toDateOnly(rules.effectiveFrom);
    const firstDay = addDays(toDateOnly(inv.dueDate), 1) > eff ? addDays(toDateOnly(inv.dueDate), 1) : eff;
    if (inv.status === 'OPEN' && unpaid.gt(0) && asOf >= firstDay) {
      if (!penaltyAppliedOn) { penalty = penalty.plus(r2(unpaid.mul(rules.penaltyPct).div(100))); penaltyAppliedOn = firstDay; }
      const from = interestThrough && interestThrough >= addDays(firstDay, -1) ? addDays(interestThrough, 1) : firstDay;
      if (from <= asOf) { const days = daysBetween(from, asOf) + 1; interest = interest.plus(r2(unpaid.mul(rules.dailyPct).div(100).mul(days))); interestThrough = asOf; }
    }
    const penaltyDue = penalty.minus(inv.penaltyPaid), interestDue = interest.minus(inv.interestPaid);
    const daysOverdue = inv.status === 'OPEN' && unpaid.gt(0) ? Math.max(0, daysBetween(toDateOnly(inv.dueDate), asOf)) : 0;
    return { unpaid: unpaid.gt(0) ? unpaid : ZERO, penalty, interest, penaltyDue, interestDue, chargesDue: penaltyDue.plus(interestDue), totalDue: (unpaid.gt(0) ? unpaid : ZERO).plus(penaltyDue).plus(interestDue), penaltyAppliedOn, interestThrough, daysOverdue };
  }
  /** Save the projection (before anything changes the balance, so the charges so far are based on the old balance). */
  private async settle(tx: Tx, inv: Inv, asOf = todayManila()) {
    const p = FranchiseArService.project(inv, await this.rules(), asOf);
    if (p.penalty.equals(inv.penalty) && p.interest.equals(inv.interest) && dateStr(p.penaltyAppliedOn ?? new Date(0)) === dateStr(inv.penaltyAppliedOn ?? new Date(0)) && (p.interestThrough?.getTime() ?? 0) === (inv.interestThrough?.getTime() ?? 0)) return inv;
    return tx.franchiseInvoice.update({ where: { id: inv.id }, data: { penalty: p.penalty.toFixed(2), interest: p.interest.toFixed(2), penaltyAppliedOn: p.penaltyAppliedOn, interestThrough: p.interestThrough } });
  }

  // ── who is told ──
  async franchiseName(locationId: string) { return (await this.franchise(locationId)).name; }
  private async franchise(locationId: string) { return this.prisma.db.location.findUniqueOrThrow({ where: { id: locationId }, select: { id: true, name: true, franchiseOwnerUserId: true, creditHold: true, creditHoldNote: true } }); }
  async tell(locationId: string, n: { type: string; title: string; body?: string; link?: string }, extraUserIds: string[] = []) {
    const loc = await this.franchise(locationId);
    await this.notify.toRoles(FRANCHISE_AR_ROLES, n);
    await this.notify.toUsers([...(loc.franchiseOwnerUserId ? [loc.franchiseOwnerUserId] : []), ...extraUserIds], n);
  }
  link(id: string) { return `/franchise-ar?invoice=${id}`; }
  peso = (x: Prisma.Decimal.Value) => `₱${D(x).toNumber().toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // ── invoices from transfers ──
  /**
   * Called when a transfer to a franchise is journalled (receiving, a resolved difference, extra items): the first time it bills the franchise; later it changes the invoice
   * by the value of what changed and tells Owner, auditors, Accounting, Coordinators, the sales associates involved and the franchise owner.
   */
  async onTransferBilling(tx: Tx, doc: { id: string; controlNo: string; toLocationId: string; fromLocationId: string; preparedBy?: string | null; receivedBy?: string | null }, value: Prisma.Decimal, actorId: string | null, why: string) {
    if (value.lte(0)) return;
    const base = doc.controlNo.replace(/-\d{3}$/, '');
    const controlNo = `FAR-${base}`;
    const cur = await tx.franchiseInvoice.findFirst({ where: { OR: [{ transferId: doc.id }, { controlNo }] } });
    const today = todayManila(); const rules = await this.rules();
    if (!cur) {
      const inv = await tx.franchiseInvoice.create({ data: { controlNo, source: 'TRANSFER', transferId: doc.id, franchiseLocationId: doc.toLocationId, fromLocationId: doc.fromLocationId, issueDate: today, originalDueDate: addDays(today, rules.termsDays), dueDate: addDays(today, rules.termsDays), originalAmount: r2(value).toFixed(2), amount: r2(value).toFixed(2), createdBy: actorId } });
      await this.tell(doc.toLocationId, { type: 'FRANCHISE_INVOICE', title: `New franchise invoice ${inv.controlNo}: ${this.peso(inv.amount)} due ${dateStr(inv.dueDate)}`, body: `Goods received at the franchise price. After the due date a 2% penalty and 0.1% a day apply (memo of July 31, 2026).`, link: this.link(inv.id) }, doc.receivedBy ? [doc.receivedBy] : []);
      return inv;
    }
    if (cur.status === 'CANCELLED') return cur;
    const settled = await this.settle(tx, cur);
    const before = D(settled.amount);
    const after = before.plus(r2(value));
    const inv = await tx.franchiseInvoice.update({ where: { id: cur.id }, data: { amount: after.toFixed(2), status: 'OPEN' } });
    await tx.franchiseArAdjustment.create({ data: { invoiceId: cur.id, kind: 'TRANSFER_CHANGE', delta: r2(value).toFixed(2), reason: why, transferId: doc.id, createdBy: actorId, details: { controlNo: doc.controlNo, before: before.toFixed(2), after: after.toFixed(2) } } });
    await this.announceChange(doc, inv, before, after, why, actorId);
    return inv;
  }
  private async announceChange(doc: { controlNo: string; toLocationId: string; preparedBy?: string | null; receivedBy?: string | null; id: string }, inv: Inv, before: Prisma.Decimal, after: Prisma.Decimal, why: string, actorId: string | null) {
    const p = FranchiseArService.project(inv, await this.rules(), todayManila());
    const involved = [doc.preparedBy, doc.receivedBy, actorId].filter((x): x is string => !!x);
    await this.tell(doc.toLocationId, { type: 'FRANCHISE_AR_ADJUSTED', title: `Franchise invoice ${inv.controlNo} changed from ${this.peso(before)} to ${this.peso(after)}: ${why}`, body: `Transfer ${doc.controlNo}. The balance now stands at ${this.peso(p.totalDue)}${p.chargesDue.gt(0) ? ` including ${this.peso(p.chargesDue)} penalty and interest (charges so far are kept; from now they follow the new balance; Accounting may waive any excess)` : ''}.`, link: this.link(inv.id) }, involved);
  }

  /** A new invoice that is not goods from a transfer (the shipping charge of a sale): billed now, due after the terms, with the same penalty / interest rules. */
  async createCharge(tx: Tx, input: { controlNo: string; source: string; franchiseLocationId: string; fromLocationId: string; amount: Prisma.Decimal.Value; notes?: string | null }, actorId: string | null) {
    const today = todayManila(); const rules = await this.rules();
    return tx.franchiseInvoice.create({ data: { controlNo: input.controlNo, source: input.source, franchiseLocationId: input.franchiseLocationId, fromLocationId: input.fromLocationId, issueDate: today, originalDueDate: addDays(today, rules.termsDays), dueDate: addDays(today, rules.termsDays), originalAmount: r2(input.amount).toFixed(2), amount: r2(input.amount).toFixed(2), notes: input.notes ?? null, createdBy: actorId } });
  }
  /** Changes the amount billed on an invoice (after an approved correction); what was charged so far stays, later charges follow the new balance. */
  async changeAmount(tx: Tx, invoiceId: string, newAmount: Prisma.Decimal.Value, kind: string, reason: string, actorId: string | null, details: Record<string, unknown> = {}) {
    const cur = await tx.franchiseInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const settled = await this.settle(tx, cur);
    const before = D(settled.amount); const after = r2(newAmount);
    if (after.lt(D(settled.principalPaid))) throw new BadRequestException('The new amount is less than what the franchise has already paid on this invoice');
    const closed = after.minus(settled.principalPaid).lte(0) && D(settled.penalty).minus(settled.penaltyPaid).lte(0) && D(settled.interest).minus(settled.interestPaid).lte(0);
    const inv = await tx.franchiseInvoice.update({ where: { id: invoiceId }, data: { amount: after.toFixed(2), status: closed ? 'PAID' : 'OPEN' } });
    await tx.franchiseArAdjustment.create({ data: { invoiceId, kind, delta: after.minus(before).toFixed(2), reason, createdBy: actorId, details: { before: before.toFixed(2), after: after.toFixed(2), ...details } as Prisma.InputJsonValue } });
    return { inv, before, after };
  }
  /** An old balance (from before GWS-ERP) entered by Accounting as a franchise invoice. */
  async createOpening(tx: Tx, input: { franchiseLocationId: string; fromLocationId: string; drSiNo: string; docDate: Date; dueDate: Date; amount: Prisma.Decimal.Value; notes?: string | null }, actorId: string | null) {
    const controlNo = `FAR-OPEN-${input.drSiNo}`;
    if (await tx.franchiseInvoice.findUnique({ where: { controlNo } })) throw new BadRequestException(`Invoice ${input.drSiNo} is already recorded for this franchise`);
    const inv = await tx.franchiseInvoice.create({ data: { controlNo, source: 'OPENING', franchiseLocationId: input.franchiseLocationId, fromLocationId: input.fromLocationId, issueDate: input.docDate, originalDueDate: input.dueDate, dueDate: input.dueDate, originalAmount: r2(input.amount).toFixed(2), amount: r2(input.amount).toFixed(2), notes: input.notes ?? 'Opening balance (before GWS-ERP)', createdBy: actorId } });
    return inv;
  }

  // ── reading ──
  private async scopeLocation(user: SessionUser, locationId?: string) {
    if (user.permissions.has('franchise.ar.view')) return locationId;
    if (user.permissions.has('franchise.ar.own')) { const own = user.locationIds[0]; if (!own) throw new BadRequestException('This account is not assigned to a franchise'); if (locationId && locationId !== own) throw new ForbiddenException('That is another franchise'); return own; }
    throw new ForbiddenException('You do not have access to franchise receivables');
  }
  private view(inv: Inv, rules: Rules, asOf: Date) {
    const p = FranchiseArService.project(inv, rules, asOf);
    return { id: inv.id, controlNo: inv.controlNo, source: inv.source, transferId: inv.transferId, issueDate: dateStr(inv.issueDate), dueDate: dateStr(inv.dueDate), originalDueDate: dateStr(inv.originalDueDate), extended: inv.dueDate.getTime() !== inv.originalDueDate.getTime(), status: inv.status, notes: inv.notes,
      amount: inv.amount, originalAmount: inv.originalAmount, principalPaid: inv.principalPaid, unpaid: p.unpaid, penalty: p.penalty, penaltyPaid: inv.penaltyPaid, interest: p.interest, interestPaid: inv.interestPaid, chargesDue: p.chargesDue, totalDue: p.totalDue, daysOverdue: p.daysOverdue, flaggedAt: inv.flaggedAt, twoMonthsOverdue: p.daysOverdue >= rules.flagDays };
  }
  async list(user: SessionUser, q: { locationId?: string; status?: string }) {
    const loc = await this.scopeLocation(user, q.locationId);
    const rules = await this.rules(); const today = todayManila();
    const rows = await this.prisma.db.franchiseInvoice.findMany({ where: { franchiseLocationId: loc, status: q.status === 'ALL' ? undefined : 'OPEN' }, orderBy: [{ dueDate: 'asc' }] });
    const locs = await this.prisma.db.location.findMany({ where: { type: 'FRANCHISE', ...(loc ? { id: loc } : {}) }, select: { id: true, code: true, name: true, creditHold: true, creditHoldNote: true, franchiseOwner: { select: { fullName: true } } }, orderBy: { name: 'asc' } });
    const pending = await this.prisma.db.franchiseArExtension.findMany({ where: { status: 'PENDING', invoiceId: { in: rows.map((r) => r.id) } } });
    const franchises = locs.map((l) => {
      const invoices = rows.filter((r) => r.franchiseLocationId === l.id).map((r) => ({ ...this.view(r, rules, today), pendingExtension: pending.find((x) => x.invoiceId === r.id) ? { requestedDueDate: dateStr(pending.find((x) => x.invoiceId === r.id)!.requestedDueDate) } : null }));
      const sum = (f: (i: (typeof invoices)[number]) => Prisma.Decimal) => invoices.reduce((t, i) => t.plus(f(i)), ZERO);
      return { locationId: l.id, code: l.code, name: l.name, owner: l.franchiseOwner?.fullName ?? null, creditHold: l.creditHold, creditHoldNote: l.creditHoldNote, invoices,
        totals: { goods: sum((i) => D(i.unpaid)), penalty: sum((i) => D(i.penalty).minus(i.penaltyPaid)), interest: sum((i) => D(i.interest).minus(i.interestPaid)), total: sum((i) => D(i.totalDue)), overdue: sum((i) => (i.daysOverdue > 0 ? D(i.totalDue) : ZERO)), overdueCount: invoices.filter((i) => i.daysOverdue > 0).length, flagged: invoices.filter((i) => i.twoMonthsOverdue).length } };
    });
    return { asOf: dateStr(today), rules, franchises };
  }
  /** What one franchise owes GWS today (for the portal and the franchise balance sheet). */
  async summary(locationId: string) {
    const rules = await this.rules(); const today = todayManila();
    const rows = await this.prisma.db.franchiseInvoice.findMany({ where: { franchiseLocationId: locationId, status: 'OPEN' }, orderBy: { dueDate: 'asc' } });
    let goods = ZERO, charges = ZERO, overdue = ZERO, overdueCount = 0, flagged = 0; let nextDue: string | null = null;
    for (const r of rows) { const p = FranchiseArService.project(r, rules, today); goods = goods.plus(p.unpaid); charges = charges.plus(p.chargesDue); if (p.daysOverdue > 0) { overdue = overdue.plus(p.totalDue); overdueCount++; } else if (!nextDue && p.unpaid.gt(0)) nextDue = dateStr(r.dueDate); if (p.daysOverdue >= rules.flagDays) flagged++; }
    return { goods, charges, total: goods.plus(charges), overdue, overdueCount, flagged, nextDue, invoices: rows.length };
  }
  async get(user: SessionUser, id: string) {
    const inv = await this.prisma.db.franchiseInvoice.findUnique({ where: { id }, include: { payments: { where: { voidedAt: null }, orderBy: { paidOn: 'asc' } }, adjustments: { orderBy: { createdAt: 'asc' } }, extensions: { orderBy: { createdAt: 'desc' } } } });
    if (!inv) throw new NotFoundException();
    await this.scopeLocation(user, inv.franchiseLocationId);
    const rules = await this.rules(); const loc = await this.franchise(inv.franchiseLocationId);
    const names = await this.prisma.db.user.findMany({ where: { id: { in: [...inv.payments.map((p) => p.recordedBy), ...inv.adjustments.map((a) => a.createdBy ?? ''), ...inv.extensions.map((e) => e.requestedBy)].filter(Boolean) } }, select: { id: true, fullName: true } });
    const nm = (id: string | null) => names.find((n) => n.id === id)?.fullName ?? (id ? '' : 'System');
    return { ...this.view(inv, rules, todayManila()), franchise: { id: loc.id, name: loc.name }, rules,
      payments: inv.payments.map((p) => ({ id: p.id, receiptNo: p.receiptNo, paidOn: dateStr(p.paidOn), amount: p.amount, toPenalty: p.toPenalty, toInterest: p.toInterest, toPrincipal: p.toPrincipal, mode: p.mode, reference: p.reference, by: nm(p.recordedBy) })),
      adjustments: inv.adjustments.map((a) => ({ id: a.id, kind: a.kind, delta: a.delta, reason: a.reason, at: a.createdAt, by: nm(a.createdBy), details: a.details })),
      extensions: inv.extensions.map((e) => ({ id: e.id, status: e.status, reason: e.reason, previousDueDate: dateStr(e.previousDueDate), requestedDueDate: dateStr(e.requestedDueDate), by: nm(e.requestedBy), at: e.createdAt, decisionNote: e.decisionNote, approvalRequestId: e.approvalRequestId })) };
  }

  // ── payment ──
  async recordPayment(user: SessionUser, id: string, input: { amount: number; paidOn?: string; mode: string; paymentAccountId?: string | null; reference?: string | null; proofAttachmentId?: string | null; notes?: string | null }) {
    if (!PAY_MODES.includes(input.mode as never)) throw new BadRequestException('Choose how it was paid');
    if (!(input.amount > 0)) throw new BadRequestException('The amount must be more than zero');
    if (input.mode !== 'CASH' && !input.reference?.trim()) throw new BadRequestException('Enter the reference / cheque number');
    if (input.mode !== 'CASH' && !input.proofAttachmentId) throw new BadRequestException({ message: 'Upload the proof of payment (transfer screenshot, GCash receipt or photo of the cheque)', code: 'PROOF_REQUIRED' });
    const paidOn = input.paidOn ? toDateOnly(input.paidOn) : todayManila();
    if (paidOn > todayManila()) throw new BadRequestException('The payment date cannot be in the future');
    const out = await this.prisma.db.$transaction(async (tx) => {
      const inv0 = await tx.franchiseInvoice.findUnique({ where: { id } });
      if (!inv0 || inv0.status === 'CANCELLED') throw new NotFoundException();
      const inv = await this.settle(tx, inv0);
      const p = FranchiseArService.project(inv, await this.rules(), todayManila());
      const pay = r2(input.amount);
      if (pay.gt(p.totalDue)) throw new BadRequestException(`The payment ${this.peso(pay)} is more than what is due ${this.peso(p.totalDue)}`);
      let left = pay;
      const toPenalty = Prisma.Decimal.min(left, p.penaltyDue); left = left.minus(toPenalty);
      const toInterest = Prisma.Decimal.min(left, p.interestDue); left = left.minus(toInterest);
      const toPrincipal = Prisma.Decimal.min(left, p.unpaid);
      const receiptNo = await this.seq.next(tx, 'FRP', { prefix: 'FRP', pad: 6 });
      const payment = await tx.franchisePayment.create({ data: { receiptNo, invoiceId: id, amount: pay.toFixed(2), toPenalty: toPenalty.toFixed(2), toInterest: toInterest.toFixed(2), toPrincipal: toPrincipal.toFixed(2), paidOn, mode: input.mode, paymentAccountId: input.paymentAccountId ?? null, reference: input.reference?.trim() || null, proofAttachmentId: input.proofAttachmentId ?? null, notes: input.notes ?? null, recordedBy: user.id } });
      const after = { principalPaid: D(inv.principalPaid).plus(toPrincipal), penaltyPaid: D(inv.penaltyPaid).plus(toPenalty), interestPaid: D(inv.interestPaid).plus(toInterest) };
      const closed = D(inv.amount).minus(after.principalPaid).lte(0) && D(inv.penalty).minus(after.penaltyPaid).lte(0) && D(inv.interest).minus(after.interestPaid).lte(0);
      const upd = await tx.franchiseInvoice.update({ where: { id }, data: { principalPaid: after.principalPaid.toFixed(2), penaltyPaid: after.penaltyPaid.toFixed(2), interestPaid: after.interestPaid.toFixed(2), status: closed ? 'PAID' : 'OPEN' } });
      if (input.paymentAccountId && inv.fromLocationId) await this.posting.post(tx, { type: 'FranchisePayment', id: payment.id, date: paidOn, createdBy: user.id }, (r) => r4FranchiseCollection(r, { fromLocationId: inv.fromLocationId!, franchiseLocationId: inv.franchiseLocationId, principal: toPrincipal, charges: toPenalty.plus(toInterest), paymentAccountId: input.paymentAccountId!, receiptNo }));
      return { payment, inv: upd, toPenalty, toInterest, toPrincipal, closed };
    });
    await this.audit.log({ action: 'CREATE', entityType: 'FranchisePayment', entityId: out.payment.id, after: out.payment });
    const left = FranchiseArService.project(out.inv, await this.rules(), todayManila());
    await this.tell(out.inv.franchiseLocationId, { type: 'FRANCHISE_PAYMENT', title: `Payment ${out.payment.receiptNo} of ${this.peso(out.payment.amount)} recorded for ${out.inv.controlNo} by ${user.fullName}`, body: `${out.toPenalty.plus(out.toInterest).gt(0) ? `Penalty and interest ${this.peso(out.toPenalty.plus(out.toInterest))}; ` : ''}goods ${this.peso(out.toPrincipal)}. ${out.closed ? 'The invoice is fully paid.' : `Still due ${this.peso(left.totalDue)}.`}`, link: this.link(out.inv.id) });
    return this.get(user, id);
  }

  // ── Owner waives charges ──
  async waive(user: SessionUser, id: string, input: { amount?: number; reason: string }) {
    if (!input.reason?.trim()) throw new BadRequestException('Give the reason');
    const res = await this.prisma.db.$transaction(async (tx) => {
      const inv0 = await tx.franchiseInvoice.findUnique({ where: { id } });
      if (!inv0) throw new NotFoundException();
      const inv = await this.settle(tx, inv0);
      const p = FranchiseArService.project(inv, await this.rules(), todayManila());
      const amt = input.amount != null ? r2(input.amount) : p.chargesDue;
      if (!(amt.gt(0))) throw new BadRequestException('There are no penalty or interest to waive');
      if (amt.gt(p.chargesDue)) throw new BadRequestException(`Only ${this.peso(p.chargesDue)} of penalty and interest is unpaid`);
      const fromInterest = Prisma.Decimal.min(amt, p.interestDue); const fromPenalty = amt.minus(fromInterest);
      const upd = await tx.franchiseInvoice.update({ where: { id }, data: { interest: D(inv.interest).minus(fromInterest).toFixed(2), penalty: D(inv.penalty).minus(fromPenalty).toFixed(2), waivedTotal: D(inv.waivedTotal).plus(amt).toFixed(2) } });
      await tx.franchiseArAdjustment.create({ data: { invoiceId: id, kind: 'WAIVER', delta: amt.negated().toFixed(2), reason: input.reason.trim(), createdBy: user.id } });
      return { upd, amt };
    });
    await this.audit.log({ action: 'WAIVE', entityType: 'FranchiseInvoice', entityId: id, after: { amount: res.amt.toFixed(2), reason: input.reason } });
    await this.tell(res.upd.franchiseLocationId, { type: 'FRANCHISE_AR_WAIVED', title: `${user.fullName} waived ${this.peso(res.amt)} of penalty and interest on ${res.upd.controlNo}`, body: input.reason.trim(), link: this.link(id) });
    return this.get(user, id);
  }

  // ── extension requests ──
  async requestExtension(user: SessionUser, id: string, input: { requestedDueDate: string; reason: string }) {
    const inv = await this.prisma.db.franchiseInvoice.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException();
    const loc = await this.scopeLocation(user, inv.franchiseLocationId);
    if (user.roleKey !== 'FRANCHISE_OWNER' && !user.permissions.has('franchise.ar.manage')) throw new ForbiddenException('Only the franchise owner asks for an extension');
    void loc;
    if (inv.status !== 'OPEN') throw new BadRequestException('This invoice is already settled');
    if (!input.reason?.trim() || input.reason.trim().length < 5) throw new BadRequestException('Give the reason for the extension');
    const requested = toDateOnly(input.requestedDueDate);
    if (requested <= inv.dueDate) throw new BadRequestException(`The new date must be after the current due date ${dateStr(inv.dueDate)}`);
    if (await this.prisma.db.franchiseArExtension.findFirst({ where: { invoiceId: id, status: 'PENDING' } })) throw new BadRequestException('An extension request for this invoice is already waiting for the Owner');
    const ext = await this.prisma.db.franchiseArExtension.create({ data: { invoiceId: id, requestedBy: user.id, reason: input.reason.trim(), previousDueDate: inv.dueDate, requestedDueDate: requested } });
    const franchise = await this.franchise(inv.franchiseLocationId);
    const p = FranchiseArService.project(inv, await this.rules(), todayManila());
    const req = await this.approvals.request({ type: 'FRANCHISE_AR_EXTENSION', documentType: 'FranchiseArExtension', documentId: ext.id, requestedBy: user.id, summary: { controlNo: `Extension for ${inv.controlNo}`, locationId: inv.franchiseLocationId, locationName: franchise.name, total: p.totalDue.toFixed(2), currentDueDate: dateStr(inv.dueDate), requestedDueDate: dateStr(requested), daysOverdue: p.daysOverdue, chargesSoFar: p.chargesDue.toFixed(2), reason: ext.reason, step: 'Approve = the due date moves; penalty and interest stop until then (charges already added stay unless waived)' } });
    await this.prisma.db.franchiseArExtension.update({ where: { id: ext.id }, data: { approvalRequestId: req.id } });
    await this.audit.log({ action: 'REQUEST', entityType: 'FranchiseArExtension', entityId: ext.id, after: ext });
    await this.tell(inv.franchiseLocationId, { type: 'FRANCHISE_AR_EXTENSION', title: `⚑ ${franchise.name} asks to move the due date of ${inv.controlNo} from ${dateStr(inv.dueDate)} to ${dateStr(requested)}`, body: `${ext.reason} · due now ${this.peso(p.totalDue)}${p.daysOverdue ? ` · ${p.daysOverdue} days overdue` : ''}. The Owner decides.`, link: this.link(id) });
    return this.get(user, id);
  }
  private async onExtension(extId: string, outcome: 'APPROVED' | 'REJECTED', actor: { id: string; note?: string } | null) {
    await requestContext.runSystem(async () => {
      const ext = await this.prisma.db.franchiseArExtension.findUnique({ where: { id: extId } });
      if (!ext || ext.status !== 'PENDING') return;
      const who = actor ? (await this.prisma.db.user.findUnique({ where: { id: actor.id }, select: { fullName: true } }))?.fullName ?? '' : 'the Owner';
      if (outcome === 'REJECTED') {
        await this.prisma.db.franchiseArExtension.update({ where: { id: extId }, data: { status: 'REJECTED', decidedBy: actor?.id ?? null, decidedAt: new Date(), decisionNote: actor?.note ?? null } });
        const inv = await this.prisma.db.franchiseInvoice.findUniqueOrThrow({ where: { id: ext.invoiceId } });
        await this.tell(inv.franchiseLocationId, { type: 'FRANCHISE_AR_EXTENSION_DECIDED', title: `Extension refused for ${inv.controlNo} by ${who}: the due date stays ${dateStr(inv.dueDate)}`, body: actor?.note, link: this.link(inv.id) });
        return;
      }
      const inv = await this.prisma.db.$transaction(async (tx) => {
        const cur = await tx.franchiseInvoice.findUniqueOrThrow({ where: { id: ext.invoiceId } });
        const settled = await this.settle(tx, cur);
        const newDue = ext.requestedDueDate;
        const upd = await tx.franchiseInvoice.update({ where: { id: cur.id }, data: { dueDate: newDue, interestThrough: !settled.interestThrough || settled.interestThrough < newDue ? newDue : settled.interestThrough } });
        await tx.franchiseArAdjustment.create({ data: { invoiceId: cur.id, kind: 'EXTENSION', delta: '0', reason: `Due date moved from ${dateStr(ext.previousDueDate)} to ${dateStr(newDue)}: ${ext.reason}`, createdBy: actor?.id ?? null } });
        await tx.franchiseArExtension.update({ where: { id: extId }, data: { status: 'APPROVED', decidedBy: actor?.id ?? null, decidedAt: new Date(), decisionNote: actor?.note ?? null } });
        return upd;
      });
      await this.tell(inv.franchiseLocationId, { type: 'FRANCHISE_AR_EXTENSION_DECIDED', title: `Extension approved for ${inv.controlNo} by ${who}: new due date ${dateStr(inv.dueDate)}`, body: 'Penalty and interest already added stay unless the Owner waives them; none are added until the new due date passes.', link: this.link(inv.id) });
    });
  }

  // ── credit hold (cash before delivery) ──
  async setCreditHold(user: SessionUser, locationId: string, hold: boolean, note?: string | null) {
    const loc = await this.prisma.db.location.findUnique({ where: { id: locationId } });
    if (!loc || loc.type !== 'FRANCHISE') throw new NotFoundException('Franchise not found');
    await this.prisma.db.location.update({ where: { id: locationId }, data: { creditHold: hold, creditHoldNote: hold ? note?.trim() || null : null } });
    await this.audit.log({ action: 'UPDATE', entityType: 'Location', entityId: locationId, before: { creditHold: loc.creditHold }, after: { creditHold: hold, note } });
    await this.tell(locationId, { type: 'FRANCHISE_CREDIT_HOLD', title: hold ? `${loc.name} is now on cash-before-delivery (credit suspended) by ${user.fullName}` : `Credit restored for ${loc.name} by ${user.fullName}`, body: hold ? note ?? 'Goods are released only after payment is received.' : undefined, link: '/franchise-ar' });
    return { locationId, creditHold: hold };
  }

  // ── daily job: penalty notices, reminders, two-month flag ──
  async runDaily(now = todayManila()) {
    const rules = await this.rules();
    const open = await this.prisma.db.franchiseInvoice.findMany({ where: { status: 'OPEN' } });
    let penalised = 0, reminded = 0, flagged = 0;
    for (const inv of open) {
      const unpaid = D(inv.amount).minus(inv.principalPaid);
      if (unpaid.lte(0)) continue;
      const p = FranchiseArService.project(inv, rules, now);
      const name = (await this.franchise(inv.franchiseLocationId)).name;
      if (!inv.penaltyAppliedOn && p.penaltyAppliedOn) {
        await this.prisma.db.$transaction((tx) => this.settle(tx, inv, now));
        await this.tell(inv.franchiseLocationId, { type: 'FRANCHISE_PENALTY', title: `${name}: ${inv.controlNo} is overdue. A 2% penalty (${this.peso(p.penalty)}) was added; 0.1% a day is now added on ${this.peso(p.unpaid)}`, body: `Due ${dateStr(inv.dueDate)}. Total due today ${this.peso(p.totalDue)}. Pay or ask for an extension in Franchise AR.`, link: this.link(inv.id) });
        penalised++;
      } else if (p.daysOverdue > 0 && (!inv.remindedAt || daysBetween(inv.remindedAt, now) >= 7)) {
        await this.prisma.db.franchiseInvoice.update({ where: { id: inv.id }, data: { remindedAt: now } });
        await this.tell(inv.franchiseLocationId, { type: 'FRANCHISE_OVERDUE', title: `${name}: ${inv.controlNo} is ${p.daysOverdue} days overdue. Total due ${this.peso(p.totalDue)} (penalty and interest ${this.peso(p.chargesDue)})`, link: this.link(inv.id) });
        reminded++;
      } else if (p.daysOverdue === 0 && daysBetween(now, toDateOnly(inv.dueDate)) <= rules.remindDaysBefore && daysBetween(now, toDateOnly(inv.dueDate)) >= 0 && !inv.remindedAt) {
        await this.prisma.db.franchiseInvoice.update({ where: { id: inv.id }, data: { remindedAt: now } });
        await this.tell(inv.franchiseLocationId, { type: 'FRANCHISE_DUE_SOON', title: `${name}: ${inv.controlNo} of ${this.peso(p.unpaid)} is due on ${dateStr(inv.dueDate)}`, body: 'After the due date a 2% penalty and 0.1% a day apply.', link: this.link(inv.id) });
        reminded++;
      }
      if (p.daysOverdue >= rules.flagDays && !inv.flaggedAt) {
        await this.prisma.db.franchiseInvoice.update({ where: { id: inv.id }, data: { flaggedAt: new Date() } });
        await this.tell(inv.franchiseLocationId, { type: 'FRANCHISE_AR_FLAGGED', title: `⚑ ${name}: ${inv.controlNo} is unpaid ${p.daysOverdue} days after the due date (two months). Total due ${this.peso(p.totalDue)}`, body: 'Under the memo the company may: issue a demand / notice, suspend or revoke credit, require cash-before-delivery, or take other action. Recommended: 1) Franchise Coordinator calls the owner and issues a demand memo; 2) the Owner puts the franchise on cash-before-delivery; 3) the Owner decides on further action.', link: this.link(inv.id) });
        flagged++;
      }
    }
    return { penalised, reminded, flagged };
  }
}
