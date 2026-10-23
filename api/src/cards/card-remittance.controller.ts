import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, RequirePermission, Audited } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';
import { CardRemittanceService } from './card-remittance.service';

const Create = z.object({
  bankAccountId: z.string().uuid(), receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), batchRef: z.string().max(80).nullable().optional(), notes: z.string().max(500).nullable().optional(), proofAttachmentId: z.string().uuid().nullable().optional(),
  salesDocIds: z.array(z.string().uuid()).min(1).max(1000), netAmount: z.number().positive().max(999999999), fees: z.record(z.string().uuid(), z.number().min(0).max(999999999)).optional(),
});

/** Card sales cleared by the bank (owner request 2026-10-23): Accounting types the net credited, the fee is shared per sale, the Accounting Head approves. */
@Controller('api/card-remittances')
export class CardRemittanceController {
  constructor(private svc: CardRemittanceService) {}
  @Get('waiting') @RequirePermission('card.remit') waiting(@Query('locationId') locationId?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('mid') mid?: string, @Query('batch') batch?: string) { return this.svc.waiting({ locationId, from, to, mid, batch }); }
  @Get('bank-accounts') @RequirePermission('card.remit') bankAccounts() { return this.svc.bankAccounts(); }
  @Get() @RequirePermission('card.remit') list(@Query('status') status?: string) { return this.svc.list(status); }
  @Get(':id') @RequirePermission('card.remit') get(@Param('id') id: string) { return this.svc.get(id); }
  @Post() @RequirePermission('card.remit') create(@Body(Z(Create)) dto: z.infer<typeof Create>, @CurrentUser() u: SessionUser) { return this.svc.create(dto, u); }
  @Post(':id/submit') @RequirePermission('card.remit') submit(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.submit(id, u); }
  @Delete(':id') @RequirePermission('card.remit') remove(@Param('id') id: string) { return this.svc.remove(id); }
}
