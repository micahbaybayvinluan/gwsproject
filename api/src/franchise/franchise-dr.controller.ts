import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, RequirePermission, Audited } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';
import { FranchiseDrService } from './franchise-dr.service';

const Problem = z.object({ note: z.string().trim().min(3).max(500) });

@Controller('api/franchise-drs')
export class FranchiseDrController {
  constructor(private svc: FranchiseDrService) {}
  @Get() @RequirePermission('franchise.dr.view') list(@CurrentUser() u: SessionUser, @Query('status') status?: string) { return this.svc.list(u, { status }); }
  @Get('sale/:saleId') @RequirePermission('franchise.dr.view') forSale(@Param('saleId') saleId: string) { return this.svc.forSale(saleId); }
  @Post(':id/receive') @RequirePermission('franchise.dr.receive') @Audited('FranchiseDrReceipt', 'RECEIVE') receive(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.receive(u, id); }
  @Post(':id/problem') @RequirePermission('franchise.dr.receive') problem(@Param('id') id: string, @Body(Z(Problem)) dto: z.infer<typeof Problem>, @CurrentUser() u: SessionUser) { return this.svc.dispute(u, id, dto.note); }
}
