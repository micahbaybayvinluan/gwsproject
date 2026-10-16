import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Audited, CurrentUser, RequirePermission } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';
import { NTE_DECISIONS, NteService } from './nte.service';

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Create = z.object({ employeeId: z.string().uuid(), subject: z.string().trim().min(3).max(200), details: z.string().trim().min(5).max(8000), incidentDate: Day.nullable().optional(), replyDueOn: Day.nullable().optional() });
const FromNotice = z.object({ userIds: z.array(z.string().uuid()).optional(), employeeIds: z.array(z.string().uuid()).optional(), details: z.string().trim().max(8000).optional(), replyDueOn: Day.nullable().optional() });
const Reply = z.object({ reply: z.string().trim().min(3).max(8000) });
const Decide = z.object({ decision: z.enum(NTE_DECISIONS), note: z.string().trim().max(4000).optional() });
const Void = z.object({ reason: z.string().trim().min(3).max(500) });

/** Notice to Explain (owner request 2026-10-16). HR (hr.notice) issues, records the reply and decides; an employee reads and answers their own. */
@Controller('api')
export class NteController {
  constructor(private svc: NteService) {}
  @Get('ntes') @RequirePermission('hr.notice') list(@Query('status') status?: string, @Query('employeeId') employeeId?: string) { return this.svc.list({ status, employeeId }); }
  @Post('ntes') @RequirePermission('hr.notice') @Audited('Nte', 'CREATE') create(@Body(Z(Create)) dto: z.infer<typeof Create>, @CurrentUser() u: SessionUser) { return this.svc.create(dto, u); }
  @Post('hr-notices/:id/issue-nte') @RequirePermission('hr.notice') @Audited('HrNotice', 'ISSUE_NTE') fromNotice(@Param('id') id: string, @Body(Z(FromNotice)) dto: z.infer<typeof FromNotice>, @CurrentUser() u: SessionUser) { return this.svc.issueFromNotice(id, dto, u); }
  @Get('me/ntes') @RequirePermission('dashboard.view') mine(@CurrentUser() u: SessionUser) { return this.svc.mine(u); }
  @Get('ntes/:id') @RequirePermission('hr.notice') get(@Param('id') id: string) { return this.svc.get(id); }
  @Post('ntes/:id/reply') @RequirePermission('dashboard.view') @Audited('Nte', 'REPLY') reply(@Param('id') id: string, @Body(Z(Reply)) dto: z.infer<typeof Reply>, @CurrentUser() u: SessionUser) { return this.svc.reply(id, dto.reply, u); }
  @Post('ntes/:id/decision') @RequirePermission('hr.notice') @Audited('Nte', 'DECIDE') decide(@Param('id') id: string, @Body(Z(Decide)) dto: z.infer<typeof Decide>, @CurrentUser() u: SessionUser) { return this.svc.decide(id, dto, u); }
  @Post('ntes/:id/void') @RequirePermission('hr.notice') @Audited('Nte', 'VOID') voidIt(@Param('id') id: string, @Body(Z(Void)) dto: z.infer<typeof Void>, @CurrentUser() u: SessionUser) { return this.svc.voidIt(id, dto.reason, u); }
  @Get('ntes/:id/pdf') @RequirePermission('dashboard.view') async pdf(@Param('id') id: string, @CurrentUser() u: SessionUser, @Res() res: Response) { const o = await this.svc.pdfOf(id, u); res.setHeader('Content-Type', o.contentType); res.setHeader('Content-Disposition', `inline; filename="${o.fileName}"`); res.send(o.buffer); }
}
