import { BadRequestException, Injectable } from '@nestjs/common';
import { AccountClass, Book, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import type { SessionUser } from '../common/request-context';
import { D } from '../common/money';
import { dateStr, todayManila, toDateOnly } from '../common/manila';
import { LedgerService } from './ledger.service';
import { FinReportsService } from './fin-reports.service';

/** Books the Executive Assistant may post against a main bank account (no revenue, income, inventory or branch accounts). */
export const BANK_ENTRY_GROUPS: Record<string, { label: string; classes: AccountClass[]; book: Book }> = {
  ADVANCES_TO: { label: 'Advances to (employees, officers, others)', classes: ['ADVANCES_TO'], book: 'ADVANCES' },
  ADVANCES_FROM: { label: 'Advances from (owner, others)', classes: ['ADVANCES_FROM'], book: 'ADVANCES' },
  PAYABLES: { label: 'Supplier payables and other liabilities', classes: ['CURRENT_LIABILITY'], book: 'GENERAL' },
  OFFICE_EXPENSE: { label: 'Main office expenses', classes: ['OPEX'], book: 'GASTOS_OPEX' },
  RECEIVABLES: { label: 'Receivables', classes: ['AR'], book: 'GENERAL' },
  FIXED_ASSET: { label: 'Fixed assets / equipment', classes: ['FIXED_ASSET'], book: 'GENERAL' },
  EQUITY: { label: 'Capital / owner', classes: ['EQUITY'], book: 'GENERAL' },
  BANK_TRANSFER: { label: 'Transfer between bank / cash accounts', classes: ['CASH'], book: 'GENERAL' },
};
/** Balance-sheet classes shown per account; inventory is left out because its value is supplier cost. */
const BS_VISIBLE: AccountClass[] = ['CASH', 'AR', 'ADVANCES_TO', 'FIXED_ASSET', 'ACCUM_DEPN', 'CURRENT_LIABILITY', 'ADVANCES_FROM', 'EQUITY'];

/**
 * Executive Assistant (owner request 2026-09-26): records receipts and payments on the main bank accounts, choosing the bank
 * account and the book; sees supplier payables, main office expenses and each balance-sheet account's balance. Branch accounts,
 * revenue, income, inventory and supplier cost stay hidden.
 */
@Injectable()
export class BankEntriesService {
  constructor(private prisma: PrismaService, private ledger: LedgerService, private fin: FinReportsService) {}

  private mainAccounts(classes: AccountClass[]) { return this.prisma.db.account.findMany({ where: { active: true, branchTagId: null, class: { in: classes } }, select: { id: true, code: true, title: true, class: true, paymentAccountType: true }, orderBy: { code: 'asc' } }); }

  async options() {
    // main bank accounts and the company GCash (owner request 2026-09-27)
    const banks = (await this.mainAccounts(['CASH'])).filter((a) => a.paymentAccountType === 'BANK' || a.paymentAccountType === 'GCASH' || /bank|bdo|bpi|metrobank|security|union|landbank|pnb|rcbc|chinabank|gcash/i.test(a.title));
    const groups = [];
    for (const [key, g] of Object.entries(BANK_ENTRY_GROUPS)) groups.push({ key, label: g.label, accounts: await this.mainAccounts(g.classes) });
    return { banks, groups };
  }

  async create(input: { date?: string; bankAccountId: string; direction: 'IN' | 'OUT'; group: string; accountId: string; amount: number; name?: string; reference?: string; remarks?: string }, user: SessionUser) {
    const g = BANK_ENTRY_GROUPS[input.group];
    if (!g) throw new BadRequestException('Choose the book');
    if (!(input.amount > 0)) throw new BadRequestException('The amount must be more than zero');
    const [bank, acct] = await Promise.all([this.prisma.db.account.findUnique({ where: { id: input.bankAccountId } }), this.prisma.db.account.findUnique({ where: { id: input.accountId } })]);
    if (!bank || bank.class !== 'CASH' || bank.branchTagId) throw new BadRequestException('Choose a main bank account');
    if (!acct || acct.branchTagId || !g.classes.includes(acct.class)) throw new BadRequestException(`That account is not in "${g.label}"`);
    if (acct.id === bank.id) throw new BadRequestException('Choose two different accounts');
    const amt = D(input.amount).toNumber();
    const lines = input.direction === 'OUT'
      ? [{ accountId: acct.id, debit: amt, memo: input.remarks }, { accountId: bank.id, credit: amt, memo: input.remarks }]
      : [{ accountId: bank.id, debit: amt, memo: input.remarks }, { accountId: acct.id, credit: amt, memo: input.remarks }];
    const v = await this.ledger.createManual({ date: input.date ?? dateStr(todayManila()), book: g.book, reference: input.reference, remarks: `${input.direction === 'OUT' ? 'Payment from' : 'Receipt to'} ${bank.title}${input.remarks ? ` — ${input.remarks}` : ''}`, name: input.name, lines }, user);
    return this.prisma.db.journalVoucher.update({ where: { id: v.id }, data: { sourceDocumentType: 'BankEntry' }, include: { lines: { include: { account: { select: { code: true, title: true } } } } } });
  }

  async list(q: { from?: string; to?: string }) {
    const rows = await this.prisma.db.journalVoucher.findMany({ where: { voidedAt: null, sourceDocumentType: 'BankEntry', date: q.from || q.to ? { gte: q.from ? toDateOnly(q.from) : undefined, lte: q.to ? toDateOnly(q.to) : undefined } : undefined }, include: { lines: { include: { account: { select: { code: true, title: true } } }, orderBy: { lineNo: 'asc' } } }, orderBy: [{ date: 'desc' }, { voucherNo: 'desc' }], take: 300 });
    const users = await this.prisma.db.user.findMany({ where: { id: { in: rows.map((r) => r.createdBy).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
    return rows.map((r) => ({ ...r, enteredBy: users.find((u) => u.id === r.createdBy)?.fullName ?? null }));
  }

  /** Unpaid supplier receivings (amount due per document only; no product or unit cost). */
  async payables() {
    const rows = await this.fin.apAgeing();
    return rows.map((r) => ({ supplierCode: r.supplierCode, supplierName: r.supplierName, controlNo: r.controlNo, supplierRef: r.supplierRef, docDate: dateStr(r.docDate), dueDate: dateStr(r.dueDate), amountDue: r.total.toFixed(2), daysOverdue: r.daysOverdue }));
  }

  /** Main office expenses (accounts not tagged to a branch). */
  async officeExpenses(q: { from?: string; to?: string }) {
    return this.prisma.db.expenseDoc.findMany({ where: { voidedAt: null, account: { branchTagId: null }, location: { type: { in: ['OFFICE', 'WAREHOUSE'] } }, docDate: q.from || q.to ? { gte: q.from ? toDateOnly(q.from) : undefined, lte: q.to ? toDateOnly(q.to) : undefined } : undefined }, select: { id: true, controlNo: true, docDate: true, payee: true, amount: true, notes: true, account: { select: { code: true, title: true } }, location: { select: { name: true } } }, orderBy: { docDate: 'desc' }, take: 500 });
  }

  /** Balance of each main balance-sheet account as of the year to date (no income statement, no inventory, no branch accounts). */
  async balances(year?: number) {
    const y = year ?? todayManila().getUTCFullYear();
    const m = await this.fin.accountMatrix(y);
    const rows = m.filter((r) => BS_VISIBLE.includes(r.class) && !r.branchTagId).map((r) => ({ id: r.id, code: r.code, title: r.title, class: r.class, beginning: r.beg, movement: r.total, balance: r.beg.plus(r.total) })).filter((r) => !r.beginning.isZero() || !r.movement.isZero());
    const byClass = (cls: AccountClass[]) => rows.filter((r) => cls.includes(r.class)).reduce((s, r) => s.plus(r.balance), new Prisma.Decimal(0));
    return { year: y, rows, totals: { assets: byClass(['CASH', 'AR', 'ADVANCES_TO', 'FIXED_ASSET']).minus(byClass(['ACCUM_DEPN'])), liabilities: byClass(['CURRENT_LIABILITY', 'ADVANCES_FROM']), equity: byClass(['EQUITY']) }, note: 'Inventory and income accounts are not shown.' };
  }
}
