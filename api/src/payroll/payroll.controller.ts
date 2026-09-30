import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { PayrollService } from './payroll.service';
import { MasterDataApprovals } from '../approvals/master-data.service';
import { CurrentUser, RequirePermission, RequireAnyPermission, Audited } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';

const Emp = z.object({ employeeNo: z.string(), fullName: z.string(), locationId: z.string().uuid().nullable().optional(), position: z.string().optional(), basicRate: z.number().nonnegative(), payFrequency: z.enum(['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY']).optional(), sssNo: z.string().optional(), phicNo: z.string().optional(), hdmfNo: z.string().optional(), bankAccount: z.string().optional(), userId: z.string().uuid().nullable().optional(), active: z.boolean().optional() });
const Loan = z.object({ employeeId: z.string().uuid(), kind: z.enum(['SSS_LOAN', 'HDMF_LOAN', 'VALE', 'ADVANCE']), principal: z.number().positive(), perPeriod: z.number().positive() });
const Remit = z.object({ kind: z.enum(['SSS', 'PHIC', 'HDMF']), year: z.number().int().min(2020), month: z.number().int().min(1).max(12), referenceNo: z.string().min(1), paidAt: z.string(), paidFromAccountId: z.string().uuid().nullable().optional() });
const Run = z.object({ periodFrom: z.string(), periodTo: z.string() });
const Line = z.object({ basic: z.number().nonnegative().optional(), overtime: z.number().nonnegative().optional(), incentives: z.number().nonnegative().optional(), otherDeductions: z.number().nonnegative().optional() });
const Asset = z.object({ name: z.string(), assetAccountId: z.string().uuid(), accumDepnAccountId: z.string().uuid(), cost: z.number().positive(), salvageValue: z.number().nonnegative().optional(), usefulLifeMonths: z.number().int().positive(), startDate: z.string(), locationId: z.string().uuid().optional() });

@Controller('api/payroll')
export class PayrollController {
  constructor(private svc: PayrollService, private md: MasterDataApprovals) {}
  @Get('employees') @RequireAnyPermission('employee.manage', 'payroll.view.detail') employees() { return this.svc.employees(); }
  /** Accounts HR can link an employee record to (names and IDs only), so charges and payslips reach that person. */
  @Get('linkable-users') @RequirePermission('employee.manage') linkable() { return this.svc.linkableUsers(); }
  @Post('employees') @RequirePermission('employee.manage') @Audited('Employee', 'CREATE') async createEmployee(@Body(Z(Emp)) dto: z.infer<typeof Emp>, @CurrentUser() u: SessionUser) { const data = { ...dto, basicRate: dto.basicRate.toFixed(2) }; await this.svc.assertCompanyLocation(dto.locationId); return this.md.submit('Employee', data, u, { name: dto.fullName, employeeNo: dto.employeeNo, position: dto.position, basicRate: dto.basicRate, payFrequency: dto.payFrequency }, () => this.svc.createEmployee(data, u)); }
  @Patch('employees/:id') @RequirePermission('employee.manage') @Audited('Employee') updateEmployee(@Param('id') id: string, @Body(Z(Emp.partial())) dto: Partial<z.infer<typeof Emp>>) { return this.svc.updateEmployee(id, { ...dto, basicRate: dto.basicRate?.toFixed(2) }); }
  @Post('loans') @RequirePermission('employee.manage') @Audited('EmployeeLoan', 'CREATE') loan(@Body(Z(Loan)) dto: z.infer<typeof Loan>) { return this.svc.addLoan(dto); }
  @Get('tables') @RequireAnyPermission('payroll.edit', 'payroll.view.summary') tables() { return this.svc.tables(); }
  @Put('tables/:kind') @RequirePermission('payroll.edit') @Audited('ContributionTable') setTable(@Param('kind') kind: string, @Body() body: { effectiveFrom: string; rows: unknown }) { return this.svc.setTable(kind, body.effectiveFrom, body.rows); }
  @Get('contributions') @RequireAnyPermission('payroll.view.summary', 'payroll.view.detail') contributions(@CurrentUser() u: SessionUser, @Query('year') year: string, @Query('month') month: string) { return this.svc.contributionsRegister(Number(year), Number(month), u); }
  @Post('remittances') @RequirePermission('contribution.remit') @Audited('ContributionRemittance', 'CREATE') remit(@Body(Z(Remit)) dto: z.infer<typeof Remit>, @CurrentUser() u: SessionUser) { return this.svc.recordRemittance(dto, u); }
  @Post('tables/defaults') @RequirePermission('payroll.edit') @Audited('ContributionTable', 'DEFAULTS') defaults() { return this.svc.ensureDefaultTables(); }
  @Get('runs') @RequireAnyPermission('payroll.view.summary', 'payroll.view.detail') runs() { return this.svc.runs(); }
  @Post('runs') @RequirePermission('payroll.edit') @Audited('PayrollRun', 'CREATE') createRun(@Body(Z(Run)) dto: z.infer<typeof Run>, @CurrentUser() u: SessionUser) { return this.svc.createRun(dto.periodFrom, dto.periodTo, u); }
  @Get('runs/:id') @RequireAnyPermission('payroll.view.summary', 'payroll.view.detail') run(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.run(id, u); }
  @Patch('runs/:id/lines/:lineId') @RequirePermission('payroll.edit') @Audited('PayrollLine') line(@Param('id') id: string, @Param('lineId') lineId: string, @Body(Z(Line)) dto: z.infer<typeof Line>) { return this.svc.updateLine(id, lineId, dto); }
  @Post('runs/:id/finalize') @RequirePermission('payroll.edit') @Audited('PayrollRun', 'FINALIZE') finalize(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.finalize(id, u); }
  @Post('runs/:id/close') @RequirePermission('payroll.close') @Audited('PayrollRun', 'CLOSE') close(@Param('id') id: string, @Body() body: { paidFromAccountId: string }, @CurrentUser() u: SessionUser) { return this.svc.close(id, body.paidFromAccountId, u); }
  @Get('runs/:id/payslip/:lineId') @RequirePermission('payroll.view.detail') payslip(@Param('id') id: string, @Param('lineId') lineId: string, @CurrentUser() u: SessionUser) { return this.svc.payslip(id, lineId, u); }
  @Get('runs/:id/gov-summary') @RequireAnyPermission('payroll.view.summary', 'payroll.view.detail') gov(@Param('id') id: string) { return this.svc.govSummary(id); }
  @Get('loans') @RequireAnyPermission('employee.manage', 'payroll.view.detail') loans() { return this.svc.loanBalances(); }
  @Get('charge-ledger') @RequireAnyPermission('employee.manage', 'payroll.view.detail') chargeLedger() { return this.svc.chargeLedger(); }
  @Get('assets') @RequirePermission('gl.view') assets() { return this.svc.assets(); }
  @Post('assets') @RequirePermission('gl.account.edit') @Audited('FixedAsset', 'CREATE') createAsset(@Body(Z(Asset)) dto: z.infer<typeof Asset>) { return this.svc.createAsset(dto); }
  @Get('depreciation-schedule') @RequirePermission('gl.view') schedule() { return this.svc.schedule(); }
  @Post('depreciation/run') @RequirePermission('gl.post') @Audited('Depreciation', 'RUN') runDepn(@Body() body: { year: number; month: number }, @CurrentUser() u: SessionUser) { return this.svc.runDepreciation(body.year, body.month, u.id); }
}
