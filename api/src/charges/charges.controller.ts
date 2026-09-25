import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ChargesService } from './charges.service';
import { Audited, CurrentUser, RequireAnyPermission, RequirePermission } from '../common/decorators';
import type { SessionUser } from '../common/request-context';

@Controller('api')
export class ChargesController {
  constructor(private svc: ChargesService) {}
  /** Names of staff at a location — for "charge to" and "staff on duty" pickers. No pay data. */
  @Get('staff') @RequireAnyPermission('writeoff.create', 'charge.assign', 'charge_form.finalize', 'employee.manage', 'inspection.create')
  staff(@CurrentUser() u: SessionUser, @Query('locationId') locationId?: string) { return this.svc.staff(u, locationId); }
  @Get('me/hr') @RequirePermission('dashboard.view')
  mine(@CurrentUser() u: SessionUser) { return this.svc.mine(u); }
  @Post('me/charges/:allocationId/acknowledge') @RequirePermission('dashboard.view') @Audited('ChargeForm', 'ACKNOWLEDGE')
  ack(@Param('allocationId') id: string, @CurrentUser() u: SessionUser) { return this.svc.acknowledge(id, u); }
}
