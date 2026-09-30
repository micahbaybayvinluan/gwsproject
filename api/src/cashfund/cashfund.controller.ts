import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { CashFundService } from './cashfund.service';
import { Audited, CurrentUser, RequireAnyPermission, RequirePermission } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';

const Setup = z.object({ imprestAmount: z.number().positive(), fundedFromAccountId: z.string().uuid().nullable().optional() });
const Replenish = z.object({ amount: z.number().positive().optional(), date: z.string().optional() });
const Check = z.object({ countedAmount: z.number().nonnegative(), reason: z.string().optional() });

@Controller('api/cash-funds')
export class CashFundController {
  constructor(private svc: CashFundService) {}
  @Get() @RequireAnyPermission('cashfund.view.all', 'cashfund.manage', 'cashfund.use', 'cashfund.check') list(@CurrentUser() u: SessionUser) { return this.svc.list(u); }
  @Get(':locationId') @RequireAnyPermission('cashfund.view.all', 'cashfund.manage', 'cashfund.use', 'cashfund.check') get(@Param('locationId') id: string, @CurrentUser() u: SessionUser) { return this.svc.get(id, u); }
  @Put(':locationId') @RequirePermission('cashfund.manage') @Audited('CashFund', 'SETUP') setup(@Param('locationId') id: string, @Body(Z(Setup)) dto: z.infer<typeof Setup>, @CurrentUser() u: SessionUser) { return this.svc.setup(id, dto, u); }
  @Post(':locationId/replenish') @RequireAnyPermission('cashfund.use', 'cashfund.manage') @Audited('CashFund', 'REPLENISH') replenish(@Param('locationId') id: string, @Body(Z(Replenish)) dto: z.infer<typeof Replenish>, @CurrentUser() u: SessionUser) { return this.svc.replenish(id, dto, u); }
  @Post(':locationId/check') @RequirePermission('cashfund.check') @Audited('CashFund', 'CHECK') check(@Param('locationId') id: string, @Body(Z(Check)) dto: z.infer<typeof Check>, @CurrentUser() u: SessionUser) { return this.svc.check(id, dto, u); }
}
