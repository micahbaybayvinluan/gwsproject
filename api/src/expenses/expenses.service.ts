import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PaidFrom, Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../common/prisma.service';
import { SequenceService } from '../common/sequence.service';
import { AuditService } from '../common/audit.service';
import { AccountsService } from '../gl/accounts.service';
import { PostingService } from '../gl/posting.service';
import { r10Deposit, r10Expense, r10ExpenseAdvance } from '../gl/posting-rules';
import { ApprovalsService } from '../approvals/approvals.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { CashOnHandService } from '../closing/cash-on-hand.service';
import { ClosingService } from '../closing/closing.service';
import { CashFundService } from '../cashfund/cashfund.service';
import { ScopeService } from '../common/scope.service';
import { DepositVerificationService } from './deposit-verification.service';
import { dateStr, toDateOnly, todayManila } from '../common/manila';
import { D } from '../common/money';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';

type ChangeSummary = { change?: 'EDIT' | 'VOID'; accountId?: string; amount?: number; payee?: string | null; notes?: string | null; reason?: string };

/** §8.6 Branch expenses (associates), main expenses (accounting), franchise-local expenses, cash deposits. */
@Injectable()
export class ExpensesService implements OnModuleInit {
  constructor(private cashOnHand: CashOnHandService, private prisma: PrismaService, private seq: SequenceService, private audit: AuditService, private accounts: AccountsService, private posting: PostingService, private attachments: AttachmentsService, private closing: ClosingService, private scope: ScopeService, private cashFund: CashFundService, private depositVerification: DepositVerificationService, private approvals: ApprovalsService, private notify: NotificationsService) {}
  onModuleInit() { this.approvals.register('EXPENSE_EDIT', (req, outcome, actor) => this.onChangeDecision(req.documentId, req.requestedBy, (req.summary ?? {}) as ChangeSummary, outcome, actor?.id ?? null), 'ExpenseDoc'); }

  accountsFor(user: SessionUser, locationId?: string) {
    if (user.permissions.has('expense.create.main') && !locationId) return this.accounts.mainExpenseAccounts();
    const loc = locationId ?? user.locationIds[0];
    if (!loc) throw new BadRequestException('locationId required');
    if (user.locationScoped && !user.locationIds.includes(loc)) throw new ForbiddenException();
    return this.accounts.branchExpenseAccounts(loc, user.permissions.has('expense.create.main'));
  }

  /** Where the money came from, by the name people pick it by: the cash fund's own name (the same as in the Cash Fund screens), the bank / owner-advance account title from the chart of accounts, or Cash on hand. */
  private async withPaidFromLabel<T extends { paidFrom: string; cashFundId: string | null; locationId: string; paidFromAccount?: { title: string } | null }>(rows: T[]) {
    const ids = [...new Set(rows.map((r) => r.cashFundId).filter((x): x is string => !!x))];
    const funds = new Map((ids.length ? await this.prisma.db.cashFund.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []).map((f) => [f.id, f.name]));
    return rows.map((r) => ({ ...r, paidFromLabel: r.paidFrom === 'CASH_DRAWER' ? 'Cash on hand' : r.paidFrom === 'PETTY_CASH' ? (r.cashFundId ? funds.get(r.cashFundId) : null) ?? r.paidFromAccount?.title ?? 'Cash fund' : r.paidFromAccount?.title ?? (r.paidFrom === 'OWNER_ADVANCE' ? 'Owner advance' : 'Bank account') }));
  }

  async list(user: SessionUser, q: { locationId?: string; from?: string; to?: string; main?: boolean }) {
    const where: Prisma.ExpenseDocWhereInput = { voidedAt: null, isMain: q.main, locationId: this.scope.locationFilter(user, q.locationId) as never, docDate: q.from || q.to ? { gte: q.from ? toDateOnly(q.from) : undefined, lte: q.to ? toDateOnly(q.to) : undefined } : undefined };
    return this.withPaidFromLabel(await this.prisma.db.expenseDoc.findMany({ where, include: { account: { select: { id: true, code: true, title: true } }, paidFromAccount: { select: { id: true, title: true } }, location: { select: { code: true, name: true, type: true } } }, orderBy: [{ docDate: 'desc' }, { createdAt: 'desc' }], take: 500 }));
  }
  async get(id: string, user: SessionUser) { const d = await this.prisma.db.expenseDoc.findUnique({ where: { id }, include: { account: true, paidFromAccount: true, location: true } }); if (!d) throw new NotFoundException(); if (user.locationScoped && !user.locationIds.includes(d.locationId)) throw new ForbiddenException(); return { ...(await this.withPaidFromLabel([d]))[0], attachments: await this.attachments.list('ExpenseDoc', id) }; }

  async create(input: { locationId?: string; docDate?: string; accountId: string; payee?: string; amount: number; paidFrom: PaidFrom; paidFromAccountId?: string | null; cashFundId?: string | null; salesDocId?: string | null; notes?: string; forLiquidation?: boolean; liableEmployeeId?: string | null }, user: SessionUser) {
    const account = await this.accounts.get(input.accountId);
    const isMain = account.entryScope === 'MAIN' || (account.entryScope === 'BOTH' && !account.branchTagId);
    if (isMain && !user.permissions.has('expense.create.main')) throw new ForbiddenException('This is a main/office expense account');
    if (account.class === 'DIRECT_COST' && !user.permissions.has('expense.create.main')) throw new ForbiddenException('Direct cost is posted automatically from sales; only Accounting can enter it manually');
    const locationId = input.locationId ?? account.branchTagId ?? user.locationIds[0] ?? (await this.prisma.db.location.findFirstOrThrow({ where: { code: 'OFFICE' } })).id;
    if (user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException();
    if (!isMain && account.branchTagId && account.branchTagId !== locationId) throw new BadRequestException('Expense account belongs to another branch');
    if (input.amount <= 0) throw new BadRequestException('Amount must be positive');
    // warehouse staff pay the warehouse's expenses from its cash fund too (owner request 2026-10-15; they only spend it, the fund is replenished by those who hold cashfund.use)
    if ((input.paidFrom === 'BANK_ACCOUNT' || input.paidFrom === 'OWNER_ADVANCE') && !input.paidFromAccountId) throw new BadRequestException('paidFromAccountId required');
    const docDate = input.docDate ? toDateOnly(input.docDate) : todayManila();
    if (!isMain && (await this.closing.isClosed(locationId, docDate)) && !user.permissions.has('sale.edit.postclose')) throw new BadRequestException({ message: 'Day is closed; request a post-close edit', code: 'DAY_CLOSED' });
    await this.posting.assertPeriodOpen(null, docDate);
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: locationId } });
    // paid from the cash on hand (sales cash not yet deposited): only as much as the branch actually has (owner request 2026-09-29)
    if (input.paidFrom === 'CASH_DRAWER' && !isMain && loc.type !== 'FRANCHISE') {
      const available = D((await this.cashOnHand.forBranch(locationId)).cashOnHand);
      if (available.lt(input.amount)) throw new BadRequestException({ code: 'NO_CASH_ON_HAND', available: available.toFixed(2), message: available.lte(0) ? `${loc.name} has no cash on hand, so this expense cannot be paid from it. Pay it from the cash fund (petty cash) or ask Accounting to pay it from the bank.` : `${loc.name} has only ₱${available.toFixed(2)} cash on hand, less than this expense (₱${input.amount.toFixed(2)}). Pay it from the cash fund (petty cash) or ask Accounting to pay it from the bank.` });
    }
    // paid from a cash fund: which fund, and (Warehouse – Franchise) the franchise DR the money was spent for
    let fund: Awaited<ReturnType<CashFundService['resolveForExpense']>> | null = null;
    if (input.paidFrom === 'PETTY_CASH' && !isMain) fund = await this.cashFund.resolveForExpense(user, locationId, input.cashFundId);
    if (input.salesDocId) {
      if (fund?.purpose !== 'FRANCHISE') throw new BadRequestException('A franchise DR can be tied to an expense only when it is paid from the Warehouse – Franchise cash fund');
      const dr = await requestContext.runSystem(async () => await this.prisma.db.salesDoc.findUnique({ where: { id: input.salesDocId! }, select: { channel: true, locationId: true, voidedAt: true } }));
      if (!dr || dr.channel !== 'FRANCHISE' || dr.locationId !== locationId || dr.voidedAt) throw new BadRequestException('Choose a franchise DR sent from this warehouse');
    }
    // "For liquidation": cash given out before the final amount / receipt is known; a person is liable until it is liquidated
    let liable: { id: string; fullName: string; userId: string | null } | null = null;
    if (input.forLiquidation) {
      if (input.paidFrom !== 'PETTY_CASH' || isMain || !fund) throw new BadRequestException('"For liquidation" is for money given out of a cash fund');
      if (!input.liableEmployeeId) throw new BadRequestException('Choose the person liable for this money: they liquidate it with the receipt');
      liable = await this.prisma.db.employee.findFirst({ where: { id: input.liableEmployeeId, active: true }, select: { id: true, fullName: true, userId: true } });
      if (!liable) throw new BadRequestException('The person liable was not found');
    }
    const doc = await this.prisma.db.$transaction((tx) => this.insert(tx, { locationId, docDate, account, isMain, payee: input.payee, amount: input.amount, paidFrom: input.paidFrom, paidFromAccountId: input.paidFromAccountId, notes: input.notes, userId: user.id, cashFundId: fund?.id ?? null, salesDocId: input.salesDocId ?? null, liable }));
    if (liable) await this.notify.toUsers([...(liable.userId ? [liable.userId] : [])], { type: 'EXPENSE_FOR_LIQUIDATION', title: `${doc.controlNo}: ₱${input.amount.toFixed(2)} was given to you for liquidation (${account.title}). Give the receipt and the change to the warehouse so it can be finalized.`, link: '/expenses' });
    await this.audit.log({ action: 'CREATE', entityType: 'ExpenseDoc', entityId: doc.id, after: doc });
    return doc;
  }

  /** Writes the expense, the cash fund spend (when paid from the fund) and its journal entry inside the caller's transaction. */
  async insert(tx: Tx, e: { locationId: string; docDate: Date; account: { id: string; title: string }; isMain: boolean; payee?: string; amount: number; paidFrom: PaidFrom; paidFromAccountId?: string | null; cashFundId?: string | null; salesDocId?: string | null; notes?: string; userId: string; liable?: { id: string; fullName: string } | null }) {
    const controlNo = await this.seq.form(tx, 'EX', e.locationId);
    const d = await tx.expenseDoc.create({ data: { controlNo, docDate: e.docDate, locationId: e.locationId, accountId: e.account.id, payee: e.payee, amount: D(e.amount).toFixed(2), paidFrom: e.paidFrom, paidFromAccountId: e.paidFromAccountId ?? null, notes: e.notes, preparedBy: e.userId, createdBy: e.userId, isMain: e.isMain, ...(e.liable ? { forLiquidation: true, liableEmployeeId: e.liable.id, liableName: e.liable.fullName } : {}) } });
    // paid from the branch cash fund: the fund balance goes down (it is topped back up from cash sales)
    let fundAccountId: string | null = null;
    if (e.paidFrom === 'PETTY_CASH' && !e.isMain) {
      const f = await this.cashFund.spend(tx, { locationId: e.locationId, fundId: e.cashFundId, salesDocId: e.salesDocId, amount: e.amount, expenseDocId: d.id, businessDate: e.docDate, createdBy: e.userId, notes: `${e.account.title}${e.payee ? ` – ${e.payee}` : ''}` });
      fundAccountId = f.accountId; await tx.expenseDoc.update({ where: { id: d.id }, data: { cashFundId: f.id, salesDocId: e.salesDocId ?? null } });
    }
    if (e.liable) {
      const adv = await this.accounts.ensureGlobal('ADV_LIQUIDATION', e.userId, tx);
      await this.posting.post(tx, { type: 'ExpenseDoc', id: d.id, date: e.docDate, name: e.liable.fullName, createdBy: e.userId }, (r) => r10ExpenseAdvance(r, { locationId: e.locationId, amount: e.amount, advanceAccountId: adv.id, fundAccountId, controlNo, payee: e.liable!.fullName }));
      return d;
    }
    await this.posting.post(tx, { type: 'ExpenseDoc', id: d.id, date: e.docDate, name: e.payee, createdBy: e.userId }, (r) => r10Expense(r, { locationId: e.locationId, expenseAccountId: e.account.id, amount: e.amount, paidFrom: e.paidFrom, paidFromAccountId: e.paidFromAccountId, fundAccountId, controlNo, payee: e.payee }));
    return d;
  }

  /**
   * Incentive paid out of a sale's cash (owner request 2026-09-27): a branch expense on the branch's Incentives account
   * (or Rider/Driver Incentive), paid from the cash drawer, so it lowers the cash to deposit and shows as the branch's expense.
   */
  async saleIncentive(tx: Tx, e: { locationId: string; docDate: Date; kind: 'SALES' | 'RIDER'; payee: string; amount: number; drSiNo: string; userId: string }) {
    const account = await this.incentiveAccount(e.locationId, e.kind, tx);
    return this.insert(tx, { locationId: e.locationId, docDate: e.docDate, account, isMain: false, payee: e.payee, amount: e.amount, paidFrom: 'CASH_DRAWER', notes: `Incentive on sale ${e.drSiNo}`, userId: e.userId });
  }

  /** The branch's Incentives (sales) or Rider/Driver Incentive account; a clear message when the branch has none. */
  async incentiveAccount(locationId: string, kind: 'SALES' | 'RIDER', tx: Tx | null = null) {
    const key = kind === 'RIDER' ? 'RIDER_INCENTIVE' : 'INCENTIVES';
    const db = tx ?? this.prisma.db;
    const a = await db.account.findFirst({ where: { branchTagId: locationId, active: true, template: { key } }, select: { id: true, title: true } });
    if (!a) throw new BadRequestException(`This branch has no ${kind === 'RIDER' ? 'Rider/Driver Incentive' : 'Incentives'} account yet. Ask Accounting to add it to the chart of accounts.`);
    return a;
  }

  /** Reverses the expense's live journal entries (a new, opposite entry; the old stays in the books). */
  private async reverseVouchers(tx: Tx, docId: string, reason: string, userId: string) {
    const vouchers = await tx.journalVoucher.findMany({ where: { sourceDocumentType: 'ExpenseDoc', sourceDocumentId: docId, voidedAt: null }, include: { lines: true } });
    for (const v of vouchers) await this.posting.persist(tx, { rule: 'R10', book: v.book, remarks: `Reversal of ${v.voucherNo}: ${reason}`, lines: v.lines.map((l) => ({ accountId: l.accountId, debit: D(l.credit), credit: D(l.debit) })) }, { type: 'ExpenseDoc', id: docId, date: todayManila(), createdBy: userId });
  }

  /** Voids an expense inside the caller's transaction: returns fund money and reverses its journal entry. */
  async voidInTx(tx: Tx, doc: { id: string; locationId: string; amount: Prisma.Decimal; paidFrom: PaidFrom; isMain: boolean }, reason: string, userId: string) {
    await tx.expenseDoc.update({ where: { id: doc.id }, data: { status: 'VOIDED', voidedAt: new Date(), voidedBy: userId, voidReason: reason } });
    if (doc.paidFrom === 'PETTY_CASH' && !doc.isMain) await this.cashFund.unspend(tx, { locationId: doc.locationId, amount: doc.amount, expenseDocId: doc.id, createdBy: userId });
    await this.reverseVouchers(tx, doc.id, reason, userId);
  }

  // ── warehouse cash fund expenses: liquidation, same-day edits, Admin-approved changes (owner request 2026-10-24) ──
  /** Warehouse cash fund expenses follow these rules; branch expenses keep their own post-close edit request. */
  private isWarehouseFundExpense(doc: { paidFrom: PaidFrom; isMain: boolean; location?: { type: string } | null }) { return doc.paidFrom === 'PETTY_CASH' && !doc.isMain && doc.location?.type === 'WAREHOUSE'; }
  private assertMayHandle(user: SessionUser) { if (!(user.permissions.has('expense.create.branch') || user.permissions.has('cashfund.spend') || user.permissions.has('expense.create.main'))) throw new ForbiddenException(); }

  /** Associates change the expense only on the day, with the same cut-off as sales: the day of the entry (of the liquidation for a finalized one) and before the Daily Sales Report is submitted. */
  private async windowOpen(doc: { docDate: Date; liquidatedAt: Date | null; locationId: string }) {
    const base = doc.liquidatedAt ? dateStr(new Date(doc.liquidatedAt.getTime() + 8 * 3600e3)) : dateStr(doc.docDate);
    if (base !== dateStr(todayManila())) return false;
    return !(await this.closing.isClosed(doc.locationId, todayManila()));
  }

  /** The people a cash fund expense can be tagged to ("liable"): the company's active employees. */
  async liablePeople() {
    return requestContext.runSystem(async () => await this.prisma.db.employee.findMany({ where: { active: true }, select: { id: true, fullName: true, position: true, employeeNo: true }, orderBy: { fullName: 'asc' } }));
  }

  /** Rewrites the expense with the new account / amount / payee: the fund and the books follow (old entry reversed, new one posted). */
  private async restate(tx: Tx, doc: { id: string; locationId: string; amount: Prisma.Decimal; paidFrom: PaidFrom; isMain: boolean; accountId: string; payee: string | null; notes: string | null; cashFundId: string | null; salesDocId: string | null; controlNo: string }, patch: { accountId?: string; amount?: number; payee?: string | null; notes?: string | null }, userId: string, liquidate: boolean, why: string) {
    const today = todayManila();
    await this.posting.assertPeriodOpen(tx, today);
    const amount = patch.amount != null ? D(patch.amount) : D(doc.amount);
    if (amount.lte(0)) throw new BadRequestException('Amount must be positive');
    const accountId = patch.accountId ?? doc.accountId;
    const account = await tx.account.findUniqueOrThrow({ where: { id: accountId }, select: { id: true, title: true, entryScope: true, branchTagId: true } });
    if (account.entryScope === 'MAIN' || (account.branchTagId && account.branchTagId !== doc.locationId)) throw new BadRequestException('Choose an expense account of this location');
    const payee = patch.payee !== undefined ? patch.payee : doc.payee;
    await this.reverseVouchers(tx, doc.id, why, userId);
    let fundAccountId: string | null = null;
    if (doc.paidFrom === 'PETTY_CASH' && !doc.isMain) {
      await this.cashFund.unspend(tx, { locationId: doc.locationId, amount: doc.amount, expenseDocId: doc.id, createdBy: userId });
      const f = await this.cashFund.spend(tx, { locationId: doc.locationId, fundId: doc.cashFundId, salesDocId: doc.salesDocId, amount, expenseDocId: doc.id, businessDate: today, createdBy: userId, notes: `${account.title}${payee ? ` – ${payee}` : ''} (${why})` });
      fundAccountId = f.accountId;
    }
    await tx.expenseDoc.update({ where: { id: doc.id }, data: { accountId, amount: amount.toFixed(2), payee, notes: patch.notes !== undefined ? patch.notes : doc.notes, updatedBy: userId, ...(liquidate ? { forLiquidation: false, liquidatedAt: new Date(), liquidatedBy: userId } : {}) } });
    await this.posting.post(tx, { type: 'ExpenseDoc', id: doc.id, date: today, name: payee, createdBy: userId }, (r) => r10Expense(r, { locationId: doc.locationId, expenseAccountId: accountId, amount, paidFrom: doc.paidFrom, fundAccountId, controlNo: doc.controlNo, payee }));
  }

  /** The person liable brings the receipt: editing the "for liquidation" expense with its final amount finalizes it as an expense (the fund gets back or pays the difference). */
  async liquidate(id: string, input: { amount: number; accountId?: string; payee?: string | null; notes?: string | null }, user: SessionUser) {
    this.assertMayHandle(user);
    const doc = await this.get(id, user);
    if (doc.voidedAt) throw new BadRequestException('This expense was voided');
    if (!doc.forLiquidation) throw new BadRequestException('This expense is already final');
    await this.prisma.db.$transaction((tx) => this.restate(tx, doc, input, user.id, true, 'liquidated'));
    await this.audit.log({ action: 'LIQUIDATE', entityType: 'ExpenseDoc', entityId: id, before: { amount: doc.amount, accountId: doc.accountId }, after: input });
    return this.get(id, user);
  }

  /** Change a warehouse cash fund expense: the associate on the day (before the cut-off); after that, or for a void, the Owner approves. */
  async edit(id: string, input: { accountId?: string; amount?: number; payee?: string | null; notes?: string | null; reason?: string }, user: SessionUser) {
    this.assertMayHandle(user);
    const doc = await this.get(id, user);
    if (doc.voidedAt) throw new BadRequestException('This expense was voided');
    if (!this.isWarehouseFundExpense(doc)) throw new BadRequestException('Only warehouse cash fund expenses are changed here; other expenses use the post-close edit request');
    if (doc.forLiquidation) throw new BadRequestException('This expense is for liquidation: edit it with the final amount to liquidate it');
    if (user.roleKey === 'ADMIN' || (await this.windowOpen(doc))) {
      await this.prisma.db.$transaction((tx) => this.restate(tx, doc, input, user.id, false, input.reason?.trim() || 'edited'));
      await this.audit.log({ action: 'EDIT', entityType: 'ExpenseDoc', entityId: id, before: { amount: doc.amount, accountId: doc.accountId, payee: doc.payee }, after: input });
      return { applied: true, expense: await this.get(id, user) };
    }
    return this.askAdmin(doc, { change: 'EDIT', ...input }, user);
  }

  private async askAdmin(doc: { id: string; controlNo: string; amount: Prisma.Decimal; location?: { name: string } | null }, change: ChangeSummary, user: SessionUser) {
    if (!change.reason || change.reason.trim().length < 3) throw new BadRequestException('Say why this needs to change (the Owner approves it)');
    const req = await this.approvals.request({ type: 'EXPENSE_EDIT', documentType: 'ExpenseDoc', documentId: doc.id, requestedBy: user.id, summary: { ...change, controlNo: doc.controlNo, locationName: doc.location?.name ?? '', currentAmount: D(doc.amount).toFixed(2), requestedBy: user.fullName } });
    await this.audit.log({ action: 'EXPENSE_CHANGE_REQUESTED', entityType: 'ExpenseDoc', entityId: doc.id, after: change });
    return { applied: false, requested: true, approvalId: (req as { id?: string } | null)?.id ?? null, message: 'The day is closed for this expense, so the Owner has to approve the change. You will be told.' };
  }

  private async onChangeDecision(docId: string, requesterId: string, c: ChangeSummary, outcome: 'APPROVED' | 'REJECTED', actorId: string | null) {
    await requestContext.runSystem(async () => {
      const doc = await this.prisma.db.expenseDoc.findUnique({ where: { id: docId } });
      if (!doc) return;
      if (outcome === 'APPROVED' && !doc.voidedAt) {
        const by = actorId ?? requesterId;
        await this.prisma.db.$transaction(async (tx) => {
          if (c.change === 'VOID') await this.voidInTx(tx, doc, c.reason ?? 'approved void', by);
          else await this.restate(tx, doc, { accountId: c.accountId, amount: c.amount, payee: c.payee, notes: c.notes }, by, false, c.reason ?? 'approved change');
        });
        await this.audit.log({ action: c.change === 'VOID' ? 'VOID' : 'EDIT', entityType: 'ExpenseDoc', entityId: docId, after: { ...c, approvedBy: actorId } });
      }
      await this.notify.toUsers([requesterId], { type: 'EXPENSE_CHANGE_DECIDED', title: `Your ${c.change === 'VOID' ? 'void' : 'change'} of expense ${doc.controlNo} was ${outcome === 'APPROVED' ? 'approved and applied' : 'not approved'}`, link: '/expenses' });
    });
  }
  async void(id: string, reason: string, user: SessionUser) {
    const doc = await this.get(id, user);
    if (doc.voidedAt) throw new BadRequestException('Already voided');
    if (this.isWarehouseFundExpense(doc) && user.roleKey !== 'ADMIN' && !(await this.windowOpen(doc))) return this.askAdmin(doc, { change: 'VOID', reason }, user);
    if (!this.isWarehouseFundExpense(doc) && await this.closing.isClosed(doc.locationId, doc.docDate) && !user.permissions.has('sale.edit.postclose')) throw new BadRequestException({ message: 'Day is closed', code: 'DAY_CLOSED' });
    await this.posting.assertPeriodOpen(null, doc.docDate);
    if (await requestContext.runSystem(async () => await this.prisma.db.salesDoc.findFirst({ where: { incentiveExpenseId: id, voidedAt: null }, select: { id: true } }))) throw new BadRequestException('This is the incentive of a sale; void the sale instead');
    await this.prisma.db.$transaction((tx) => this.voidInTx(tx, doc, reason, user.id));
    await this.audit.log({ action: 'VOID', entityType: 'ExpenseDoc', entityId: id, before: doc, after: { reason } });
    return this.get(id, user);
  }

  // Franchise-local expenses (never post to company GL)
  franchiseList(user: SessionUser, locationId?: string) { const loc = locationId ?? user.locationIds[0]; if (user.locationScoped && !user.locationIds.includes(loc)) throw new ForbiddenException(); return this.prisma.db.franchiseExpense.findMany({ where: { locationId: loc, voidedAt: null }, orderBy: { docDate: 'desc' } }); }
  franchiseCreate(input: { locationId?: string; docDate?: string; category: string; payee?: string; amount: number; notes?: string }, user: SessionUser) {
    const locationId = input.locationId ?? user.locationIds[0]; if (user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException();
    return this.prisma.db.franchiseExpense.create({ data: { locationId, docDate: input.docDate ? toDateOnly(input.docDate) : todayManila(), category: input.category, payee: input.payee, amount: D(input.amount).toFixed(2), notes: input.notes, createdBy: user.id } });
  }

  /** §8.4 cash deposit → R10 deposit entry. The bank deposit slip is required; the Audit Associate then the Accounting Associate verify it (owner request 2026-09-30). */
  async deposit(input: { locationId?: string; businessDate: string; amount: number; bankAccountId: string; depositedAt: string; slipAttachmentId?: string | null }, user: SessionUser) {
    const locationId = input.locationId ?? user.locationIds[0]; if (user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException();
    if (!input.slipAttachmentId) throw new BadRequestException({ message: 'Attach the bank deposit slip: the Audit Associate and the Accounting Associate check it', code: 'SLIP_REQUIRED' });
    const att = await this.prisma.db.attachment.findUnique({ where: { id: input.slipAttachmentId }, select: { id: true } });
    if (!att) throw new BadRequestException('The deposit slip was not found; upload it again');
    const d = await this.prisma.db.$transaction(async (tx) => {
      const d = await tx.cashDeposit.create({ data: { locationId, businessDate: toDateOnly(input.businessDate), amount: D(input.amount).toFixed(2), bankAccountId: input.bankAccountId, depositedAt: toDateOnly(input.depositedAt), slipAttachmentId: input.slipAttachmentId ?? null, createdBy: user.id } });
      await this.posting.post(tx, { type: 'CashDeposit', id: d.id, date: toDateOnly(input.depositedAt), createdBy: user.id }, (r) => r10Deposit(r, { locationId, bankAccountId: input.bankAccountId, amount: input.amount, ref: input.businessDate }));
      return d;
    });
    await this.depositVerification.requestAudit(d.id, user.id);
    return this.prisma.db.cashDeposit.findUniqueOrThrow({ where: { id: d.id } });
  }
  async deposits(user: SessionUser, locationId?: string) {
    const rows = await this.prisma.db.cashDeposit.findMany({ where: { locationId: locationId ?? (user.locationScoped ? { in: user.locationIds } : undefined) }, include: { bankAccount: { select: { title: true } } }, orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }], take: 200 });
    const ids = [...new Set(rows.flatMap((r) => [r.createdBy, r.auditVerifiedBy, r.accountingVerifiedBy, r.rejectedBy]).filter((x): x is string => !!x))];
    const names = await this.prisma.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
    const nm = (id: string | null) => (id ? names.find((n) => n.id === id)?.fullName ?? '' : null);
    const slips = await this.prisma.db.attachment.findMany({ where: { id: { in: rows.map((r) => r.slipAttachmentId).filter((x): x is string => !!x) } }, select: { id: true, fileName: true, contentType: true } });
    const locs = await this.prisma.db.location.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.locationId))] } }, select: { id: true, name: true } });
    return rows.map((r) => ({ ...r, slip: slips.find((s) => s.id === r.slipAttachmentId) ?? null, branch: locs.find((l) => l.id === r.locationId)?.name ?? '', enteredBy: nm(r.createdBy), auditVerifiedByName: nm(r.auditVerifiedBy), accountingVerifiedByName: nm(r.accountingVerifiedBy), rejectedByName: nm(r.rejectedBy) }));
  }
  review(id: string) { return this.depositVerification.review(id); }
  resubmit(id: string, input: { slipAttachmentId?: string | null; note?: string }, user: SessionUser) { return this.depositVerification.resubmit(id, input, user); }
}
