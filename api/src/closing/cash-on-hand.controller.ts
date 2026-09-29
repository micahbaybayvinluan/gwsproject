import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { CashOnHandService } from './cash-on-hand.service';
import { Audited, CurrentUser, RequireAnyPermission, RequirePermission } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Extension = z.object({ locationId: z.string().uuid(), businessDate: Day, requestedUntil: Day, reason: z.string().trim().min(5, 'Say why the cash cannot be deposited on time') });
const MaxDays = z.object({ maxDays: z.number().int().min(0).max(30) });
const Notice = z.object({ status: z.enum(['OPEN', 'NTE_ISSUED', 'REFERRED', 'CLOSED']), note: z.string().max(2000).optional() });

/** Cash on hand: sales cash not yet deposited, days allowed per branch, extensions, HR notices (owner request 2026-09-27). */
@Controller('api/cash-on-hand')
export class CashOnHandController {
  constructor(private svc: CashOnHandService) {}
  @Get() @RequireAnyPermission('sale.create', 'cashdeposit.view.all') branch(@CurrentUser() u: SessionUser, @Query('locationId') locationId?: string) { return this.svc.forBranch(locationId || u.locationIds[0], u); }
  @Get('branches') @RequirePermission('cashdeposit.view.all') all() { return this.svc.allBranches(); }
  @Put('settings/:locationId') @RequirePermission('cashdeposit.settings') @Audited('Location', 'CASH_DEPOSIT_DAYS') settings(@Param('locationId') id: string, @Body(Z(MaxDays)) dto: z.infer<typeof MaxDays>, @CurrentUser() u: SessionUser) { return this.svc.setMaxDays(id, dto.maxDays, u); }
  @Post('extensions') @RequirePermission('sale.create') @Audited('CashDepositExtension', 'REQUEST') extend(@Body(Z(Extension)) dto: z.infer<typeof Extension>, @CurrentUser() u: SessionUser) { return this.svc.requestExtension(dto, u); }
  @Post('remind') @RequirePermission('settings.thresholds') remind() { return this.svc.remind(); }
}

@Controller('api/hr-notices')
export class HrNoticesController {
  constructor(private svc: CashOnHandService) {}
  @Get() @RequirePermission('hr.notice') list(@Query('status') status?: string) { return this.svc.listNotices(status); }
  @Put(':id') @RequirePermission('hr.notice') @Audited('HrNotice', 'UPDATE') update(@Param('id') id: string, @Body(Z(Notice)) dto: z.infer<typeof Notice>, @CurrentUser() u: SessionUser) { return this.svc.updateNotice(id, dto, u); }
}
