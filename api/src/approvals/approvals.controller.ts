import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ApprovalsService } from './approvals.service';
import { CurrentUser, Audited } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';

const Decide = z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().max(1000).optional() });
const Bulk = Decide.extend({ ids: z.array(z.string().uuid()).min(1) });

@Controller('api/approvals')
export class ApprovalsController {
  constructor(private approvals: ApprovalsService) {}
  @Get('inbox') inbox(@CurrentUser() u: SessionUser, @Query('type') type?: string) { return this.approvals.inbox(u, type); }
  @Get('mine') mine(@CurrentUser() u: SessionUser) { return this.approvals.mine(u.id); }
  @Get('document/:type/:id') forDoc(@Param('type') type: string, @Param('id') id: string) { return this.approvals.forDocument(type, id); }
  @Get(':id') get(@Param('id') id: string) { return this.approvals.get(id); }
  @Post('bulk') @Audited('ApprovalRequest', 'BULK_DECIDE') bulk(@CurrentUser() u: SessionUser, @Body(Z(Bulk)) dto: z.infer<typeof Bulk>) { return this.approvals.decideBulk(dto.ids, u, dto.decision, dto.note); }
  @Post(':id/decide') @Audited('ApprovalRequest', 'DECIDE') decide(@Param('id') id: string, @CurrentUser() u: SessionUser, @Body(Z(Decide)) dto: z.infer<typeof Decide>) { return this.approvals.decide(id, u, dto.decision, dto.note); }
}
