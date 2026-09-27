import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { CustomerFollowUpsService } from './customer-followups.service';
import { Audited, CurrentUser, RequireAnyPermission, RequirePermission } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';

const Update = z.object({ status: z.enum(['CONTACTED', 'DISMISSED', 'NOTIFIED']), note: z.string().max(1000).optional() });
const Send = z.object({ channel: z.enum(['SMS', 'EMAIL']), to: z.string().trim().max(200).optional(), subject: z.string().max(200).optional(), body: z.string().max(2000).optional(), followUpId: z.string().uuid().optional() });

/** Customer re-order follow-ups and messages to customers (owner request 2026-09-27). */
@Controller('api/customer-follow-ups')
export class CustomerFollowUpsController {
  constructor(private svc: CustomerFollowUpsService) {}
  @Get() @RequireAnyPermission('report.sales.own', 'report.sales.all') list(@CurrentUser() u: SessionUser, @Query('status') status?: string, @Query('locationId') locationId?: string) { return this.svc.list(u, { status, locationId }); }
  @Put(':id') @RequireAnyPermission('sale.create', 'report.sales.all') @Audited('CustomerFollowUp', 'UPDATE') update(@Param('id') id: string, @Body(Z(Update)) dto: z.infer<typeof Update>, @CurrentUser() u: SessionUser) { return this.svc.update(id, dto, u); }
  @Get(':id/preview') @RequireAnyPermission('sale.create', 'report.sales.all') preview(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.preview(id, u); }
  @Post('send') @RequireAnyPermission('sale.create', 'report.sales.all') @Audited('CustomerMessage', 'SEND') send(@Body(Z(Send)) dto: z.infer<typeof Send>, @CurrentUser() u: SessionUser) { return this.svc.send(dto, u); }
  @Get('messages') @RequireAnyPermission('report.sales.own', 'report.sales.all') messages(@Query('followUpId') followUpId?: string) { return this.svc.messages(followUpId); }
  @Post('run') @RequirePermission('settings.thresholds') run() { return this.svc.runDaily(); }
}
