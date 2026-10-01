import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Audited, CurrentUser, RequireAnyPermission } from '../common/decorators';
import type { SessionUser } from '../common/request-context';
import { MarketingPulloutService } from './marketing-pullout.service';

@Controller('api/marketing-pullouts')
export class MarketingPulloutController {
  constructor(private svc: MarketingPulloutService) {}
  /** Summary of the stock given out to Prothin Marketing / GWS Marketing / BO and what has been expensed. */
  @Get('summary') @RequireAnyPermission('marketing.summary', 'transfer.create', 'report.inventory.own') summary(@CurrentUser() u: SessionUser, @Query('from') from?: string, @Query('to') to?: string, @Query('destination') destination?: string, @Query('locationId') locationId?: string) { return this.svc.summary(u, { from, to, destination, locationId }); }
  @Post(':id/endorse') @RequireAnyPermission('transfer.create', 'approval.act.MARKETING_PULLOUT') @Audited('TransferDoc', 'ENDORSE_EXPENSE') endorse(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.endorse(id, u); }
}
