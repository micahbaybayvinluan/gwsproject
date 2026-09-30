import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Audited, CurrentUser, RequireAnyPermission, RequirePermission } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';
import { IncentivesService, RELEASE_MODES } from './incentives.service';

const Prepare = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), agentKey: z.string().min(1), ratePct: z.number().positive().max(100).nullable().optional(), amount: z.number().positive().nullable().optional(), notes: z.string().trim().max(500).nullable().optional() });
const Release = z.object({ mode: z.enum(RELEASE_MODES), accountId: z.string().uuid().nullable().optional(), reference: z.string().trim().max(80).nullable().optional(), date: z.string().min(8) });

/** Agent incentives (owner request 2026-09-30): Sales Manager confirms, Accounting and the Owner approve, HR releases, Accounting tags payment. */
@Controller('api/incentives')
export class IncentivesController {
  constructor(private svc: IncentivesService) {}
  @Get('month') @RequireAnyPermission('incentive.prepare', 'incentive.view') month(@Query('month') month: string) { return this.svc.month(month); }
  @Get() @RequireAnyPermission('incentive.view', 'agent.self') list(@CurrentUser() u: SessionUser, @Query('month') month?: string) { return this.svc.list(u, month); }
  @Post() @RequirePermission('incentive.prepare') @Audited('AgentIncentive', 'CREATE') prepare(@Body(Z(Prepare)) b: z.infer<typeof Prepare>, @CurrentUser() u: SessionUser) { return this.svc.prepare(b, u); }
  @Post(':id/signed') @RequirePermission('incentive.hr') @Audited('AgentIncentive', 'HR_SIGNED') signed(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.hrSigned(id, u); }
  @Post(':id/release') @RequirePermission('incentive.release') @Audited('AgentIncentive', 'RELEASED') release(@Param('id') id: string, @Body(Z(Release)) b: z.infer<typeof Release>, @CurrentUser() u: SessionUser) { return this.svc.release(id, b, u); }
}
