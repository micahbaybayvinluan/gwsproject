import { Injectable } from '@nestjs/common';
import { AccountClass, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { D, ZERO } from '../common/money';
import Decimal from 'decimal.js';

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export interface AccountRow { id: string; code: string; title: string; class: AccountClass; normalBalance: 'DEBIT' | 'CREDIT'; branchTagId: string | null; branchName: string | null; channelTag: string | null; beg: Decimal; months: Decimal[]; total: Decimal }

const IS_CLASSES: AccountClass[] = ['REVENUE', 'DIRECT_COST', 'OPEX', 'OTHER_INCOME'];
const BS_CLASSES: AccountClass[] = ['CASH', 'AR', 'INVENTORY', 'ADVANCES_TO', 'FIXED_ASSET', 'ACCUM_DEPN', 'CURRENT_LIABILITY', 'ADVANCES_FROM', 'EQUITY'];

/** §10.5 Financial reports built from journal lines: TB, IS, BS, NI per Branch, Cash Flow, schedules. Layout mirrors the workbook (Beg, Jan…Dec, Total). */
@Injectable()
export class FinReportsService {
  constructor(private prisma: PrismaService, private settings: SettingsService) {}

  /** Per-account monthly net movement (normal-balance signed) for a fiscal year. */
  async accountMatrix(year: number): Promise<AccountRow[]> {
    const accounts = await this.prisma.db.account.findMany({ where: { active: true }, include: { branchTag: { select: { name: true } } }, orderBy: { code: 'asc' } });
    const rows = await this.prisma.db.$queryRaw<{ account_id: string; month: number; debit: Prisma.Decimal; credit: Prisma.Decimal }[]>`
      SELECT jl.account_id, EXTRACT(MONTH FROM jv.date)::int AS month, SUM(jl.debit) AS debit, SUM(jl.credit) AS credit
      FROM journal_lines jl JOIN journal_vouchers jv ON jv.id = jl.voucher_id
      WHERE jv.voided_at IS NULL AND EXTRACT(YEAR FROM jv.date) = ${year} AND jv.voucher_no NOT LIKE 'OB-%'
      GROUP BY jl.account_id, month`;
    const ob = await this.prisma.db.journalLine.findMany({ where: { voucher: { voucherNo: `OB-${year}`, voidedAt: null } } });
    const prior = await this.prisma.db.$queryRaw<{ account_id: string; debit: Prisma.Decimal; credit: Prisma.Decimal }[]>`
      SELECT jl.account_id, SUM(jl.debit) AS debit, SUM(jl.credit) AS credit FROM journal_lines jl JOIN journal_vouchers jv ON jv.id = jl.voucher_id
      WHERE jv.voided_at IS NULL AND EXTRACT(YEAR FROM jv.date) < ${year} GROUP BY jl.account_id`;
    return accounts.map((a) => {
      const sign = a.normalBalance === 'DEBIT' ? 1 : -1;
      const months = Array.from({ length: 12 }, () => ZERO);
      for (const r of rows.filter((x) => x.account_id === a.id)) months[r.month - 1] = months[r.month - 1].plus(D(r.debit).minus(r.credit).mul(sign));
      let beg = ob.filter((l) => l.accountId === a.id).reduce((s, l) => s.plus(D(l.debit).minus(l.credit).mul(sign)), ZERO);
      // prior-year balances roll into beg for BS accounts (IS accounts close to retained earnings implicitly)
      if (BS_CLASSES.includes(a.class)) for (const p of prior.filter((x) => x.account_id === a.id)) beg = beg.plus(D(p.debit).minus(p.credit).mul(sign));
      const total = months.reduce((s, m) => s.plus(m), ZERO);
      return { id: a.id, code: a.code, title: a.title, class: a.class, normalBalance: a.normalBalance, branchTagId: a.branchTagId, branchName: a.branchTag?.name ?? null, channelTag: a.channelTag, beg, months, total };
    });
  }

  /** Trial balance: Beg, Jan…Dec, Total — debit-positive convention for export. */
  async trialBalance(year: number) {
    const m = await this.accountMatrix(year);
    const rows = m.filter((r) => !r.beg.isZero() || !r.total.isZero()).map((r) => { const s = r.normalBalance === 'DEBIT' ? 1 : -1; return { ...r, beg: r.beg.mul(s), months: r.months.map((x) => x.mul(s)), total: r.total.mul(s) }; });
    const foot = (k: 'beg' | 'total') => rows.reduce((s, r) => s.plus(r[k]), ZERO);
    return { year, rows, check: { beg: foot('beg'), total: foot('total') } };
  }

  async incomeStatement(year: number, branchTagId?: string) {
    const m = (await this.accountMatrix(year)).filter((r) => IS_CLASSES.includes(r.class) && (!branchTagId || r.branchTagId === branchTagId));
    const section = (cls: AccountClass) => m.filter((r) => r.class === cls);
    const sumRows = (rows: AccountRow[]) => ({ months: Array.from({ length: 12 }, (_, i) => rows.reduce((s, r) => s.plus(r.months[i]), ZERO)), total: rows.reduce((s, r) => s.plus(r.total), ZERO) });
    const rev = sumRows(section('REVENUE')), dc = sumRows(section('DIRECT_COST')), opex = sumRows(section('OPEX')), oi = sumRows(section('OTHER_INCOME'));
    const sub = (a: typeof rev, b: typeof rev) => ({ months: a.months.map((x, i) => x.minus(b.months[i])), total: a.total.minus(b.total) });
    const add = (a: typeof rev, b: typeof rev) => ({ months: a.months.map((x, i) => x.plus(b.months[i])), total: a.total.plus(b.total) });
    const gp = sub(rev, dc); const ni = add(sub(gp, opex), oi);
    return { year, sections: { revenues: section('REVENUE'), directCost: section('DIRECT_COST'), operatingExpenses: section('OPEX'), otherIncome: section('OTHER_INCOME') }, totals: { revenues: rev, directCost: dc, grossProfit: gp, operatingExpenses: opex, otherIncome: oi, netIncome: ni } };
  }

  /** Balance sheet: Beg + "As of" each month; NI to date flows into equity; "Should be 0" check row. */
  async balanceSheet(year: number) {
    const m = await this.accountMatrix(year);
    const is = await this.incomeStatement(year);
    const asOf = (r: AccountRow, i: number) => r.months.slice(0, i + 1).reduce((s, x) => s.plus(x), r.beg);
    const rows = m.filter((r) => BS_CLASSES.includes(r.class)).map((r) => ({ ...r, asOf: Array.from({ length: 12 }, (_, i) => asOf(r, i)) }));
    const group = (cls: AccountClass[]) => rows.filter((r) => cls.includes(r.class));
    const sumCol = (rs: typeof rows, i: number | 'beg') => rs.reduce((s, r) => s.plus(i === 'beg' ? r.beg : r.asOf[i]), ZERO);
    const cols = ['beg' as const, ...Array.from({ length: 12 }, (_, i) => i)];
    const assets = group(['CASH', 'AR', 'INVENTORY', 'ADVANCES_TO', 'FIXED_ASSET']); const contra = group(['ACCUM_DEPN']);
    const liabilities = group(['CURRENT_LIABILITY', 'ADVANCES_FROM']); const equity = group(['EQUITY']);
    const niToDate = cols.map((c) => (c === 'beg' ? ZERO : is.totals.netIncome.months.slice(0, c + 1).reduce((s, x) => s.plus(x), ZERO)));
    const totalAssets = cols.map((c) => sumCol(assets, c).minus(sumCol(contra, c)));
    const totalLiab = cols.map((c) => sumCol(liabilities, c));
    const totalEquity = cols.map((c, i) => sumCol(equity, c).plus(niToDate[i]));
    return { year, columns: ['Beg', ...MONTHS], sections: { assets, accumulatedDepreciation: contra, liabilities, equity }, totals: { assets: totalAssets, liabilities: totalLiab, equity: totalEquity, netIncomeToDate: niToDate, shouldBeZero: totalAssets.map((a, i) => a.minus(totalLiab[i]).minus(totalEquity[i])) } };
  }

  /** NI per Branch (SUMMARY layout): untagged (MAIN) direct cost / OPEX allocated pro-rata to revenue by default (§18.8). */
  async netIncomePerBranch(year: number, month?: number) {
    const m = await this.accountMatrix(year);
    const branches = await this.prisma.db.location.findMany({ where: { type: { in: ['WAREHOUSE', 'BRANCH', 'CONSIGNEE'] }, active: true }, orderBy: { name: 'asc' } });
    const val = (r: AccountRow) => (month ? r.months[month - 1] : r.total);
    const byBranch = (cls: AccountClass, id: string | null) => m.filter((r) => r.class === cls && r.branchTagId === id).reduce((s, r) => s.plus(val(r)), ZERO);
    const cols = branches.map((b) => ({ id: b.id, name: b.name, revenues: byBranch('REVENUE', b.id), directCost: byBranch('DIRECT_COST', b.id), opex: byBranch('OPEX', b.id) }));
    const totalRev = cols.reduce((s, c) => s.plus(c.revenues), ZERO);
    const consoDC = byBranch('DIRECT_COST', null); const consoOpex = byBranch('OPEX', null); const otherIncome = m.filter((r) => r.class === 'OTHER_INCOME').reduce((s, r) => s.plus(val(r)), ZERO);
    const basis = await this.settings.get<string>('gl.ni_allocation_basis');
    const share = (c: (typeof cols)[number]) => (basis === 'EQUAL' || totalRev.isZero() ? D(1).div(cols.length || 1) : c.revenues.div(totalRev));
    const out = cols.map((c) => { const dcC = consoDC.mul(share(c)); const opC = consoOpex.mul(share(c)); const gp = c.revenues.minus(c.directCost).minus(dcC); return { ...c, directCostConso: dcC, grossProfit: gp, opexConso: opC, netIncome: gp.minus(c.opex).minus(opC) }; });
    const tot = (k: keyof (typeof out)[number]) => out.reduce((s, c) => s.plus(c[k] as Decimal), ZERO);
    return { year, month: month ?? null, columns: out, total: { revenues: tot('revenues'), directCost: tot('directCost'), directCostConso: tot('directCostConso'), grossProfit: tot('grossProfit'), opex: tot('opex'), opexConso: tot('opexConso'), netIncome: tot('netIncome').plus(otherIncome), otherIncome } };
  }

  /** Indirect cash flow: NI + non-cash (depreciation) ± working-capital changes; investing = fixed asset changes; financing = equity/advances changes. */
  async cashFlow(year: number) {
    const bs = await this.balanceSheet(year); const is = await this.incomeStatement(year);
    const chg = (cls: AccountClass[], i: number) => bs.sections.assets.concat(bs.sections.liabilities, bs.sections.equity, bs.sections.accumulatedDepreciation).filter((r) => cls.includes(r.class)).reduce((s, r) => s.plus(r.asOf[i].minus(i === 0 ? r.beg : r.asOf[i - 1])), ZERO);
    const months = MONTHS.map((_, i) => {
      const ni = is.totals.netIncome.months[i]; const depn = chg(['ACCUM_DEPN'], i);
      const ar = chg(['AR'], i).neg(), inv = chg(['INVENTORY'], i).neg(), adv = chg(['ADVANCES_TO'], i).neg(), liab = chg(['CURRENT_LIABILITY'], i);
      const operating = ni.plus(depn).plus(ar).plus(inv).plus(adv).plus(liab);
      const investing = chg(['FIXED_ASSET'], i).neg(); const financing = chg(['EQUITY', 'ADVANCES_FROM'], i);
      const cash = chg(['CASH'], i);
      return { month: MONTHS[i], netIncome: ni, depreciation: depn, arChange: ar, inventoryChange: inv, advancesChange: adv, liabilitiesChange: liab, operating, investing, financing, netChange: operating.plus(investing).plus(financing), cashChange: cash, check: operating.plus(investing).plus(financing).minus(cash) };
    });
    return { year, months };
  }

  /** Monthly schedules (Sales / Direct Cost / OPEX / Assets) with month-over-month % change per branch. */
  async schedule(year: number, kind: 'SALES' | 'DIRECT_COST' | 'OPEX' | 'ASSETS') {
    const cls: AccountClass[] = kind === 'SALES' ? ['REVENUE'] : kind === 'DIRECT_COST' ? ['DIRECT_COST'] : kind === 'OPEX' ? ['OPEX'] : ['FIXED_ASSET', 'ACCUM_DEPN'];
    const rows = (await this.accountMatrix(year)).filter((r) => cls.includes(r.class));
    const branches = [...new Map(rows.map((r) => [r.branchTagId ?? 'MAIN', r.branchName ?? 'Main/Conso'])).entries()];
    const perBranch = branches.map(([id, name]) => { const rs = rows.filter((r) => (r.branchTagId ?? 'MAIN') === id); const months = MONTHS.map((_, i) => rs.reduce((s, r) => s.plus(r.months[i]), ZERO)); const mom = months.map((m, i) => (i === 0 || months[i - 1].isZero() ? null : m.minus(months[i - 1]).div(months[i - 1]).mul(100).toDecimalPlaces(1))); return { branchId: id, branch: name, months, total: months.reduce((s, m) => s.plus(m), ZERO), momPct: mom }; });
    return { year, kind, rows, perBranch };
  }

  async arAgeing() {
    const docs = await this.prisma.db.salesDoc.findMany({ where: { paymentMode: 'AR_PDC', voidedAt: null }, include: { customer: true, agent: true } });
    const today = Date.now(); const buckets = ['current', '1-30', '31-60', '61-90', '90+'] as const;
    const map = new Map<string, { counterparty: string; current: Decimal; '1-30': Decimal; '31-60': Decimal; '61-90': Decimal; '90+': Decimal; total: Decimal }>();
    for (const d of docs) { const bal = d.grandTotal.minus(d.amountPaid); if (bal.lte(0)) continue; const k = d.customer?.name ?? d.agent?.name ?? d.customerName ?? 'Unknown'; const cur = map.get(k) ?? { counterparty: k, current: ZERO, '1-30': ZERO, '31-60': ZERO, '61-90': ZERO, '90+': ZERO, total: ZERO }; const days = d.dueDate ? Math.floor((today - d.dueDate.getTime()) / 86400000) : 0; const b = days <= 0 ? 'current' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+'; cur[b] = cur[b].plus(bal); cur.total = cur.total.plus(bal); map.set(k, cur); }
    return { buckets, rows: [...map.values()] };
  }
  /** AP ageing from receiving docs not marked paid (approximation until AP payments module exists). */
  async apAgeing() {
    const docs = await this.prisma.db.receivingDoc.findMany({ where: { status: 'POSTED', paidOnReceipt: false, isConsignmentIn: false }, include: { supplier: { select: { code: true, name: true, termsDays: true } }, lines: true } });
    const today = Date.now();
    return docs.map((d) => { const total = d.lines.reduce((s, l) => s.plus(D(l.unitCost ?? 0).mul(l.qty)), ZERO); const due = new Date(d.docDate.getTime() + d.supplier.termsDays * 86400000); return { supplierCode: d.supplier.code, supplierName: d.supplier.name, controlNo: d.controlNo, supplierRef: d.supplierRef, docDate: d.docDate, dueDate: due, total, daysOverdue: Math.max(0, Math.floor((today - due.getTime()) / 86400000)) }; });
  }
  /** Cash & AR daily per location (sheet `Cash & AR-daily`). */
  async cashArDaily(year: number, month: number) {
    const from = new Date(Date.UTC(year, month - 1, 1)); const to = new Date(Date.UTC(year, month, 0));
    const sales = await this.prisma.db.salesDoc.findMany({ where: { voidedAt: null, docDate: { gte: from, lte: to } }, include: { location: { select: { name: true } } } });
    const deposits = await this.prisma.db.cashDeposit.findMany({ where: { businessDate: { gte: from, lte: to } } });
    const map = new Map<string, { location: string; date: string; cash: Decimal; deposited: Decimal; depositDate: string | null; ar: Decimal; online: Decimal; creditCard: Decimal }>();
    for (const s of sales) { const k = `${s.locationId}|${s.docDate.toISOString().slice(0, 10)}`; const cur = map.get(k) ?? { location: s.location.name, date: s.docDate.toISOString().slice(0, 10), cash: ZERO, deposited: ZERO, depositDate: null, ar: ZERO, online: ZERO, creditCard: ZERO }; const f = s.paymentMode === 'CASH' ? 'cash' : s.paymentMode === 'AR_PDC' ? 'ar' : s.paymentMode === 'ONLINE' ? 'online' : 'creditCard'; cur[f] = cur[f].plus(s.grandTotal); map.set(k, cur); }
    for (const d of deposits) { const k = `${d.locationId}|${d.businessDate.toISOString().slice(0, 10)}`; const cur = map.get(k); if (cur) { cur.deposited = cur.deposited.plus(d.amount); cur.depositDate = d.depositedAt.toISOString().slice(0, 10); } }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.location.localeCompare(b.location));
  }
}
