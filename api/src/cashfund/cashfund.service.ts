import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { SequenceService } from '../common/sequence.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PostingService } from '../gl/posting.service';
import { ClosingService } from '../closing/closing.service';
import { r10FundReplenish, r10FundSetup } from '../gl/posting-rules';
import { dateStr, toDateOnly, todayManila } from '../common/manila';
import { D, sum, ZERO } from '../common/money';
import type { SessionUser } from '../common/request-context';

/**
 * Branch cash fund (owner request 2026-09-26): a fixed imprest amount kept at the branch; small expenses are paid from it and it is
 * topped back up (replenished) from that day's cash sales, which lowers the cash to deposit. Balances show on the dashboards of Admin,
 * the auditors and Accounting; the Field Auditor counts and confirms the cash actually found in the store.
 */
@Injectable()
export class CashFundService {
  constructor(private prisma: PrismaService, private seq: SequenceService, private audit: AuditService, private notify: NotificationsService, private posting: PostingService, private closing: ClosingService) {}

  private assertLocation(user: SessionUser, locationId: string) { if (user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException('Location outside your assignment'); }
  private canSeeAll(user: SessionUser) { return user.permissions.has('cashfund.view.all') || user.permissions.has('cashfund.check') || user.permissions.has('cashfund.manage'); }

  /** Every fund (for view-all roles) or the user's own branch fund, with spent since last replenishment and the last store check. */
  async list(user: SessionUser) {
    const where: Prisma.CashFundWhereInput = this.canSeeAll(user) && !user.locationScoped ? {} : { locationId: { in: user.locationIds } };
    const funds = await this.prisma.db.cashFund.findMany({ where, include: { location: { select: { id: true, code: true, name: true, type: true } } }, orderBy: { location: { name: 'asc' } } });
    const out = [];
    for (const f of funds) {
      const lastRep = await this.prisma.db.cashFundTxn.findFirst({ where: { fundId: f.id, kind: 'REPLENISH' }, orderBy: { createdAt: 'desc' } });
      const lastCheck = await this.prisma.db.cashFundCheck.findFirst({ where: { locationId: f.locationId }, orderBy: { checkedAt: 'desc' } });
      out.push({ ...f, spent: D(f.imprestAmount).minus(f.balance).toFixed(2), lastReplenishedAt: lastRep?.createdAt ?? null, lastCheck });
    }
    return out;
  }
  async get(locationId: string, user: SessionUser) {
    this.assertLocation(user, locationId);
    const f = await this.prisma.db.cashFund.findUnique({ where: { locationId }, include: { location: true } });
    if (!f) throw new NotFoundException('No cash fund set up for this location');
    const txns = await this.prisma.db.cashFundTxn.findMany({ where: { fundId: f.id }, orderBy: { createdAt: 'desc' }, take: 200 });
    const ids = [...new Set(txns.map((t) => t.createdBy).filter((x): x is string => !!x))];
    const users = await this.prisma.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
    const checks = await this.prisma.db.cashFundCheck.findMany({ where: { locationId }, orderBy: { checkedAt: 'desc' }, take: 20 });
    const checkers = await this.prisma.db.user.findMany({ where: { id: { in: checks.map((c) => c.checkedBy) } }, select: { id: true, fullName: true } });
    return { ...f, spent: D(f.imprestAmount).minus(f.balance).toFixed(2), txns: txns.map((t) => ({ ...t, by: users.find((u) => u.id === t.createdBy)?.fullName ?? null })), checks: checks.map((c) => ({ ...c, by: checkers.find((u) => u.id === c.checkedBy)?.fullName ?? null })) };
  }

  /** Admin / Accounting Head sets the imprest amount. First time: funded from the chosen account; later: the balance moves by the change. */
  async setup(locationId: string, input: { imprestAmount: number; fundedFromAccountId?: string | null }, user: SessionUser) {
    if (input.imprestAmount <= 0) throw new BadRequestException('Fund amount must be positive');
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: locationId } });
    const existing = await this.prisma.db.cashFund.findUnique({ where: { locationId } });
    const delta = existing ? D(input.imprestAmount).minus(existing.imprestAmount) : D(input.imprestAmount);
    const fund = await this.prisma.db.$transaction(async (tx) => {
      const f = existing
        ? await tx.cashFund.update({ where: { id: existing.id }, data: { imprestAmount: D(input.imprestAmount).toFixed(2), balance: D(existing.balance).plus(delta).toFixed(2), active: true } })
        : await tx.cashFund.create({ data: { locationId, imprestAmount: D(input.imprestAmount).toFixed(2), balance: D(input.imprestAmount).toFixed(2), createdBy: user.id } });
      if (!delta.isZero()) await tx.cashFundTxn.create({ data: { fundId: f.id, locationId, businessDate: todayManila(), kind: existing ? 'TOP_UP' : 'SETUP', amount: delta.toFixed(2), balanceAfter: f.balance, notes: existing ? `Fund changed ${existing.imprestAmount} → ${input.imprestAmount}` : 'Fund set up', createdBy: user.id } });
      if (input.fundedFromAccountId && delta.gt(0)) await this.posting.post(tx, { type: 'CashFund', id: f.id, date: todayManila(), createdBy: user.id }, (r) => r10FundSetup(r, { locationId, amount: delta, fromAccountId: input.fundedFromAccountId!, ref: `${loc.name} ${existing ? 'increase' : 'setup'}` }));
      return f;
    });
    await this.audit.log({ action: existing ? 'UPDATE' : 'CREATE', entityType: 'CashFund', entityId: fund.id, before: existing, after: fund });
    await this.notify.toLocation(locationId, { type: 'CASH_FUND', title: `Cash fund for ${loc.name} ${existing ? 'changed' : 'set up'}: ₱${D(input.imprestAmount).toFixed(2)}`, link: '/cash-fund' });
    return fund;
  }

  /** Expense paid from the fund (called inside the expense transaction). */
  async spend(tx: Tx, input: { locationId: string; amount: Prisma.Decimal.Value; expenseDocId: string; businessDate: Date; createdBy: string; notes?: string }) {
    const f = await tx.cashFund.findUnique({ where: { locationId: input.locationId } });
    if (!f || !f.active) throw new BadRequestException('This branch has no cash fund; pay from the cash drawer or ask Admin to set up the fund');
    if (D(f.balance).lt(input.amount)) throw new BadRequestException(`Cash fund balance is only ₱${D(f.balance).toFixed(2)}; replenish it from cash sales first or pay from the cash drawer`);
    const after = await tx.cashFund.update({ where: { id: f.id }, data: { balance: { decrement: D(input.amount).toFixed(2) } } });
    await tx.cashFundTxn.create({ data: { fundId: f.id, locationId: input.locationId, businessDate: input.businessDate, kind: 'EXPENSE', amount: D(input.amount).neg().toFixed(2), balanceAfter: after.balance, expenseDocId: input.expenseDocId, notes: input.notes, createdBy: input.createdBy } });
  }
  /** A voided fund expense puts the money back. */
  async unspend(tx: Tx, input: { locationId: string; amount: Prisma.Decimal.Value; expenseDocId: string; createdBy: string }) {
    const f = await tx.cashFund.findUnique({ where: { locationId: input.locationId } }); if (!f) return;
    const after = await tx.cashFund.update({ where: { id: f.id }, data: { balance: { increment: D(input.amount).toFixed(2) } } });
    await tx.cashFundTxn.create({ data: { fundId: f.id, locationId: input.locationId, businessDate: todayManila(), kind: 'EXPENSE_VOID', amount: D(input.amount).toFixed(2), balanceAfter: after.balance, expenseDocId: input.expenseDocId, createdBy: input.createdBy } });
  }

  /**
   * Replenish from the day's cash sales: brings the fund back up to its imprest amount (or the amount given). It cannot exceed the cash
   * available from the day's sales; the daily close and the Daily Sales Report deduct it from the cash for deposit.
   */
  async replenish(locationId: string, input: { amount?: number; date?: string }, user: SessionUser) {
    this.assertLocation(user, locationId);
    const f = await this.prisma.db.cashFund.findUnique({ where: { locationId }, include: { location: true } });
    if (!f || !f.active) throw new NotFoundException('No cash fund set up for this location');
    const businessDate = input.date ? toDateOnly(input.date) : todayManila();
    if (dateStr(businessDate) < dateStr(todayManila()) && !user.permissions.has('sale.edit.postclose')) throw new BadRequestException({ message: 'That day is closed; replenish from today\'s sales', code: 'DAY_CLOSED' });
    const gap = D(f.imprestAmount).minus(f.balance);
    const amount = input.amount != null ? D(input.amount) : gap;
    if (amount.lte(0)) throw new BadRequestException('The fund is already complete');
    if (amount.gt(gap)) throw new BadRequestException(`Only ₱${gap.toFixed(2)} is needed to complete the fund`);
    const s = await this.closing.summary(locationId, businessDate);
    if (amount.gt(s.expectedCash)) throw new BadRequestException(`Cash from sales available today is only ₱${D(s.expectedCash).toFixed(2)}`);
    const txn = await this.prisma.db.$transaction(async (tx) => {
      const after = await tx.cashFund.update({ where: { id: f.id }, data: { balance: { increment: amount.toFixed(2) } } });
      const t = await tx.cashFundTxn.create({ data: { controlNo: await this.seq.form(tx, 'FR', locationId), fundId: f.id, locationId, businessDate, kind: 'REPLENISH', amount: amount.toFixed(2), balanceAfter: after.balance, notes: 'Replenished from cash sales', createdBy: user.id } });
      await this.posting.post(tx, { type: 'CashFundTxn', id: t.id, date: businessDate, createdBy: user.id }, (r) => r10FundReplenish(r, { locationId, amount, ref: `${f.location.name} ${dateStr(businessDate)}` }));
      return t;
    });
    await this.audit.log({ action: 'REPLENISH', entityType: 'CashFund', entityId: f.id, after: txn });
    return txn;
  }

  /** Field Auditor (or auditors) counts the cash fund actually found in the store; a difference is flagged to Admin, Head Auditor and HR. */
  async check(locationId: string, input: { countedAmount: number; reason?: string; inspectionId?: string | null }, user: SessionUser, tx: Tx | null = null) {
    const db = tx ?? this.prisma.db;
    const f = await db.cashFund.findUnique({ where: { locationId }, include: { location: true } });
    if (!f) throw new NotFoundException('No cash fund set up for this location');
    const variance = D(input.countedAmount).minus(f.balance);
    if (!variance.isZero() && !input.reason?.trim()) throw new BadRequestException(`Counted ₱${D(input.countedAmount).toFixed(2)} but the system shows ₱${D(f.balance).toFixed(2)}; enter the reason for the difference`);
    const c = await db.cashFundCheck.create({ data: { locationId, countedAmount: D(input.countedAmount).toFixed(2), systemBalance: f.balance, variance: variance.toFixed(2), reason: input.reason ?? null, inspectionId: input.inspectionId ?? null, checkedBy: user.id } });
    await this.audit.log({ action: 'CASH_FUND_CHECK', entityType: 'CashFund', entityId: f.id, after: c });
    if (!variance.isZero()) await this.notify.toRoles(['ADMIN', 'HEAD_AUDITOR', 'HR_STAFF'], { type: 'CASH_FUND_DIFFERENCE', title: `Cash fund at ${f.location.name}: counted ₱${D(input.countedAmount).toFixed(2)}, system ₱${D(f.balance).toFixed(2)} (${variance.gt(0) ? '+' : ''}${variance.toFixed(2)})`, body: `Checked by ${user.fullName}. ${input.reason ?? ''}`, link: '/cash-fund' });
    return c;
  }

  /** Dashboard figures: every fund's balance and a grand total. */
  async dashboard(user: SessionUser) {
    const funds = await this.list(user);
    return { total: sum(funds.map((f) => f.balance)).toFixed(2), imprestTotal: sum(funds.map((f) => f.imprestAmount)).toFixed(2), funds: funds.map((f) => ({ locationId: f.locationId, location: f.location.name, imprest: f.imprestAmount, balance: f.balance, spent: f.spent, lastReplenishedAt: f.lastReplenishedAt, lastCheck: f.lastCheck ? { at: f.lastCheck.checkedAt, variance: f.lastCheck.variance } : null })) };
  }
  zero() { return ZERO; }
}
