import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Book, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { PostingService } from './posting.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuditService } from '../common/audit.service';
import { SettingsService } from '../common/settings.service';
import { toDateOnly, todayManila } from '../common/manila';
import { D, ZERO } from '../common/money';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';

/** §10.3 Journals, manual vouchers, period lock, beginning balances. */
@Injectable()
export class LedgerService implements OnModuleInit {
  constructor(private prisma: PrismaService, private posting: PostingService, private approvals: ApprovalsService, private audit: AuditService, private settings: SettingsService) {}

  onModuleInit() {
    this.approvals.register('PERIOD_LOCK', (req, outcome) => this.onPeriodDecision(req.documentId, outcome, true));
    this.approvals.register('PERIOD_UNLOCK', (req, outcome) => this.onPeriodDecision(req.documentId, outcome, false));
    this.approvals.register('BEGINNING_BALANCE', (req, outcome, actor) => this.onBeginningBalanceDecision(Number(req.documentId), outcome, actor?.id ?? null));
  }

  vouchers(q: { from?: string; to?: string; book?: string; accountId?: string; sourceType?: string; sourceId?: string; take?: number }) {
    return this.prisma.db.journalVoucher.findMany({
      where: { voidedAt: null, book: q.book as Book | undefined, date: q.from || q.to ? { gte: q.from ? toDateOnly(q.from) : undefined, lte: q.to ? toDateOnly(q.to) : undefined } : undefined, sourceDocumentType: q.sourceType, sourceDocumentId: q.sourceId, lines: q.accountId ? { some: { accountId: q.accountId } } : undefined },
      include: { lines: { include: { account: { select: { code: true, title: true } } }, orderBy: { lineNo: 'asc' } } }, orderBy: [{ date: 'desc' }, { voucherNo: 'desc' }], take: q.take ?? 500,
    });
  }
  async voucher(id: string) { const v = await this.prisma.db.journalVoucher.findUnique({ where: { id }, include: { lines: { include: { account: true }, orderBy: { lineNo: 'asc' } } } }); if (!v) throw new NotFoundException(); return v; }

  async createManual(input: { date: string; book: Book; reference?: string; remarks?: string; name?: string; lines: { accountId: string; debit?: number; credit?: number; memo?: string }[] }, user: SessionUser) {
    const date = toDateOnly(input.date);
    await this.posting.assertPeriodOpen(null, date);
    const dr = input.lines.reduce((s, l) => s.plus(l.debit ?? 0), ZERO); const cr = input.lines.reduce((s, l) => s.plus(l.credit ?? 0), ZERO);
    if (!dr.equals(cr) || dr.isZero()) throw new BadRequestException(`Lines must balance (Dr ${dr} vs Cr ${cr})`);
    const v = await this.prisma.db.$transaction(async (tx) => {
      const voucherNo = await this.posting.nextVoucherNo(tx, 'M', date.getUTCFullYear());
      return tx.journalVoucher.create({ data: { voucherNo, date, book: input.book, reference: input.reference, remarks: input.remarks, name: input.name, createdBy: user.id, lines: { create: input.lines.map((l, i) => ({ lineNo: i + 1, accountId: l.accountId, debit: D(l.debit ?? 0).toFixed(2), credit: D(l.credit ?? 0).toFixed(2), memo: l.memo })) } }, include: { lines: true } });
    });
    await this.audit.log({ action: 'CREATE', entityType: 'JournalVoucher', entityId: v.id, after: v });
    return v;
  }
  async reverse(id: string, reason: string, user: SessionUser) {
    const v = await this.voucher(id);
    const date = todayManila();
    await this.posting.assertPeriodOpen(null, date);
    const rev = await this.prisma.db.$transaction(async (tx) => {
      const voucherNo = await this.posting.nextVoucherNo(tx, 'M', date.getUTCFullYear());
      const r = await tx.journalVoucher.create({ data: { voucherNo, date, book: v.book, reference: v.reference, remarks: `Reversal of ${v.voucherNo}: ${reason}`, name: v.name, isReversal: true, reversesVoucherId: v.id, createdBy: user.id, lines: { create: v.lines.map((l, i) => ({ lineNo: i + 1, accountId: l.accountId, debit: l.credit, credit: l.debit, memo: l.memo })) } } });
      return r;
    });
    await this.audit.log({ action: 'REVERSE', entityType: 'JournalVoucher', entityId: id, after: { reversalId: rev.id, reason } });
    return rev;
  }

  /** Account ledger with running balance. */
  async accountLedger(accountId: string, q: { from?: string; to?: string }) {
    const account = await this.prisma.db.account.findUniqueOrThrow({ where: { id: accountId } });
    const from = q.from ? toDateOnly(q.from) : undefined;
    const opening = from ? await this.prisma.db.journalLine.aggregate({ where: { accountId, voucher: { voidedAt: null, date: { lt: from } } }, _sum: { debit: true, credit: true } }) : null;
    const lines = await this.prisma.db.journalLine.findMany({ where: { accountId, voucher: { voidedAt: null, date: { gte: from, lte: q.to ? toDateOnly(q.to) : undefined } } }, include: { voucher: true }, orderBy: [{ voucher: { date: 'asc' } }, { voucher: { voucherNo: 'asc' } }] });
    const sign = account.normalBalance === 'DEBIT' ? 1 : -1;
    let bal = D(opening?._sum.debit ?? 0).minus(opening?._sum.credit ?? 0).mul(sign);
    const opn = bal;
    return { account, openingBalance: opn, rows: lines.map((l) => { bal = bal.plus(D(l.debit).minus(l.credit).mul(sign)); return { date: l.voucher.date, voucherNo: l.voucher.voucherNo, book: l.voucher.book, reference: l.voucher.reference, remarks: l.voucher.remarks, name: l.voucher.name, debit: l.debit, credit: l.credit, balance: bal }; }) };
  }

  // ── Periods ──
  periods(year: number) { return this.prisma.db.accountingPeriod.findMany({ where: { year }, orderBy: { month: 'asc' } }); }
  async requestLock(year: number, month: number, lock: boolean, user: SessionUser) {
    const p = await this.prisma.db.accountingPeriod.upsert({ where: { year_month: { year, month } }, create: { year, month }, update: {} });
    if (p.locked === lock) throw new BadRequestException(`Period already ${lock ? 'locked' : 'open'}`);
    const req = await this.approvals.request({ type: lock ? 'PERIOD_LOCK' : 'PERIOD_UNLOCK', documentType: 'AccountingPeriod', documentId: p.id, requestedBy: user.id, summary: { period: `${year}-${String(month).padStart(2, '0')}`, action: lock ? 'LOCK' : 'UNLOCK' } });
    return this.prisma.db.accountingPeriod.update({ where: { id: p.id }, data: { approvalRequestId: req.id } });
  }
  private async onPeriodDecision(periodId: string, outcome: 'APPROVED' | 'REJECTED', lock: boolean) {
    if (outcome !== 'APPROVED') return;
    await requestContext.runSystem(async () => {
      const p = await this.prisma.db.accountingPeriod.update({ where: { id: periodId }, data: { locked: lock, lockedAt: lock ? new Date() : null } });
      await this.audit.log({ action: lock ? 'PERIOD_LOCK' : 'PERIOD_UNLOCK', entityType: 'AccountingPeriod', entityId: p.id, after: p });
    });
  }

  // ── Beginning balances (§10.3) ──
  async beginningBalances(year: number) {
    const rows = await this.prisma.db.beginningBalance.findMany({ where: { fiscalYear: year }, include: { account: { select: { code: true, title: true, class: true } } }, orderBy: { account: { code: 'asc' } } });
    const dr = rows.reduce((s, r) => s.plus(r.debit), ZERO); const cr = rows.reduce((s, r) => s.plus(r.credit), ZERO);
    return { year, rows, totalDebit: dr, totalCredit: cr, imbalance: dr.minus(cr), posted: rows.some((r) => r.postedVoucherId) };
  }
  async setBeginningBalances(year: number, rows: { accountId: string; debit?: number; credit?: number }[], user: SessionUser) {
    const existing = await this.beginningBalances(year);
    if (existing.posted) throw new BadRequestException('Beginning balances already posted; use a manual voucher');
    await this.prisma.db.$transaction(rows.map((r) => this.prisma.db.beginningBalance.upsert({ where: { fiscalYear_accountId: { fiscalYear: year, accountId: r.accountId } }, create: { fiscalYear: year, accountId: r.accountId, debit: D(r.debit ?? 0).toFixed(2), credit: D(r.credit ?? 0).toFixed(2), createdBy: user.id }, update: { debit: D(r.debit ?? 0).toFixed(2), credit: D(r.credit ?? 0).toFixed(2) } })));
    return this.beginningBalances(year);
  }
  /** Submit for Admin approval; blocked until imbalance = 0. Admin submitting → still goes through the request (Admin approves it). */
  async submitBeginningBalances(year: number, user: SessionUser) {
    const bb = await this.beginningBalances(year);
    if (!bb.imbalance.isZero()) throw new BadRequestException(`Beginning balances do not balance (imbalance ${bb.imbalance})`);
    if (bb.posted) throw new BadRequestException('Already posted');
    const req = await this.approvals.request({ type: 'BEGINNING_BALANCE', documentType: 'BeginningBalance', documentId: String(year), requestedBy: user.id, summary: { year, rows: bb.rows.length, totalDebit: bb.totalDebit.toFixed(2) } });
    await this.prisma.db.beginningBalance.updateMany({ where: { fiscalYear: year }, data: { approvalRequestId: req.id } });
    return req;
  }
  private async onBeginningBalanceDecision(year: number, outcome: 'APPROVED' | 'REJECTED', actorId: string | null) {
    if (outcome !== 'APPROVED') return;
    await requestContext.runSystem(async () => {
      const bb = await this.beginningBalances(year);
      if (bb.posted || !bb.imbalance.isZero()) return;
      const start = toDateOnly(`${year}-01-01`);
      await this.prisma.db.$transaction(async (tx) => {
        const v = await tx.journalVoucher.create({ data: { voucherNo: `OB-${year}`, date: start, book: 'GENERAL', remarks: `Opening balances ${year}`, reference: 'BEGINNING_BALANCE', createdBy: actorId, lines: { create: bb.rows.filter((r) => !r.debit.isZero() || !r.credit.isZero()).map((r, i) => ({ lineNo: i + 1, accountId: r.accountId, debit: r.debit, credit: r.credit })) } } });
        await tx.beginningBalance.updateMany({ where: { fiscalYear: year }, data: { postedVoucherId: v.id } });
      });
    });
  }

  assertFinance(user: SessionUser) { if (!user.permissions.has('gl.view')) throw new ForbiddenException(); }
  async fiscalYear(): Promise<number> { return Number(String(await this.settings.get<string>('fiscal.year_start')).slice(0, 4)); }
}
