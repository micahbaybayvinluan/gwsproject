import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { AccountsService } from './accounts.service';
import { LedgerService } from './ledger.service';
import { FinReportsService } from './fin-reports.service';
import { CurrentUser, RequirePermission, RequireAnyPermission, Audited } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';

const AccountDto = z.object({ code: z.string().optional(), title: z.string().min(1), class: z.enum(['CASH', 'AR', 'INVENTORY', 'ADVANCES_TO', 'FIXED_ASSET', 'ACCUM_DEPN', 'CURRENT_LIABILITY', 'ADVANCES_FROM', 'EQUITY', 'REVENUE', 'DIRECT_COST', 'OPEX', 'OTHER_INCOME']), branchTagId: z.string().uuid().nullable().optional(), channelTag: z.string().nullable().optional(), entryScope: z.enum(['BRANCH', 'MAIN', 'BOTH']).optional(), isPaymentAccount: z.boolean().optional(), paymentAccountType: z.string().nullable().optional(), counterpartyType: z.string().nullable().optional(), counterpartyId: z.string().nullable().optional(), templateId: z.string().uuid().nullable().optional() });
const Voucher = z.object({ date: z.string(), book: z.enum(['BENTA', 'GENERAL', 'ADVANCES', 'GASTOS_OPEX', 'GASTOS_DC']), reference: z.string().optional(), remarks: z.string().optional(), name: z.string().optional(), lines: z.array(z.object({ accountId: z.string().uuid(), debit: z.number().nonnegative().optional(), credit: z.number().nonnegative().optional(), memo: z.string().optional() })).min(2) });
const BB = z.object({ rows: z.array(z.object({ accountId: z.string().uuid(), debit: z.number().nonnegative().optional(), credit: z.number().nonnegative().optional() })) });

@Controller('api/accounts')
export class AccountsController {
  constructor(private accounts: AccountsService) {}
  @Get() @RequireAnyPermission('gl.view', 'sale.create', 'expense.create.branch', 'expense.create.main') list(@Query('class') cls?: string, @Query('branchTagId') branchTagId?: string, @Query('entryScope') entryScope?: string, @Query('payment') payment?: string) { return this.accounts.list({ class: cls, branchTagId, entryScope, paymentOnly: payment === '1' }); }
  @Get('payment') @RequireAnyPermission('sale.create', 'ar.collect', 'expense.create.branch', 'expense.create.main', 'gl.view', 'contribution.remit', 'payroll.close') payment(@Query('locationId') locationId?: string) { return this.accounts.paymentAccounts(locationId); }
  @Get('templates') @RequirePermission('gl.view') templates() { return this.accounts.templates(); }
  @Get(':id') @RequirePermission('gl.view') get(@Param('id') id: string) { return this.accounts.get(id); }
  @Post() @RequirePermission('gl.account.edit') @Audited('Account', 'CREATE') create(@Body(Z(AccountDto)) dto: z.infer<typeof AccountDto>, @CurrentUser() u: SessionUser) { return this.accounts.create(dto, u.id); }
  @Put(':id') @RequirePermission('gl.account.edit') @Audited('Account') update(@Param('id') id: string, @Body(Z(AccountDto.partial())) dto: Partial<z.infer<typeof AccountDto>>, @CurrentUser() u: SessionUser) { return this.accounts.update(id, dto as never, u.id); }
  @Post('generate/:locationId') @RequirePermission('gl.account.edit') @Audited('Account', 'GENERATE_BRANCH') generate(@Param('locationId') locationId: string, @CurrentUser() u: SessionUser) { return this.accounts.generateForLocation(locationId, u.id); }
  @Post('ensure-global') @RequirePermission('gl.account.edit') @Audited('Account', 'ENSURE_GLOBAL') ensure(@CurrentUser() u: SessionUser) { return this.accounts.ensureGlobalAccounts(u.id); }
}

@Controller('api/gl')
@RequirePermission('gl.view')
export class LedgerController {
  constructor(private ledger: LedgerService, private fin: FinReportsService) {}
  @Get('vouchers') vouchers(@Query('from') from?: string, @Query('to') to?: string, @Query('book') book?: string, @Query('accountId') accountId?: string, @Query('sourceType') sourceType?: string, @Query('sourceId') sourceId?: string) { return this.ledger.vouchers({ from, to, book, accountId, sourceType, sourceId }); }
  @Get('vouchers/:id') voucher(@Param('id') id: string) { return this.ledger.voucher(id); }
  @Post('vouchers') @RequirePermission('gl.voucher.create') @Audited('JournalVoucher', 'CREATE') create(@Body(Z(Voucher)) dto: z.infer<typeof Voucher>, @CurrentUser() u: SessionUser) { return this.ledger.createManual(dto, u); }
  @Post('vouchers/:id/reverse') @RequirePermission('gl.voucher.create') @Audited('JournalVoucher', 'REVERSE') reverse(@Param('id') id: string, @Body() body: { reason: string }, @CurrentUser() u: SessionUser) { return this.ledger.reverse(id, body.reason ?? 'reversal', u); }
  @Get('ledger/:accountId') accountLedger(@Param('accountId') accountId: string, @Query('from') from?: string, @Query('to') to?: string) { return this.ledger.accountLedger(accountId, { from, to }); }
  @Get('periods') periods(@Query('year') year: string) { return this.ledger.periods(Number(year)); }
  @Post('periods/lock') @RequirePermission('gl.period.lock') @Audited('AccountingPeriod', 'LOCK_REQUEST') lock(@Body() b: { year: number; month: number; lock: boolean }, @CurrentUser() u: SessionUser) { return this.ledger.requestLock(b.year, b.month, b.lock !== false, u); }
  @Get('beginning-balances') bb(@Query('year') year: string) { return this.ledger.beginningBalances(Number(year)); }
  @Put('beginning-balances') @RequirePermission('gl.beginning_balance') @Audited('BeginningBalance', 'SET') setBb(@Query('year') year: string, @Body(Z(BB)) dto: z.infer<typeof BB>, @CurrentUser() u: SessionUser) { return this.ledger.setBeginningBalances(Number(year), dto.rows, u); }
  @Post('beginning-balances/submit') @RequirePermission('gl.beginning_balance') @Audited('BeginningBalance', 'SUBMIT') submitBb(@Query('year') year: string, @CurrentUser() u: SessionUser) { return this.ledger.submitBeginningBalances(Number(year), u); }
  @Get('trial-balance') tb(@Query('year') year: string) { return this.fin.trialBalance(Number(year)); }
  @Get('schedule/:kind') schedule(@Param('kind') kind: 'SALES' | 'DIRECT_COST' | 'OPEX' | 'ASSETS', @Query('year') year: string) { return this.fin.schedule(Number(year), kind); }
  @Get('ar-ageing') arAgeing() { return this.fin.arAgeing(); }
  @Get('ap-ageing') apAgeing() { return this.fin.apAgeing(); }
  @Get('cash-ar-daily') cashAr(@Query('year') year: string, @Query('month') month: string) { return this.fin.cashArDaily(Number(year), Number(month)); }
}

/** §9 Financial statements: ADMIN and EXTERNAL_AUDITOR only (permission fs.*). */
@Controller('api/fs')
export class FinancialStatementsController {
  constructor(private fin: FinReportsService) {}
  @Get('income-statement') @RequirePermission('fs.income_statement') is(@Query('year') year: string) { return this.fin.incomeStatement(Number(year)); }
  @Get('balance-sheet') @RequirePermission('fs.balance_sheet') bs(@Query('year') year: string) { return this.fin.balanceSheet(Number(year)); }
  @Get('ni-per-branch') @RequirePermission('fs.income_statement') ni(@Query('year') year: string, @Query('month') month?: string) { return this.fin.netIncomePerBranch(Number(year), month ? Number(month) : undefined); }
  @Get('cash-flow') @RequirePermission('fs.balance_sheet') cf(@Query('year') year: string) { return this.fin.cashFlow(Number(year)); }
}
