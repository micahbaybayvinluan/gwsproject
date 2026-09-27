import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PaidFrom, Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../common/prisma.service';
import { SequenceService } from '../common/sequence.service';
import { AuditService } from '../common/audit.service';
import { AccountsService } from '../gl/accounts.service';
import { PostingService } from '../gl/posting.service';
import { r10Deposit, r10Expense } from '../gl/posting-rules';
import { AttachmentsService } from '../attachments/attachments.service';
import { ClosingService } from '../closing/closing.service';
import { CashFundService } from '../cashfund/cashfund.service';
import { ScopeService } from '../common/scope.service';
import { toDateOnly, todayManila } from '../common/manila';
import { D } from '../common/money';
import type { SessionUser } from '../common/request-context';

/** §8.6 Branch expenses (associates), main expenses (accounting), franchise-local expenses, cash deposits. */
@Injectable()
export class ExpensesService {
  constructor(private prisma: PrismaService, private seq: SequenceService, private audit: AuditService, private accounts: AccountsService, private posting: PostingService, private attachments: AttachmentsService, private closing: ClosingService, private scope: ScopeService, private cashFund: CashFundService) {}

  accountsFor(user: SessionUser, locationId?: string) {
    if (user.permissions.has('expense.create.main') && !locationId) return this.accounts.mainExpenseAccounts();
    const loc = locationId ?? user.locationIds[0];
    if (!loc) throw new BadRequestException('locationId required');
    if (user.locationScoped && !user.locationIds.includes(loc)) throw new ForbiddenException();
    return this.accounts.branchExpenseAccounts(loc, user.permissions.has('expense.create.main'));
  }

  list(user: SessionUser, q: { locationId?: string; from?: string; to?: string; main?: boolean }) {
    const where: Prisma.ExpenseDocWhereInput = { voidedAt: null, isMain: q.main, locationId: this.scope.locationFilter(user, q.locationId) as never, docDate: q.from || q.to ? { gte: q.from ? toDateOnly(q.from) : undefined, lte: q.to ? toDateOnly(q.to) : undefined } : undefined };
    return this.prisma.db.expenseDoc.findMany({ where, include: { account: { select: { id: true, code: true, title: true } }, paidFromAccount: { select: { id: true, title: true } }, location: { select: { code: true, name: true } } }, orderBy: [{ docDate: 'desc' }, { createdAt: 'desc' }], take: 500 });
  }
  async get(id: string, user: SessionUser) { const d = await this.prisma.db.expenseDoc.findUnique({ where: { id }, include: { account: true, paidFromAccount: true, location: true } }); if (!d) throw new NotFoundException(); if (user.locationScoped && !user.locationIds.includes(d.locationId)) throw new ForbiddenException(); return { ...d, attachments: await this.attachments.list('ExpenseDoc', id) }; }

  async create(input: { locationId?: string; docDate?: string; accountId: string; payee?: string; amount: number; paidFrom: PaidFrom; paidFromAccountId?: string | null; notes?: string }, user: SessionUser) {
    const account = await this.accounts.get(input.accountId);
    const isMain = account.entryScope === 'MAIN' || (account.entryScope === 'BOTH' && !account.branchTagId);
    if (isMain && !user.permissions.has('expense.create.main')) throw new ForbiddenException('This is a main/office expense account');
    if (account.class === 'DIRECT_COST' && !user.permissions.has('expense.create.main')) throw new ForbiddenException('Direct cost is posted automatically from sales; only Accounting can enter it manually');
    const locationId = input.locationId ?? account.branchTagId ?? user.locationIds[0] ?? (await this.prisma.db.location.findFirstOrThrow({ where: { code: 'OFFICE' } })).id;
    if (user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException();
    if (!isMain && account.branchTagId && account.branchTagId !== locationId) throw new BadRequestException('Expense account belongs to another branch');
    if (input.amount <= 0) throw new BadRequestException('Amount must be positive');
    if ((input.paidFrom === 'BANK_ACCOUNT' || input.paidFrom === 'OWNER_ADVANCE') && !input.paidFromAccountId) throw new BadRequestException('paidFromAccountId required');
    const docDate = input.docDate ? toDateOnly(input.docDate) : todayManila();
    if (!isMain && (await this.closing.isClosed(locationId, docDate)) && !user.permissions.has('sale.edit.postclose')) throw new BadRequestException({ message: 'Day is closed; request a post-close edit', code: 'DAY_CLOSED' });
    await this.posting.assertPeriodOpen(null, docDate);
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: locationId } });
    const doc = await this.prisma.db.$transaction((tx) => this.insert(tx, { locationId, docDate, account, isMain, payee: input.payee, amount: input.amount, paidFrom: input.paidFrom, paidFromAccountId: input.paidFromAccountId, notes: input.notes, userId: user.id }));
    await this.audit.log({ action: 'CREATE', entityType: 'ExpenseDoc', entityId: doc.id, after: doc });
    return doc;
  }

  /** Writes the expense, the cash fund spend (when paid from the fund) and its journal entry inside the caller's transaction. */
  async insert(tx: Tx, e: { locationId: string; docDate: Date; account: { id: string; title: string }; isMain: boolean; payee?: string; amount: number; paidFrom: PaidFrom; paidFromAccountId?: string | null; notes?: string; userId: string }) {
    const controlNo = await this.seq.form(tx, 'EX', e.locationId);
    const d = await tx.expenseDoc.create({ data: { controlNo, docDate: e.docDate, locationId: e.locationId, accountId: e.account.id, payee: e.payee, amount: D(e.amount).toFixed(2), paidFrom: e.paidFrom, paidFromAccountId: e.paidFromAccountId ?? null, notes: e.notes, preparedBy: e.userId, createdBy: e.userId, isMain: e.isMain } });
    // paid from the branch cash fund: the fund balance goes down (it is topped back up from cash sales)
    if (e.paidFrom === 'PETTY_CASH' && !e.isMain) await this.cashFund.spend(tx, { locationId: e.locationId, amount: e.amount, expenseDocId: d.id, businessDate: e.docDate, createdBy: e.userId, notes: `${e.account.title}${e.payee ? ` – ${e.payee}` : ''}` });
    await this.posting.post(tx, { type: 'ExpenseDoc', id: d.id, date: e.docDate, name: e.payee, createdBy: e.userId }, (r) => r10Expense(r, { locationId: e.locationId, expenseAccountId: e.account.id, amount: e.amount, paidFrom: e.paidFrom, paidFromAccountId: e.paidFromAccountId, controlNo, payee: e.payee }));
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

  /** Voids an expense inside the caller's transaction: returns fund money and reverses its journal entry. */
  async voidInTx(tx: Tx, doc: { id: string; locationId: string; amount: Prisma.Decimal; paidFrom: PaidFrom; isMain: boolean }, reason: string, userId: string) {
    await tx.expenseDoc.update({ where: { id: doc.id }, data: { status: 'VOIDED', voidedAt: new Date(), voidedBy: userId, voidReason: reason } });
    if (doc.paidFrom === 'PETTY_CASH' && !doc.isMain) await this.cashFund.unspend(tx, { locationId: doc.locationId, amount: doc.amount, expenseDocId: doc.id, createdBy: userId });
    const vouchers = await tx.journalVoucher.findMany({ where: { sourceDocumentType: 'ExpenseDoc', sourceDocumentId: doc.id, voidedAt: null }, include: { lines: true } });
    for (const v of vouchers) await this.posting.persist(tx, { rule: 'R10', book: v.book, remarks: `Reversal of ${v.voucherNo}: ${reason}`, lines: v.lines.map((l) => ({ accountId: l.accountId, debit: D(l.credit), credit: D(l.debit) })) }, { type: 'ExpenseDoc', id: doc.id, date: todayManila(), createdBy: userId });
  }
  async void(id: string, reason: string, user: SessionUser) {
    const doc = await this.get(id, user);
    if (doc.voidedAt) throw new BadRequestException('Already voided');
    if (await this.closing.isClosed(doc.locationId, doc.docDate) && !user.permissions.has('sale.edit.postclose')) throw new BadRequestException({ message: 'Day is closed', code: 'DAY_CLOSED' });
    await this.posting.assertPeriodOpen(null, doc.docDate);
    if (await this.prisma.db.salesDoc.findFirst({ where: { incentiveExpenseId: id, voidedAt: null }, select: { id: true } })) throw new BadRequestException('This is the incentive of a sale; void the sale instead');
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

  /** §8.4 cash deposit → R10 deposit entry. */
  async deposit(input: { locationId?: string; businessDate: string; amount: number; bankAccountId: string; depositedAt: string; slipAttachmentId?: string | null }, user: SessionUser) {
    const locationId = input.locationId ?? user.locationIds[0]; if (user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException();
    return this.prisma.db.$transaction(async (tx) => {
      const d = await tx.cashDeposit.create({ data: { locationId, businessDate: toDateOnly(input.businessDate), amount: D(input.amount).toFixed(2), bankAccountId: input.bankAccountId, depositedAt: toDateOnly(input.depositedAt), slipAttachmentId: input.slipAttachmentId ?? null, createdBy: user.id } });
      await this.posting.post(tx, { type: 'CashDeposit', id: d.id, date: toDateOnly(input.depositedAt), createdBy: user.id }, (r) => r10Deposit(r, { locationId, bankAccountId: input.bankAccountId, amount: input.amount, ref: input.businessDate }));
      return d;
    });
  }
  deposits(user: SessionUser, locationId?: string) { const loc = locationId ?? (user.locationScoped ? undefined : undefined); return this.prisma.db.cashDeposit.findMany({ where: { locationId: loc ?? (user.locationScoped ? { in: user.locationIds } : undefined) }, include: { bankAccount: { select: { title: true } } }, orderBy: { businessDate: 'desc' }, take: 200 }); }
}
