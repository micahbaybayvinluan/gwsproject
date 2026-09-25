import { Controller, Get, Query } from '@nestjs/common';
import { RevisionsService } from './revisions.service';
import { RequirePermission } from '../common/decorators';

@Controller('api/revisions')
export class RevisionsController {
  constructor(private svc: RevisionsService) {}
  @Get() @RequirePermission('revision.view') list(@Query('from') from?: string, @Query('to') to?: string, @Query('staffUserId') staffUserId?: string, @Query('source') source?: string) { return this.svc.list({ from, to, staffUserId, source }); }
  @Get('by-staff') @RequirePermission('revision.view') byStaff(@Query('from') from?: string, @Query('to') to?: string) { return this.svc.byStaff({ from, to }); }
}
