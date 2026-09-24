import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ExpensesService } from './expenses.service';
import { CurrentUser, RequirePermission, RequireAnyPermission, Audited } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';

const Create = z.object({ locationId: z.string().uuid().optional(), docDate: z.string().optional(), accountId: z.string().uuid(), payee: z.string().optional(), amount: z.number().positive(), paidFrom: z.enum(['CASH_DRAWER', 'PETTY_CASH', 'BANK_ACCOUNT', 'OWNER_ADVANCE']), paidFromAccountId: z.string().uuid().nullable().optional(), notes: z.string().optional() });
const Void = z.object({ reason: z.string().min(3) });
const Franchise = z.object({ locationId: z.string().uuid().optional(), docDate: z.string().optional(), category: z.enum(['Rent', 'Utilities', 'Salaries', 'Supplies', 'Delivery', 'Marketing', 'Others']), payee: z.string().optional(), amount: z.number().positive(), notes: z.string().optional() });
const Deposit = z.object({ locationId: z.string().uuid().optional(), businessDate: z.string(), amount: z.number().positive(), bankAccountId: z.string().uuid(), depositedAt: z.string(), slipAttachmentId: z.string().uuid().nullable().optional() });

@Controller('api/expenses')
export class ExpensesController {
  constructor(private svc: ExpensesService) {}
  @Get('accounts') @RequireAnyPermission('expense.create.branch', 'expense.create.main') accounts(@CurrentUser() u: SessionUser, @Query('locationId') locationId?: string) { return this.svc.accountsFor(u, locationId); }
  @Get() @RequireAnyPermission('expense.view', 'expense.create.branch', 'expense.create.main') list(@CurrentUser() u: SessionUser, @Query('locationId') locationId?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('main') main?: string) { return this.svc.list(u, { locationId, from, to, main: main === undefined ? undefined : main === '1' }); }
  @Get('franchise') @RequirePermission('franchise.expense') franchiseList(@CurrentUser() u: SessionUser, @Query('locationId') locationId?: string) { return this.svc.franchiseList(u, locationId); }
  @Post('franchise') @RequirePermission('franchise.expense') @Audited('FranchiseExpense', 'CREATE') franchiseCreate(@Body(Z(Franchise)) dto: z.infer<typeof Franchise>, @CurrentUser() u: SessionUser) { return this.svc.franchiseCreate(dto, u); }
  @Get('deposits') @RequireAnyPermission('expense.view', 'expense.create.branch') deposits(@CurrentUser() u: SessionUser, @Query('locationId') locationId?: string) { return this.svc.deposits(u, locationId); }
  @Post('deposits') @RequireAnyPermission('expense.create.branch', 'expense.create.main') @Audited('CashDeposit', 'CREATE') deposit(@Body(Z(Deposit)) dto: z.infer<typeof Deposit>, @CurrentUser() u: SessionUser) { return this.svc.deposit(dto, u); }
  @Get(':id') @RequireAnyPermission('expense.view', 'expense.create.branch', 'expense.create.main') get(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.get(id, u); }
  @Post() @RequireAnyPermission('expense.create.branch', 'expense.create.main') @Audited('ExpenseDoc', 'CREATE') create(@Body(Z(Create)) dto: z.infer<typeof Create>, @CurrentUser() u: SessionUser) { return this.svc.create(dto, u); }
  @Post(':id/void') @RequireAnyPermission('expense.create.branch', 'expense.create.main') @Audited('ExpenseDoc', 'VOID') void(@Param('id') id: string, @Body(Z(Void)) dto: z.infer<typeof Void>, @CurrentUser() u: SessionUser) { return this.svc.void(id, dto.reason, u); }
}
