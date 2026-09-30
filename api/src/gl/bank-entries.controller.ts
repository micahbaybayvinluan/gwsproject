import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, RequirePermission, Audited } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';
import { BankEntriesService } from './bank-entries.service';

const Entry = z.object({ date: z.string().optional(), bankAccountId: z.string().uuid(), direction: z.enum(['IN', 'OUT']), group: z.string(), accountId: z.string().uuid(), amount: z.number().positive(), name: z.string().optional(), reference: z.string().optional(), remarks: z.string().optional() });

@Controller('api/bank-entries')
export class BankEntriesController {
  constructor(private svc: BankEntriesService) {}
  @Get('options') @RequirePermission('bank.entry') options() { return this.svc.options(); }
  @Get() @RequirePermission('bank.entry') list(@Query('from') from?: string, @Query('to') to?: string) { return this.svc.list({ from, to }); }
  @Post() @RequirePermission('bank.entry') @Audited('JournalVoucher', 'BANK_ENTRY') create(@Body(Z(Entry)) dto: z.infer<typeof Entry>, @CurrentUser() u: SessionUser) { return this.svc.create(dto, u); }
  @Get('payables') @RequirePermission('bank.entry') payables() { return this.svc.payables(); }
  @Get('office-expenses') @RequirePermission('bank.entry') expenses(@Query('from') from?: string, @Query('to') to?: string) { return this.svc.officeExpenses({ from, to }); }
  @Get('balances') @RequirePermission('bs.accounts.view') balances(@Query('year') year?: string) { return this.svc.balances(year ? Number(year) : undefined); }
}
