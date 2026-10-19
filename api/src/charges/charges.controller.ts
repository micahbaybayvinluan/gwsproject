import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ChargesService } from './charges.service';
import { ChargeSourcesService, SOURCE_TYPES } from './charge-sources.service';
import { Audited, CurrentUser, RequireAnyPermission, RequirePermission } from '../common/decorators';
import type { SessionUser } from '../common/request-context';

@Controller('api')
export class ChargesController {
  constructor(private svc: ChargesService, private sources: ChargeSourcesService) {}
  /** The automatic list HR links a charge to: the types, and the documents of one type at one branch (owner request 2026-10-19). */
  @Get('charge-sources/types') @RequirePermission('charge_form.finalize') sourceTypes() { return SOURCE_TYPES.map(([key, label]) => ({ key, label })); }
  @Get('charge-sources') @RequirePermission('charge_form.finalize') sourceList(@Query('locationId') locationId: string, @Query('type') type: string, @Query('q') q?: string) { return this.sources.list({ locationId, type, q }); }
  /** Names of staff at a location — for "charge to" and "staff on duty" pickers. No pay data. */
  @Get('staff') @RequireAnyPermission('writeoff.create', 'charge.assign', 'charge_form.finalize', 'employee.manage', 'inspection.create')
  staff(@CurrentUser() u: SessionUser, @Query('locationId') locationId?: string) { return this.svc.staff(u, locationId); }
  @Get('me/hr') @RequirePermission('dashboard.view')
  mine(@CurrentUser() u: SessionUser) { return this.svc.mine(u); }
  @Get('me/branch-charges') @RequirePermission('dashboard.view')
  branchCharges(@CurrentUser() u: SessionUser) { return this.svc.branchCharges(u); }
  @Post('me/charges/:allocationId/acknowledge') @RequirePermission('dashboard.view') @Audited('ChargeForm', 'ACKNOWLEDGE')
  ack(@Param('allocationId') id: string, @CurrentUser() u: SessionUser) { return this.svc.acknowledge(id, u); }
}
