import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, RequireAnyPermission, Audited } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';
import { SixPackService } from './sixpack.service';

const Redeem = z.object({ locationId: z.string().uuid().optional(), customerName: z.string().trim().min(3), phone: z.string().trim().min(10), email: z.string().trim().email(), address: z.string().trim().min(5), legacyCardNo: z.string().trim().nullable().optional(), proofAttachmentId: z.string().uuid().nullable().optional(), notes: z.string().nullable().optional() });
const Override = z.object({ locationId: z.string().uuid(), customerName: z.string().trim().nullable().optional(), phone: z.string().trim().nullable().optional(), email: z.string().trim().nullable().optional(), address: z.string().trim().nullable().optional(), reason: z.string().trim().min(5) });
const Void = z.object({ reason: z.string().trim().min(3) });

@Controller('api/six-pack')
export class SixPackController {
  constructor(private svc: SixPackService) {}
  @Get('summary') @RequireAnyPermission('sixpack.issue', 'sixpack.view.all') summary(@CurrentUser() u: SessionUser, @Query('locationId') locationId?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('search') search?: string) { return this.svc.summary(u, { locationId, from, to, search }); }
  @Get('customer') @RequireAnyPermission('sixpack.issue', 'sixpack.view.all') customer(@Query('phone') phone: string) { return this.svc.customer(phone ?? ''); }
  @Post('redeem') @RequireAnyPermission('sixpack.issue') @Audited('SixPackRedemption', 'CREATE') redeem(@CurrentUser() u: SessionUser, @Body(Z(Redeem)) dto: z.infer<typeof Redeem>) { return this.svc.redeem(u, dto); }
  @Post('override') @RequireAnyPermission('sixpack.override') @Audited('SixPackOverride', 'REQUEST') override(@CurrentUser() u: SessionUser, @Body(Z(Override)) dto: z.infer<typeof Override>) { return this.svc.requestOverride(u, dto); }
  @Post('redemptions/:id/void') @RequireAnyPermission('sale.void', 'sale.edit.postclose') @Audited('SixPackRedemption', 'VOID') voidIt(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body(Z(Void)) dto: z.infer<typeof Void>) { return this.svc.voidRedemption(u, id, dto.reason); }
}
