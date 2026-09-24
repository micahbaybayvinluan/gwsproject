import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../common/audit.service';
import { computeNetPay, r11PayrollDeduction, r13PayrollClose, r13PayrollFinalize, r14Depreciation } from '../gl/posting-rules';
import { toDateOnly, todayManila } from '../common/manila';
import { D, ZERO, round2 } from '../common/money';
import type { SessionUser } from '../common/request-context';
import Decimal from 'decimal.js';

/** §11 Payroll & HR. Per-employee lines visible to HR_STAFF / ACCOUNTING_HEAD / EXTERNAL_AUDITOR / ADMIN; others see totals only. */
@Injectable()
export class PayrollService {
  constructor(private prisma: PrismaService, private posting: PostingService, private accounts: AccountsService, private notify: NotificationsService, private audit: AuditService) {}

  // ── Employees ──
  employees(active = true) { return this.prisma.db.employee.findMany({ where: { active }, include: { location: { select: { code: true, name: true } }, loans: { where: { active: true } } }, orderBy: { fullName: 'asc' } }); }
  async createEmployee(data: Prisma.EmployeeUncheckedCreateInput, user: SessionUser) { const e = await this.prisma.db.employee.create({ data: { ...data, createdBy: user.id } }); await this.audit.log({ action: 'CREATE', entityType: 'Employee', entityId: e.id, after: e }); return e; }
  async updateEmployee(id: string, data: Prisma.EmployeeUncheckedUpdateInput) { const before = await this.prisma.db.employee.findUniqueOrThrow({ where: { id } }); const after = await this.prisma.db.employee.update({ where: { id }, data }); await this.audit.log({ action: 'UPDATE', entityType: 'Employee', entityId: id, before, after }); return after; }
  addLoan(data: { employeeId: string; kind: string; principal: number; perPeriod: number }) { return this.prisma.db.employeeLoan.create({ data: { ...data, principal: D(data.principal).toFixed(2), balance: D(data.principal).toFixed(2), perPeriod: D(data.perPeriod).toFixed(2) } }); }

  // ── Contribution tables (editable config) ──
  tables() { return this.prisma.db.contributionTable.findMany({ orderBy: [{ kind: 'asc' }, { effectiveFrom: 'desc' }] }); }
  setTable(kind: string, effectiveFrom: string, rows: unknown) { return this.prisma.db.contributionTable.create({ data: { kind, effectiveFrom: toDateOnly(effectiveFrom), rows: rows as Prisma.InputJsonValue } }); }
  private async contributions(basic: Decimal, date: Date): Promise<{ sssEe: Decimal; sssEr: Decimal; phicEe: Decimal; phicEr: Decimal; hdmfEe: Decimal; hdmfEr: Decimal }> {
    const t = async (kind: string) => this.prisma.db.contributionTable.findFirst({ where: { kind, effectiveFrom: { lte: date } }, orderBy: { effectiveFrom: 'desc' } });
    const sss = await t('SSS'); const phic = await t('PHIC'); const hdmf = await t('HDMF');
    const bracket = (rows: { from: number; to: number; ee: number; er: number }[] | undefined) => { const r = rows?.find((x) => basic.gte(x.from) && basic.lte(x.to)) ?? rows?.[rows.length - 1]; return { ee: D(r?.ee ?? 0), er: D(r?.er ?? 0) }; };
    const rate = (cfg: { rateEe: number; rateEr: number; min?: number; max?: number } | undefined) => { if (!cfg) return { ee: ZERO, er: ZERO }; const base = Decimal.min(Decimal.max(basic, cfg.min ?? 0), cfg.max ?? basic); return { ee: round2(base.mul(cfg.rateEe)), er: round2(base.mul(cfg.rateEr)) }; };
    const s = bracket(sss?.rows as never), p = rate(phic?.rows as never), h = rate(hdmf?.rows as never);
    return { sssEe: s.ee, sssEr: s.er, phicEe: p.ee, phicEr: p.er, hdmfEe: h.ee, hdmfEr: h.er };
  }

  // ── Runs ──
  runs() { return this.prisma.db.payrollRun.findMany({ orderBy: { periodFrom: 'desc' }, include: { _count: { select: { lines: true } } } }); }
  async run(id: string, user: SessionUser) {
    const r = await this.prisma.db.payrollRun.findUnique({ where: { id }, include: { lines: { include: { employee: { select: { id: true, employeeNo: true, fullName: true, locationId: true } } } } } });
    if (!r) throw new NotFoundException();
    const totals = this.totals(r.lines);
    if (!user.permissions.has('payroll.view.detail')) return { ...r, lines: undefined, totals };
    return { ...r, totals };
  }
  private totals(lines: { basic: Decimal; overtime: Decimal; incentives: Decimal; netPay: Decimal; sssEe: Decimal; sssEr: Decimal; phicEe: Decimal; phicEr: Decimal; hdmfEe: Decimal; hdmfEr: Decimal; loans: Decimal; chargeDeductions: Decimal; thirteenthMonthAccrual: Decimal }[]) {
    const s = (k: keyof (typeof lines)[number]) => lines.reduce((t, l) => t.plus(l[k] as Decimal), ZERO);
    return { employees: lines.length, gross: s('basic').plus(s('overtime')).plus(s('incentives')), netPay: s('netPay'), sss: s('sssEe').plus(s('sssEr')), phic: s('phicEe').plus(s('phicEr')), hdmf: s('hdmfEe').plus(s('hdmfEr')), loans: s('loans'), chargeDeductions: s('chargeDeductions'), thirteenthMonthAccrual: s('thirteenthMonthAccrual') };
  }
  /** Create a run and pre-fill lines: basic from employee master (per period), contributions from tables, loans, charge-form deductions from finalized charge forms. */
  async createRun(periodFrom: string, periodTo: string, user: SessionUser) {
    const from = toDateOnly(periodFrom), to = toDateOnly(periodTo);
    const employees = await this.prisma.db.employee.findMany({ where: { active: true }, include: { loans: { where: { active: true } }, chargeAllocations: { include: { chargeForm: true } } } });
    return this.prisma.db.$transaction(async (tx) => {
      const run = await tx.payrollRun.create({ data: { periodFrom: from, periodTo: to, createdBy: user.id } });
      for (const e of employees) {
        const periodsPerMonth = e.payFrequency === 'MONTHLY' ? 1 : e.payFrequency === 'WEEKLY' ? 4 : 2;
        const basic = round2(D(e.basicRate).div(periodsPerMonth));
        const c = await this.contributions(D(e.basicRate), to);
        const loans = e.loans.reduce((s, l) => s.plus(Decimal.min(l.perPeriod, l.balance)), ZERO);
        const charges = e.chargeAllocations.filter((a) => a.chargeForm.finalizedByHrAt && D(a.amount).gt(a.deductedToDate)).reduce((s, a) => { const sched = (a.chargeForm.payrollDeductionSchedule as { employeeId: string; perPeriod: number }[] | null)?.find((x) => x.employeeId === e.id); const remaining = D(a.amount).minus(a.deductedToDate); return s.plus(sched ? Decimal.min(sched.perPeriod, remaining) : remaining); }, ZERO);
        const line = { basic, overtime: ZERO, incentives: ZERO, thirteenth: round2(basic.div(12)), sssEe: periodsPerMonth === 1 ? c.sssEe : round2(c.sssEe.div(periodsPerMonth)), sssEr: periodsPerMonth === 1 ? c.sssEr : round2(c.sssEr.div(periodsPerMonth)), phicEe: round2(c.phicEe.div(periodsPerMonth)), phicEr: round2(c.phicEr.div(periodsPerMonth)), hdmfEe: round2(c.hdmfEe.div(periodsPerMonth)), hdmfEr: round2(c.hdmfEr.div(periodsPerMonth)), sssLoan: e.loans.filter((l) => l.kind === 'SSS_LOAN').reduce((s, l) => s.plus(Decimal.min(l.perPeriod, l.balance)), ZERO), hdmfLoan: e.loans.filter((l) => l.kind === 'HDMF_LOAN').reduce((s, l) => s.plus(Decimal.min(l.perPeriod, l.balance)), ZERO), advances: e.loans.filter((l) => l.kind === 'VALE' || l.kind === 'ADVANCE').reduce((s, l) => s.plus(Decimal.min(l.perPeriod, l.balance)), ZERO), chargeDeductions: charges };
        void loans;
        const netPay = computeNetPay({ ...line, sssLoan: line.sssLoan, hdmfLoan: line.hdmfLoan });
        await tx.payrollLine.create({ data: { runId: run.id, employeeId: e.id, basic: basic.toFixed(2), thirteenthMonthAccrual: line.thirteenth.toFixed(2), sssEe: line.sssEe.toFixed(2), sssEr: line.sssEr.toFixed(2), phicEe: line.phicEe.toFixed(2), phicEr: line.phicEr.toFixed(2), hdmfEe: line.hdmfEe.toFixed(2), hdmfEr: line.hdmfEr.toFixed(2), loans: line.sssLoan.plus(line.hdmfLoan).plus(line.advances).toFixed(2), chargeDeductions: charges.toFixed(2), netPay: netPay.toFixed(2) } });
      }
      return run;
    });
  }
  async updateLine(runId: string, lineId: string, patch: { basic?: number; overtime?: number; incentives?: number; otherDeductions?: number }) {
    const run = await this.prisma.db.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    if (run.status !== 'DRAFT') throw new BadRequestException('Run is not editable');
    const l = await this.prisma.db.payrollLine.findUniqueOrThrow({ where: { id: lineId } });
    const n = { basic: D(patch.basic ?? l.basic), overtime: D(patch.overtime ?? l.overtime), incentives: D(patch.incentives ?? l.incentives), other: D(patch.otherDeductions ?? l.otherDeductions) };
    const netPay = computeNetPay({ basic: n.basic, overtime: n.overtime, incentives: n.incentives, thirteenth: 0, sssEe: l.sssEe, sssEr: 0, phicEe: l.phicEe, phicEr: 0, hdmfEe: l.hdmfEe, hdmfEr: 0, sssLoan: 0, hdmfLoan: 0, advances: l.loans, chargeDeductions: l.chargeDeductions }).minus(n.other);
    return this.prisma.db.payrollLine.update({ where: { id: lineId }, data: { basic: n.basic.toFixed(2), overtime: n.overtime.toFixed(2), incentives: n.incentives.toFixed(2), otherDeductions: n.other.toFixed(2), thirteenthMonthAccrual: round2(n.basic.div(12)).toFixed(2), netPay: netPay.toFixed(2) } });
  }
  /** HR finalizes → R13 posts; loans/charge balances reduced. */
  async finalize(runId: string, user: SessionUser) {
    const run = await this.prisma.db.payrollRun.findUniqueOrThrow({ where: { id: runId }, include: { lines: { include: { employee: { include: { loans: { where: { active: true } }, chargeAllocations: { include: { chargeForm: true } } } } } } } });
    if (run.status !== 'DRAFT') throw new BadRequestException('Run already finalized');
    await this.prisma.db.$transaction(async (tx) => {
      const vouchers = await this.posting.post(tx, { type: 'PayrollRun', id: run.id, date: run.periodTo, createdBy: user.id }, (r) => r13PayrollFinalize(r, { ref: `${run.periodFrom.toISOString().slice(0, 10)}..${run.periodTo.toISOString().slice(0, 10)}`, lines: run.lines.map((l) => { const sssLoan = l.employee.loans.filter((x) => x.kind === 'SSS_LOAN').reduce((s, x) => s.plus(Decimal.min(x.perPeriod, x.balance)), ZERO); const hdmfLoan = l.employee.loans.filter((x) => x.kind === 'HDMF_LOAN').reduce((s, x) => s.plus(Decimal.min(x.perPeriod, x.balance)), ZERO); return { employeeId: l.employeeId, costCentreLocationId: l.employee.locationId, basic: l.basic, overtime: l.overtime, incentives: l.incentives, thirteenth: l.thirteenthMonthAccrual, sssEe: l.sssEe, sssEr: l.sssEr, phicEe: l.phicEe, phicEr: l.phicEr, hdmfEe: l.hdmfEe, hdmfEr: l.hdmfEr, sssLoan, hdmfLoan, advances: D(l.loans).minus(sssLoan).minus(hdmfLoan), chargeDeductions: l.chargeDeductions, netPay: l.netPay }; }) }));
      for (const l of run.lines) {
        for (const loan of l.employee.loans) { const ded = Decimal.min(loan.perPeriod, loan.balance); const bal = D(loan.balance).minus(ded); await tx.employeeLoan.update({ where: { id: loan.id }, data: { balance: bal.toFixed(2), active: bal.gt(0) } }); }
        let remaining = D(l.chargeDeductions);
        for (const a of l.employee.chargeAllocations.filter((x) => x.chargeForm.finalizedByHrAt)) { if (remaining.lte(0)) break; const open = D(a.amount).minus(a.deductedToDate); const ded = Decimal.min(open, remaining); if (ded.lte(0)) continue; await tx.chargeFormAllocation.update({ where: { id: a.id }, data: { deductedToDate: { increment: ded.toFixed(2) } } }); remaining = remaining.minus(ded); if (l.employee.locationId) await this.posting.post(tx, { type: 'ChargeForm', id: a.chargeFormId, date: run.periodTo, createdBy: user.id }, (r) => r11PayrollDeduction(r, { locationId: l.employee.locationId!, amount: ded, ref: a.chargeForm.controlNo })); }
      }
      await tx.payrollRun.update({ where: { id: runId }, data: { status: 'FINALIZED', finalizedAt: new Date(), finalizedBy: user.id, finalizeVoucherId: vouchers[0]?.id ?? null } });
    });
    await this.notify.toRoles(['ACCOUNTING_HEAD'], { type: 'PAYROLL_FINALIZED', title: `Payroll ${run.periodFrom.toISOString().slice(0, 10)}–${run.periodTo.toISOString().slice(0, 10)} finalized; pick paying account to close`, link: `/payroll/${runId}` });
    await this.audit.log({ action: 'FINALIZE', entityType: 'PayrollRun', entityId: runId });
    return this.run(runId, user);
  }
  /** Accounting Head closes by choosing the paying account (R13 close). */
  async close(runId: string, paidFromAccountId: string, user: SessionUser) {
    const run = await this.prisma.db.payrollRun.findUniqueOrThrow({ where: { id: runId }, include: { lines: true } });
    if (run.status !== 'FINALIZED') throw new BadRequestException('Run must be finalized first');
    const net = run.lines.reduce((s, l) => s.plus(l.netPay), ZERO);
    await this.prisma.db.$transaction(async (tx) => {
      const v = await this.posting.post(tx, { type: 'PayrollRun', id: run.id, date: todayManila(), createdBy: user.id }, (r) => r13PayrollClose(r, { ref: run.id.slice(0, 8), netTotal: net, paymentAccountId: paidFromAccountId }));
      await tx.payrollRun.update({ where: { id: runId }, data: { status: 'CLOSED', closedAt: new Date(), closedBy: user.id, paidFromAccountId, closeVoucherId: v[0]?.id ?? null } });
    });
    await this.audit.log({ action: 'CLOSE', entityType: 'PayrollRun', entityId: runId, after: { paidFromAccountId, net } });
    return this.run(runId, user);
  }
  /** Payslip data for one employee line. */
  async payslip(runId: string, lineId: string, user: SessionUser) { if (!user.permissions.has('payroll.view.detail')) throw new ForbiddenException(); return this.prisma.db.payrollLine.findUniqueOrThrow({ where: { id: lineId }, include: { employee: true, run: true } }); }
  /** Reports: register, government contributions, loan balances, charge-form ledger, 13th-month accrual. */
  async govSummary(runId: string) { const lines = await this.prisma.db.payrollLine.findMany({ where: { runId } }); return this.totals(lines); }
  loanBalances() { return this.prisma.db.employeeLoan.findMany({ where: { active: true }, include: { employee: { select: { employeeNo: true, fullName: true } } } }); }
  chargeLedger() { return this.prisma.db.chargeFormAllocation.findMany({ include: { employee: { select: { employeeNo: true, fullName: true } }, chargeForm: { select: { controlNo: true, finalizedByHrAt: true } } } }); }

  // ── Fixed assets & depreciation (R14) ──
  assets() { return this.prisma.db.fixedAsset.findMany({ include: { assetAccount: { select: { title: true } }, accumDepnAccount: { select: { title: true } }, depreciations: true } }); }
  createAsset(data: { name: string; assetAccountId: string; accumDepnAccountId: string; cost: number; salvageValue?: number; usefulLifeMonths: number; startDate: string; locationId?: string }) { return this.prisma.db.fixedAsset.create({ data: { ...data, cost: D(data.cost).toFixed(2), salvageValue: D(data.salvageValue ?? 0).toFixed(2), startDate: toDateOnly(data.startDate) } }); }
  /** Depreciation schedule: straight-line monthly amounts per asset. */
  async schedule() { const assets = await this.prisma.db.fixedAsset.findMany({ where: { active: true } }); return assets.map((a) => { const monthly = round2(D(a.cost).minus(a.salvageValue).div(a.usefulLifeMonths)); const end = new Date(a.startDate); end.setUTCMonth(end.getUTCMonth() + a.usefulLifeMonths - 1); return { id: a.id, name: a.name, cost: a.cost, salvageValue: a.salvageValue, usefulLifeMonths: a.usefulLifeMonths, start: a.startDate, end, monthly }; }); }
  async runDepreciation(year: number, month: number, actorId: string | null) {
    const assets = await this.prisma.db.fixedAsset.findMany({ where: { active: true } });
    const period = new Date(Date.UTC(year, month - 1, 1)); const entries: { asset: (typeof assets)[number]; amount: Decimal }[] = [];
    for (const a of assets) {
      const end = new Date(a.startDate); end.setUTCMonth(end.getUTCMonth() + a.usefulLifeMonths);
      if (period < new Date(Date.UTC(a.startDate.getUTCFullYear(), a.startDate.getUTCMonth(), 1)) || period >= end) continue;
      if (await this.prisma.db.depreciationEntry.findUnique({ where: { assetId_year_month: { assetId: a.id, year, month } } })) continue;
      entries.push({ asset: a, amount: round2(D(a.cost).minus(a.salvageValue).div(a.usefulLifeMonths)) });
    }
    if (!entries.length) return { posted: 0 };
    const monthEnd = new Date(Date.UTC(year, month, 0));
    await this.prisma.db.$transaction(async (tx) => {
      const r = await this.accounts.resolver(tx);
      let expenseId: string | null = null; try { expenseId = r.global('DEPRECIATION_EXPENSE'); } catch { expenseId = null; }
      const vouchers = expenseId ? await this.posting.post(tx, { type: 'Depreciation', id: `${year}-${month}`, date: monthEnd, createdBy: actorId }, () => r14Depreciation(r, { assets: entries.map((e) => ({ accumDepnAccountId: e.asset.accumDepnAccountId, amount: e.amount, name: e.asset.name })), depreciationExpenseAccountId: expenseId!, ref: `${year}-${String(month).padStart(2, '0')}` })) : [];
      for (const e of entries) await tx.depreciationEntry.create({ data: { assetId: e.asset.id, year, month, amount: e.amount.toFixed(2), voucherId: vouchers[0]?.id ?? null } });
    });
    return { posted: entries.length };
  }
}
