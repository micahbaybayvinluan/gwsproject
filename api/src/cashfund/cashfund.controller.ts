import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { CashFundService } from './cashfund.service';
import { Audited, CurrentUser, RequireAnyPermission, RequirePermission } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';

const VIEW = ['cashfund.view.all', 'cashfund.manage', 'cashfund.use', 'cashfund.check', 'cashfund.spend', 'franchise.shipping.fill'] as const;
const Setup = z.object({ imprestAmount: z.number().positive(), fundedFromAccountId: z.string().uuid().nullable().optional(), purpose: z.enum(['GENERAL', 'OFFICE', 'FRANCHISE']).optional(), name: z.string().trim().min(2).max(80).optional() });
const TopUp = z.object({ amount: z.number().positive(), fromAccountId: z.string().uuid(), notes: z.string().max(200).optional() });
const Replenish = z.object({ amount: z.number().positive().optional(), date: z.string().optional() });
const Check = z.object({ countedAmount: z.number().nonnegative(), reason: z.string().optional() });

/** `:id` is a cash fund id, or a location id (the branch's own fund; a warehouse has an Office and a Franchise fund). */
@Controller('api/cash-funds')
export class CashFundController {
  constructor(private svc: CashFundService) {}
  @Get() @RequireAnyPermission(...VIEW) list(@CurrentUser() u: SessionUser, @Query('purpose') purpose?: string) { return this.svc.list(u, { purpose }); }
  @Get(':id') @RequireAnyPermission(...VIEW) get(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.get(id, u); }
  @Get(':id/franchise-drs') @RequireAnyPermission(...VIEW) franchiseDrs(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.franchiseDrs(id, u); }
  @Put(':id') @RequirePermission('cashfund.manage') @Audited('CashFund', 'SETUP') setup(@Param('id') id: string, @Body(Z(Setup)) dto: z.infer<typeof Setup>, @CurrentUser() u: SessionUser) { return this.svc.setup(id, dto, u); }
  @Post(':id/top-up') @RequirePermission('cashfund.manage') @Audited('CashFund', 'TOPUP') topUp(@Param('id') id: string, @Body(Z(TopUp)) dto: z.infer<typeof TopUp>, @CurrentUser() u: SessionUser) { return this.svc.topUp(id, dto, u); }
  @Post(':id/replenish') @RequireAnyPermission('cashfund.use', 'cashfund.manage') @Audited('CashFund', 'REPLENISH') replenish(@Param('id') id: string, @Body(Z(Replenish)) dto: z.infer<typeof Replenish>, @CurrentUser() u: SessionUser) { return this.svc.replenish(id, dto, u); }
  @Post(':id/check') @RequirePermission('cashfund.check') @Audited('CashFund', 'CHECK') check(@Param('id') id: string, @Body(Z(Check)) dto: z.infer<typeof Check>, @CurrentUser() u: SessionUser) { return this.svc.check(id, dto, u); }
}
