import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { SequenceService } from '../common/sequence.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { ClosingService } from '../closing/closing.service';
import { MissingAccountError, r10FundAdvance, r10FundReplenish, r10FundSetup } from '../gl/posting-rules';
import { dateStr, toDateOnly, todayManila } from '../common/manila';
import { D, sum, ZERO } from '../common/money';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';

/**
 * Branch cash fund (owner request 2026-09-26): a fixed imprest amount kept at the branch; small expenses are paid from it and it is
 * topped back up (replenished) from that day's cash sales, which lowers the cash to deposit. Balances show on the dashboards of Admin,
 * the auditors and Accounting; the Field Auditor counts and confirms the cash actually found in the store.
 */
@Injectable()
export class CashFundService {
  constructor(private prisma: PrismaService, private seq: SequenceService, private audit: AuditService, private notify: NotificationsService, private posting: PostingService, private closing: ClosingService, private accounts: AccountsService) {}

  private assertLocation(user: SessionUser, locationId: string) { if (user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException('Location outside your assignment'); }
  private canSeeAll(user: SessionUser) { return user.permissions.has('cashfund.view.all') || user.permissions.has('cashfund.check') || user.permissions.has('cashfund.manage'); }

  /**
   * The two warehouse funds (Office, Franchise) belong to the warehouse custodians: the Warehouse Associate and In-Charge (cashfund.spend), Accounting (manage) and the auditors.
   * The sales associate at the warehouse store keeps no cash fund there (owner request 2026-10-23). A branch's own fund is open to its staff as before.
   */
  canUse(user: SessionUser, f: { purpose: string }) {
    if (f.purpose === 'GENERAL') return true;
    return ['cashfund.spend', 'cashfund.manage', 'cashfund.view.all', 'cashfund.check'].some((k) => user.permissions.has(k)) || (f.purpose === 'FRANCHISE' && user.permissions.has('franchise.shipping.fill'));
  }
  /** The fund an expense is paid from: the one chosen, or the only one the person may use at that location. */
  async resolveForExpense(user: SessionUser, locationId: string, cashFundId?: string | null) {
    const funds = await this.prisma.db.cashFund.findMany({ where: { locationId, active: true }, orderBy: { name: 'asc' } });
    if (!funds.length) throw new BadRequestException('This location has no cash fund yet: ask the Owner or the Accounting Head to set it up under Cash Fund, or pay from another source');
    const mine = funds.filter((f) => this.canUse(user, f));
    if (!mine.length) throw new ForbiddenException(`The cash fund here (${funds.map((f) => f.name).join(', ')}) is kept by the warehouse custodians; ask the Warehouse Associate or In-Charge to pay it`);
    if (cashFundId) { const f = mine.find((x) => x.id === cashFundId); if (!f) throw new BadRequestException('Choose one of the cash funds you may use at this location'); return f; }
    if (mine.length > 1) throw new BadRequestException({ message: `Choose which cash fund pays this: ${mine.map((x) => x.name).join(' or ')}`, code: 'CHOOSE_FUND' });
    return mine[0];
  }

  /** Names of the funds of a location, for clear messages. */
  private async namesAt(db: Tx | PrismaService['db'], locationId: string) { return (await db.cashFund.findMany({ where: { locationId, active: true }, select: { name: true }, orderBy: { name: 'asc' } })).map((f) => f.name); }

  /**
   * A fund is found by its own id, or by a location id (the branch's own fund; a warehouse has two, so the Office one comes first).
   * The old screens and the inspections address a fund by its location.
   */
  async findFund(idOrLocation: string, db: Tx | PrismaService['db'] = this.prisma.db) {
    const byId = await db.cashFund.findUnique({ where: { id: idOrLocation }, include: { location: true } });
    if (byId) return byId;
    const rows = await db.cashFund.findMany({ where: { locationId: idOrLocation }, include: { location: true } });
    const rank = (p: string) => (p === 'GENERAL' ? 0 : p === 'OFFICE' ? 1 : 2);
    return rows.sort((a, b) => rank(a.purpose) - rank(b.purpose))[0] ?? null;
  }
  /** The single fund of a location when there is exactly one; the branch's own fund otherwise (used by the store inspection). */
  async fundForLocation(locationId: string, db: Tx | PrismaService['db'] = this.prisma.db) { return this.findFund(locationId, db); }

  /** Every fund (for view-all roles) or the funds of the user's own locations, with spent since last replenishment and the last store check. */
  async list(user: SessionUser, q: { purpose?: string } = {}) {
    const where: Prisma.CashFundWhereInput = { ...(this.canSeeAll(user) && !user.locationScoped ? {} : { locationId: { in: user.locationIds } }), purpose: q.purpose || undefined };
    const funds = await this.prisma.db.cashFund.findMany({ where, include: { location: { select: { id: true, code: true, name: true, type: true } } }, orderBy: [{ location: { name: 'asc' } }, { name: 'asc' }] });
    const out = [];
    for (const f of funds.filter((x) => this.canUse(user, x))) {
      const lastRep = await this.prisma.db.cashFundTxn.findFirst({ where: { fundId: f.id, kind: 'REPLENISH' }, orderBy: { createdAt: 'desc' } });
      const lastCheck = await this.prisma.db.cashFundCheck.findFirst({ where: { OR: [{ fundId: f.id }, { fundId: null, locationId: f.locationId }] }, orderBy: { checkedAt: 'desc' } });
      out.push({ ...f, spent: Prisma.Decimal.max(D(0), D(f.imprestAmount).minus(f.balance)).toFixed(2), lastReplenishedAt: lastRep?.createdAt ?? null, lastCheck });
    }
    return out;
  }
  async get(idOrLocation: string, user: SessionUser) {
    const f = await this.findFund(idOrLocation);
    if (!f) throw new NotFoundException('No cash fund set up for this location');
    this.assertLocation(user, f.locationId);
    if (!this.canUse(user, f)) throw new ForbiddenException('This cash fund is kept by the warehouse custodians');
    const txns = await this.prisma.db.cashFundTxn.findMany({ where: { fundId: f.id }, orderBy: { createdAt: 'desc' }, take: 200 });
    const ids = [...new Set(txns.map((t) => t.createdBy).filter((x): x is string => !!x))];
    const users = await this.prisma.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
    const checks = await this.prisma.db.cashFundCheck.findMany({ where: { OR: [{ fundId: f.id }, { fundId: null, locationId: f.locationId }] }, orderBy: { checkedAt: 'desc' }, take: 20 });
    const checkers = await this.prisma.db.user.findMany({ where: { id: { in: checks.map((c) => c.checkedBy) } }, select: { id: true, fullName: true } });
    const drIds = [...new Set(txns.map((t) => t.salesDocId).filter((x): x is string => !!x))];
    const drs = await requestContext.runSystem(async () => await this.prisma.db.salesDoc.findMany({ where: { id: { in: drIds } }, select: { id: true, drSiNo: true } }));
    return { ...f, spent: Prisma.Decimal.max(D(0), D(f.imprestAmount).minus(f.balance)).toFixed(2), txns: txns.map((t) => ({ ...t, by: users.find((u) => u.id === t.createdBy)?.fullName ?? null, drSiNo: drs.find((d) => d.id === t.salesDocId)?.drSiNo ?? null })), checks: checks.map((c) => ({ ...c, by: checkers.find((u) => u.id === c.checkedBy)?.fullName ?? null })) };
  }

  /** The franchise DRs sent from this fund's location, to pick the DR a shipping expense of the Franchise fund is for. */
  async franchiseDrs(idOrLocation: string, user: SessionUser) {
    const f = await this.findFund(idOrLocation); if (!f) throw new NotFoundException('No cash fund set up for this location');
    this.assertLocation(user, f.locationId);
    if (!this.canUse(user, f)) throw new ForbiddenException('This cash fund is kept by the warehouse custodians');
    const docs = await requestContext.runSystem(async () => await this.prisma.db.salesDoc.findMany({ where: { locationId: f.locationId, channel: 'FRANCHISE', voidedAt: null }, orderBy: { docDate: 'desc' }, take: 120, select: { id: true, drSiNo: true, docDate: true, customerName: true, customer: { select: { name: true } } } }));
    const charges = await this.prisma.db.franchiseShippingCharge.findMany({ where: { salesDocId: { in: docs.map((d) => d.id) } }, select: { salesDocId: true, status: true, amount: true } });
    const spent = await requestContext.runSystem(async () => await this.prisma.db.expenseDoc.findMany({ where: { salesDocId: { in: docs.map((d) => d.id) }, voidedAt: null }, select: { salesDocId: true, amount: true } }));
    return docs.map((d) => { const c = charges.find((x) => x.salesDocId === d.id); return { id: d.id, drSiNo: d.drSiNo, docDate: d.docDate.toISOString().slice(0, 10), franchise: d.customer?.name ?? d.customerName, shipping: c ? { status: c.status, amount: c.amount } : null, paidFromFund: spent.filter((x) => x.salesDocId === d.id).reduce((t, x) => t.plus(x.amount), D(0)).toFixed(2) }; });
  }

  private static readonly PURPOSES = ['GENERAL', 'OFFICE', 'FRANCHISE'];
  /** Admin / Accounting Head sets the imprest amount. First time: funded from the chosen account; later: the balance moves by the change. A warehouse has two funds: Office and Franchise. */
  async setup(idOrLocation: string, input: { imprestAmount: number; fundedFromAccountId?: string | null; purpose?: string; name?: string; voucherStart?: number }, user: SessionUser) {
    if (input.imprestAmount <= 0) throw new BadRequestException('Fund amount must be positive');
    const byId = await this.prisma.db.cashFund.findUnique({ where: { id: idOrLocation } });
    const locationId = byId?.locationId ?? idOrLocation;
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: locationId } });
    const purpose = byId?.purpose ?? input.purpose ?? (loc.type === 'WAREHOUSE' ? 'OFFICE' : 'GENERAL');
    if (!CashFundService.PURPOSES.includes(purpose)) throw new BadRequestException('Unknown fund kind');
    if (purpose === 'FRANCHISE' && loc.type !== 'WAREHOUSE') throw new BadRequestException('The Franchise fund belongs to the warehouse that sends the franchise DRs');
    const existing = byId ?? (await this.prisma.db.cashFund.findUnique({ where: { locationId_purpose: { locationId, purpose } } }));
    const label = purpose === 'GENERAL' ? 'Cash fund' : `${loc.name} – ${purpose === 'OFFICE' ? 'Office' : 'Franchise'}`;
    const delta = existing ? D(input.imprestAmount).minus(existing.imprestAmount) : D(input.imprestAmount);
    const fund = await this.prisma.db.$transaction(async (tx) => {
      // each warehouse fund has its own petty-cash account (the branch template account stays with the branch / Office fund)
      let accountId = existing?.accountId ?? null;
      if (!existing && purpose === 'FRANCHISE') {
        const title = `Petty Cash - ${loc.name} (Franchise)`;
        accountId = ((await tx.account.findFirst({ where: { title } })) ?? (await this.accounts.create({ title, class: 'CASH', branchTagId: locationId, entryScope: 'BRANCH', paymentAccountType: 'PETTY_CASH' }, user.id, tx))).id;
      }
      const f = existing
        ? await tx.cashFund.update({ where: { id: existing.id }, data: { imprestAmount: D(input.imprestAmount).toFixed(2), balance: D(existing.balance).plus(delta).toFixed(2), active: true, name: input.name?.trim() || existing.name, ...(input.voucherStart ? { voucherStart: input.voucherStart } : {}) } })
        : await tx.cashFund.create({ data: { locationId, purpose, name: input.name?.trim() || label, accountId, voucherStart: input.voucherStart ?? 1, imprestAmount: D(input.imprestAmount).toFixed(2), balance: D(input.imprestAmount).toFixed(2), createdBy: user.id } });
      if (!delta.isZero()) await tx.cashFundTxn.create({ data: { fundId: f.id, locationId, businessDate: todayManila(), kind: existing ? 'TOP_UP' : 'SETUP', amount: delta.toFixed(2), balanceAfter: f.balance, notes: existing ? `Fund changed ${existing.imprestAmount} → ${D(input.imprestAmount).toFixed(2)}` : 'Fund set up', counterAccountId: input.fundedFromAccountId ?? null, createdBy: user.id } });
      if (input.fundedFromAccountId && delta.gt(0)) await this.posting.post(tx, { type: 'CashFund', id: f.id, date: todayManila(), createdBy: user.id }, (r) => r10FundSetup(r, { locationId, amount: delta, fromAccountId: input.fundedFromAccountId!, ref: `${f.name}`, fundAccountId: f.accountId }));
      return f;
    });
    await this.audit.log({ action: existing ? 'UPDATE' : 'CREATE', entityType: 'CashFund', entityId: fund.id, before: existing, after: fund });
    await this.notify.toLocation(locationId, { type: 'CASH_FUND', title: `${fund.name} ${existing ? 'changed' : 'set up'}: ₱${D(input.imprestAmount).toFixed(2)}`, link: '/cash-fund' });
    return fund;
  }

  /** Accounting adds money to a fund from a bank / cash account (the warehouse funds have no cash sales to replenish them). */
  async topUp(idOrLocation: string, input: { amount: number; fromAccountId: string; notes?: string }, user: SessionUser) {
    const f = await this.findFund(idOrLocation); if (!f || !f.active) throw new NotFoundException('No cash fund set up for this location');
    if (!(input.amount > 0)) throw new BadRequestException('The amount must be more than zero');
    const t = await this.prisma.db.$transaction(async (tx) => {
      const after = await tx.cashFund.update({ where: { id: f.id }, data: { balance: { increment: D(input.amount).toFixed(2) } } });
      const row = await tx.cashFundTxn.create({ data: { fundId: f.id, locationId: f.locationId, businessDate: todayManila(), kind: 'TOP_UP', amount: D(input.amount).toFixed(2), balanceAfter: after.balance, notes: input.notes?.trim() || 'Topped up by Accounting', counterAccountId: input.fromAccountId, createdBy: user.id } });
      await this.posting.post(tx, { type: 'CashFundTxn', id: row.id, date: todayManila(), createdBy: user.id }, (r) => r10FundSetup(r, { locationId: f.locationId, amount: input.amount, fromAccountId: input.fromAccountId, ref: `${f.name} top-up`, fundAccountId: f.accountId }));
      return row;
    });
    await this.audit.log({ action: 'CASH_FUND_TOPUP', entityType: 'CashFund', entityId: f.id, after: t });
    return t;
  }

  /** Money in from a franchise's CASH payment of a shipping charge, tied to the franchise DR (Warehouse – Franchise fund). */
  async receive(tx: Tx, input: { fundId: string; amount: Prisma.Decimal.Value; salesDocId?: string | null; franchiseInvoiceId?: string | null; franchisePaymentId?: string | null; counterAccountId?: string | null; businessDate: Date; createdBy: string; notes?: string }) {
    const f = await tx.cashFund.findUnique({ where: { id: input.fundId } });
    if (!f || !f.active) throw new BadRequestException('This cash fund is not active');
    const after = await tx.cashFund.update({ where: { id: f.id }, data: { balance: { increment: D(input.amount).toFixed(2) } } });
    return tx.cashFundTxn.create({ data: { fundId: f.id, locationId: f.locationId, businessDate: input.businessDate, kind: 'FRANCHISE_RECEIPT', amount: D(input.amount).toFixed(2), balanceAfter: after.balance, salesDocId: input.salesDocId ?? null, franchiseInvoiceId: input.franchiseInvoiceId ?? null, franchisePaymentId: input.franchisePaymentId ?? null, counterAccountId: input.counterAccountId ?? null, notes: input.notes ?? null, createdBy: input.createdBy } });
  }

  // ───────── advances: more cash from "Advances from …", cash lent as "Advances to …", and repayments ─────────
  private static readonly ADV_KINDS = { IN: 'ADVANCE_IN', OUT: 'ADVANCE_OUT', RETURN: 'ADVANCE_RETURN' } as const;

  /** The accounts the custodian may choose: where extra cash comes from (Advances from …) and who the money is lent to / paid back by (Advances to …). */
  async advanceAccounts() {
    const rows = await this.prisma.db.account.findMany({ where: { active: true, class: { in: ['ADVANCES_FROM', 'ADVANCES_TO'] } }, select: { id: true, code: true, title: true, class: true }, orderBy: { code: 'asc' } });
    return { from: rows.filter((a) => a.class === 'ADVANCES_FROM').map(({ id, code, title }) => ({ id, code, title })), to: rows.filter((a) => a.class === 'ADVANCES_TO' && /^advances to/i.test(a.title)).map(({ id, code, title }) => ({ id, code, title })) };
  }

  /**
   * IN = additional cash put into the fund from an "Advances from …" account (for example Advances from AMV);
   * OUT = a pull-out lent to someone, to be returned ("Advances to …"); RETURN = the money paid back into the fund.
   */
  async advance(idOrLocation: string, input: { kind: 'IN' | 'OUT' | 'RETURN'; amount: number; counterAccountId: string; personName?: string | null; reference?: string | null; notes?: string | null; date?: string }, user: SessionUser) {
    const f = await this.findFund(idOrLocation); if (!f || !f.active) throw new NotFoundException('No cash fund set up for this location');
    this.assertLocation(user, f.locationId);
    if (!this.canUse(user, f) || !(user.permissions.has('cashfund.spend') || user.permissions.has('cashfund.manage'))) throw new ForbiddenException('Only the people who keep this cash fund may record advances');
    if (!(input.amount > 0)) throw new BadRequestException('The amount must be more than zero');
    const acct = await this.prisma.db.account.findUnique({ where: { id: input.counterAccountId } });
    const want = input.kind === 'IN' ? 'ADVANCES_FROM' : 'ADVANCES_TO';
    if (!acct || !acct.active || acct.class !== want) throw new BadRequestException(input.kind === 'IN' ? 'Choose an "Advances from …" account for cash put into the fund' : 'Choose an "Advances to …" account');
    if (input.kind !== 'IN' && !input.personName?.trim()) throw new BadRequestException(input.kind === 'OUT' ? 'Who borrowed the money?' : 'Who paid it back?');
    const businessDate = input.date ? toDateOnly(input.date) : todayManila();
    if (businessDate > todayManila()) throw new BadRequestException('The date cannot be in the future');
    const signed = input.kind === 'OUT' ? D(input.amount).neg() : D(input.amount);
    const txn = await this.prisma.db.$transaction(async (tx) => {
      const cur = await tx.cashFund.findUniqueOrThrow({ where: { id: f.id } });
      if (input.kind === 'OUT' && D(cur.balance).lt(input.amount)) throw new BadRequestException(`The fund has only ₱${D(cur.balance).toFixed(2)}`);
      const after = await tx.cashFund.update({ where: { id: f.id }, data: { balance: { increment: signed.toFixed(2) } } });
      const controlNo = await this.seq.form(tx, 'FR', f.locationId);
      const t = await tx.cashFundTxn.create({ data: { controlNo, fundId: f.id, locationId: f.locationId, businessDate, kind: CashFundService.ADV_KINDS[input.kind], amount: signed.toFixed(2), balanceAfter: after.balance, counterAccountId: acct.id, personName: input.personName?.trim() || null, reference: input.reference?.trim() || null, notes: input.notes?.trim() || null, createdBy: user.id } });
      await this.posting.post(tx, { type: 'CashFundTxn', id: t.id, date: businessDate, createdBy: user.id }, (r) => r10FundAdvance(r, { locationId: f.locationId, amount: input.amount, counterAccountId: acct.id, direction: input.kind === 'OUT' ? 'OUT' : 'IN', ref: `${f.name} · ${acct.title}`, fundAccountId: f.accountId }));
      return t;
    });
    await this.audit.log({ action: `CASH_FUND_ADVANCE_${input.kind}`, entityType: 'CashFund', entityId: f.id, after: txn });
    return txn;
  }

  /** Money lent out of the fund and not yet paid back: per "Advances to" account and person. */
  async openAdvances(idOrLocation: string, user: SessionUser) {
    const f = await this.findFund(idOrLocation); if (!f) throw new NotFoundException('No cash fund set up for this location');
    this.assertLocation(user, f.locationId);
    if (!this.canUse(user, f)) throw new ForbiddenException('This cash fund is kept by the warehouse custodians');
    const rows = await this.prisma.db.cashFundTxn.findMany({ where: { fundId: f.id, kind: { in: ['ADVANCE_OUT', 'ADVANCE_RETURN'] } }, orderBy: { businessDate: 'asc' } });
    const map = new Map<string, { counterAccountId: string; personName: string; out: ReturnType<typeof D>; back: ReturnType<typeof D>; since: Date }>();
    for (const t of rows) {
      const key = `${t.counterAccountId}|${(t.personName ?? '').toLowerCase()}`; const cur = map.get(key) ?? { counterAccountId: t.counterAccountId ?? '', personName: t.personName ?? '', out: D(0), back: D(0), since: t.businessDate };
      if (t.kind === 'ADVANCE_OUT') cur.out = cur.out.plus(D(t.amount).abs()); else cur.back = cur.back.plus(t.amount); map.set(key, cur);
    }
    const accts = new Map((await this.prisma.db.account.findMany({ where: { id: { in: [...new Set([...map.values()].map((v) => v.counterAccountId))] } }, select: { id: true, code: true, title: true } })).map((a) => [a.id, a]));
    return [...map.values()].map((v) => ({ counterAccountId: v.counterAccountId, account: accts.get(v.counterAccountId)?.title ?? '', code: accts.get(v.counterAccountId)?.code ?? '', personName: v.personName, lent: v.out.toFixed(2), returned: v.back.toFixed(2), outstanding: v.out.minus(v.back).toFixed(2), since: dateStr(v.since) })).filter((v) => Number(v.outstanding) > 0);
  }

  /** Expense paid from the fund (called inside the expense transaction). */
  async spend(tx: Tx, input: { locationId: string; fundId?: string | null; amount: Prisma.Decimal.Value; expenseDocId: string; businessDate: Date; createdBy: string; salesDocId?: string | null; notes?: string }) {
    let f = input.fundId ? await tx.cashFund.findUnique({ where: { id: input.fundId } }) : null;
    if (input.fundId && (!f || f.locationId !== input.locationId)) throw new BadRequestException('That cash fund is not at this location');
    if (!f) {
      const funds = await tx.cashFund.findMany({ where: { locationId: input.locationId, active: true }, orderBy: { name: 'asc' } });
      if (funds.length > 1) throw new BadRequestException({ message: `Choose which cash fund pays this: ${funds.map((x) => x.name).join(' or ')}`, code: 'CHOOSE_FUND' });
      f = funds[0] ?? null;
    }
    if (!f || !f.active) throw new BadRequestException('This branch has no cash fund; pay from the cash drawer or ask Admin to set up the fund');
    if (D(f.balance).lt(input.amount)) throw new BadRequestException(`Cash fund balance is only ₱${D(f.balance).toFixed(2)}; replenish it from cash sales first or pay from the cash drawer`);
    const after = await tx.cashFund.update({ where: { id: f.id }, data: { balance: { decrement: D(input.amount).toFixed(2) } } });
    await tx.cashFundTxn.create({ data: { fundId: f.id, locationId: input.locationId, businessDate: input.businessDate, kind: 'EXPENSE', amount: D(input.amount).neg().toFixed(2), balanceAfter: after.balance, expenseDocId: input.expenseDocId, salesDocId: input.salesDocId ?? null, notes: input.notes, createdBy: input.createdBy } });
    return after;
  }
  /** A voided fund expense puts the money back. */
  async unspend(tx: Tx, input: { locationId: string; amount: Prisma.Decimal.Value; expenseDocId: string; createdBy: string }) {
    const paid = await tx.cashFundTxn.findFirst({ where: { expenseDocId: input.expenseDocId, kind: 'EXPENSE' } });
    const f = paid ? await tx.cashFund.findUnique({ where: { id: paid.fundId } }) : await tx.cashFund.findFirst({ where: { locationId: input.locationId } }); if (!f) return;
    const after = await tx.cashFund.update({ where: { id: f.id }, data: { balance: { increment: D(input.amount).toFixed(2) } } });
    await tx.cashFundTxn.create({ data: { fundId: f.id, locationId: input.locationId, businessDate: todayManila(), kind: 'EXPENSE_VOID', amount: D(input.amount).toFixed(2), balanceAfter: after.balance, expenseDocId: input.expenseDocId, salesDocId: paid?.salesDocId ?? null, createdBy: input.createdBy } });
  }

  /**
   * Replenish from the day's cash sales: brings the fund back up to its imprest amount (or the amount given). It cannot exceed the cash
   * available from the day's sales; the daily close and the Daily Sales Report deduct it from the cash for deposit.
   */
  async replenish(idOrLocation: string, input: { amount?: number; date?: string }, user: SessionUser) {
    const f = await this.findFund(idOrLocation);
    if (!f || !f.active) throw new NotFoundException('No cash fund set up for this location');
    const locationId = f.locationId;
    this.assertLocation(user, locationId);
    if (f.purpose !== 'GENERAL') throw new BadRequestException(`${f.name} has no cash sales to replenish it from: Accounting tops it up from the bank`);
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
      let cohId: string | null = null;
      try { cohId = (await this.posting.resolver(tx)).branch('CASH_ON_HAND', locationId); } catch (e) { if (!(e instanceof MissingAccountError)) throw e; }
      const t = await tx.cashFundTxn.create({ data: { controlNo: await this.seq.form(tx, 'FR', locationId), fundId: f.id, locationId, businessDate, kind: 'REPLENISH', amount: amount.toFixed(2), balanceAfter: after.balance, notes: 'Replenished from cash sales', counterAccountId: cohId, createdBy: user.id } });
      await this.posting.post(tx, { type: 'CashFundTxn', id: t.id, date: businessDate, createdBy: user.id }, (r) => r10FundReplenish(r, { locationId, amount, ref: `${f.location.name} ${dateStr(businessDate)}`, fundAccountId: f.accountId }));
      return t;
    });
    await this.audit.log({ action: 'REPLENISH', entityType: 'CashFund', entityId: f.id, after: txn });
    return txn;
  }

  /** Field Auditor (or auditors) counts the cash fund actually found in the store; a difference is flagged to Admin, Head Auditor and HR. */
  async check(idOrLocation: string, input: { countedAmount: number; reason?: string; inspectionId?: string | null }, user: SessionUser, tx: Tx | null = null) {
    const db = tx ?? this.prisma.db;
    const f = await this.findFund(idOrLocation, db);
    if (!f) throw new NotFoundException('No cash fund set up for this location');
    const locationId = f.locationId;
    const variance = D(input.countedAmount).minus(f.balance);
    if (!variance.isZero() && !input.reason?.trim()) throw new BadRequestException(`Counted ₱${D(input.countedAmount).toFixed(2)} but the system shows ₱${D(f.balance).toFixed(2)}; enter the reason for the difference`);
    const c = await db.cashFundCheck.create({ data: { fundId: f.id, locationId, countedAmount: D(input.countedAmount).toFixed(2), systemBalance: f.balance, variance: variance.toFixed(2), reason: input.reason ?? null, inspectionId: input.inspectionId ?? null, checkedBy: user.id } });
    await this.audit.log({ action: 'CASH_FUND_CHECK', entityType: 'CashFund', entityId: f.id, after: c });
    if (!variance.isZero()) await this.notify.toRoles(['ADMIN', 'HEAD_AUDITOR', 'HR_STAFF'], { type: 'CASH_FUND_DIFFERENCE', title: `${f.name} at ${f.location.name}: counted ₱${D(input.countedAmount).toFixed(2)}, system ₱${D(f.balance).toFixed(2)} (${variance.gt(0) ? '+' : ''}${variance.toFixed(2)})`, body: `Checked by ${user.fullName}. ${input.reason ?? ''}`, link: '/cash-fund' });
    return c;
  }

  /** Dashboard figures: every fund's balance and a grand total. */
  async dashboard(user: SessionUser) {
    const funds = await this.list(user);
    return { total: sum(funds.map((f) => f.balance)).toFixed(2), imprestTotal: sum(funds.map((f) => f.imprestAmount)).toFixed(2), funds: funds.map((f) => ({ id: f.id, name: f.name, purpose: f.purpose, locationId: f.locationId, location: f.location.name, imprest: f.imprestAmount, balance: f.balance, spent: f.spent, lastReplenishedAt: f.lastReplenishedAt, lastCheck: f.lastCheck ? { at: f.lastCheck.checkedAt, variance: f.lastCheck.variance } : null })) };
  }
  zero() { return ZERO; }
}
