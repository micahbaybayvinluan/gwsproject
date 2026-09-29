import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { TargetsService } from './targets.service';
import { CurrentUser, RequirePermission, RequireAnyPermission, Audited } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';
import { todayManila, dateStr } from '../common/manila';

const thisMonth = () => dateStr(todayManila()).slice(0, 7);
const Target = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), kind: z.enum(['BRANCH', 'AGENT']), locationId: z.string().uuid().optional(), agentKey: z.string().min(1).optional(), amount: z.number().positive(), notes: z.string().max(500).optional() });
const Link = z.object({ userId: z.string().uuid().nullable() });

/** Sales targets per branch and per agent (Sales Manager sets, the Owner approves) and the Agent's own sales. */
@Controller('api/targets')
export class TargetsController {
  constructor(private svc: TargetsService) {}
  @Get() @RequireAnyPermission('target.view', 'target.manage') list(@Query('month') month?: string) { return this.svc.list(month || thisMonth()); }
  @Get('progress') @RequireAnyPermission('target.view', 'target.manage') progress(@CurrentUser() u: SessionUser, @Query('month') month?: string) { return this.svc.progress(month || thisMonth(), u); }
  @Get('agents') @RequireAnyPermission('target.view', 'target.manage') agents() { return this.svc.agents(); }
  @Get('agent-users') @RequireAnyPermission('target.manage', 'user.manage') agentUsers() { return this.svc.agentUsers(); }
  @Put('agents/:id/user') @RequireAnyPermission('target.manage', 'user.manage') @Audited('Agent', 'LINK_USER') link(@Param('id') id: string, @Body(Z(Link)) dto: z.infer<typeof Link>, @CurrentUser() u: SessionUser) { return this.svc.linkAgent(id, dto.userId, u); }
  @Post() @RequirePermission('target.manage') @Audited('SalesTarget', 'REQUEST') create(@Body(Z(Target)) dto: z.infer<typeof Target>, @CurrentUser() u: SessionUser) { return this.svc.request(dto, u); }
  @Get('mine') @RequirePermission('agent.self') mine(@CurrentUser() u: SessionUser, @Query('month') month?: string) { return this.svc.mine(u, month || thisMonth()); }
}
