import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { CountsService } from './counts.service';
import { CurrentUser, RequirePermission, RequireAnyPermission, Audited } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';

const Create = z.object({ countType: z.enum(['AUDIT', 'WEEKLY']).optional(), locationId: z.string().uuid().optional(), countDate: z.string().optional(), notes: z.string().optional(), allProducts: z.boolean().optional() });
const Enter = z.object({ lines: z.array(z.object({ productId: z.string().uuid(), actualQty: z.number().int().min(0), remarks: z.string().optional() })) });
const Revision = z.object({ reason: z.string().min(3), lines: z.array(z.object({ productId: z.string().uuid(), actualQty: z.number().int().min(0), remarks: z.string().optional() })).min(1) });
const Explain = z.object({ explanation: z.string().min(5) });
const Resolve = z.object({ mode: z.enum(['ADJUST', 'RESOLVED']), note: z.string().min(1) });
const Alloc = z.object({ allocations: z.array(z.object({ employeeId: z.string().uuid(), amount: z.number().positive() })).min(1), schedule: z.object({ periods: z.number().int().positive() }).optional() });
const Manual = z.object({ locationId: z.string().uuid(), reason: z.string().min(1), kind: z.enum(['OTHER', 'DAMAGED', 'EXPIRED', 'CASH_SHORTAGE']).optional(), employeeIds: z.array(z.string().uuid()).optional(), lines: z.array(z.object({ productId: z.string().uuid().optional(), description: z.string().optional(), qty: z.number().int().positive(), unitCharge: z.number().nonnegative() })).min(1) });
const Finalize = z.object({ periods: z.number().int().positive().max(24).optional() });

@Controller('api/counts')
export class CountsController {
  constructor(private svc: CountsService) {}
  @Get() @RequireAnyPermission('count.create', 'discrepancy.view', 'report.inventory.all') list(@CurrentUser() u: SessionUser, @Query('locationId') locationId?: string) { return this.svc.list(u, locationId); }
  @Get('my-weekly') @RequirePermission('count.create') myWeekly(@CurrentUser() u: SessionUser) { return this.svc.myWeekly(u); }
  @Get(':id') @RequireAnyPermission('count.create', 'discrepancy.view', 'report.inventory.all') get(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.get(id, u); }
  @Post() @RequirePermission('count.create') @Audited('CountDoc', 'CREATE') create(@Body(Z(Create)) dto: z.infer<typeof Create>, @CurrentUser() u: SessionUser) { return this.svc.create(dto, u); }
  @Put(':id/lines') @RequirePermission('count.create') @Audited('CountDoc', 'ENTER') enter(@Param('id') id: string, @Body(Z(Enter)) dto: z.infer<typeof Enter>, @CurrentUser() u: SessionUser) { return this.svc.enter(id, dto.lines, u); }
  @Post(':id/revision') @RequirePermission('count.create') @Audited('CountDoc', 'REVISION_REQUEST') revise(@Param('id') id: string, @Body(Z(Revision)) dto: z.infer<typeof Revision>, @CurrentUser() u: SessionUser) { return this.svc.requestRevision(id, dto.lines, dto.reason, u); }
  @Post(':id/submit') @RequirePermission('count.create') @Audited('CountDoc', 'SUBMIT') submit(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.submit(id, u); }
}

@Controller('api/discrepancies')
export class DiscrepanciesController {
  constructor(private svc: CountsService) {}
  @Get() @RequireAnyPermission('discrepancy.view', 'discrepancy.resolve', 'count.create', 'discrepancy.explain') list(@CurrentUser() u: SessionUser, @Query('status') status?: string) { return this.svc.cases(u, status); }
  @Get(':id') @RequireAnyPermission('discrepancy.view', 'discrepancy.resolve', 'count.create', 'discrepancy.explain') get(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.getCase(id, u); }
  @Post(':id/resolve') @RequirePermission('discrepancy.resolve') @Audited('DiscrepancyCase', 'RESOLVE') resolve(@Param('id') id: string, @Body(Z(Resolve)) dto: z.infer<typeof Resolve>, @CurrentUser() u: SessionUser) { return this.svc.requestResolution(id, dto.mode, dto.note, u); }
  @Post(':id/explain') @RequirePermission('discrepancy.explain') @Audited('DiscrepancyCase', 'EXPLAIN') explain(@Param('id') id: string, @Body(Z(Explain)) dto: z.infer<typeof Explain>, @CurrentUser() u: SessionUser) { return this.svc.explain(id, dto.explanation, u); }
  @Post('run-deadline') @RequirePermission('settings.thresholds') run() { return this.svc.finalizeDue(); }
}

@Controller('api/charge-forms')
export class ChargeFormsController {
  constructor(private svc: CountsService) {}
  @Get() @RequireAnyPermission('charge_form.finalize', 'discrepancy.view', 'payroll.view.detail') list(@CurrentUser() u: SessionUser, @Query('kind') kind?: string, @Query('status') status?: string) { return this.svc.chargeForms(u, { kind, status }); }
  @Get(':id') @RequireAnyPermission('charge_form.finalize', 'discrepancy.view', 'payroll.view.detail') get(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.chargeForm(id, u); }
  @Post() @RequirePermission('charge_form.finalize') @Audited('ChargeForm', 'CREATE') manual(@Body(Z(Manual)) dto: z.infer<typeof Manual>, @CurrentUser() u: SessionUser) { return this.svc.createManualChargeForm(dto, u); }
  @Put(':id/allocations') @RequirePermission('charge_form.finalize') @Audited('ChargeForm', 'ALLOCATE') allocate(@Param('id') id: string, @Body(Z(Alloc)) dto: z.infer<typeof Alloc>, @CurrentUser() u: SessionUser) { return this.svc.allocate(id, dto.allocations, dto.schedule, u); }
  @Post(':id/finalize') @RequirePermission('charge_form.finalize') @Audited('ChargeForm', 'FINALIZE') finalize(@Param('id') id: string, @Body(Z(Finalize.optional())) dto: z.infer<typeof Finalize> | undefined, @CurrentUser() u: SessionUser) { return this.svc.finalize(id, u, dto?.periods ? { periods: dto.periods } : undefined); }
}

/** HR can see who follows the weekly count requirement (HR is blocked from /api/counts, so this lives under /api/hr). */
@Controller('api/hr')
export class HrComplianceController {
  constructor(private svc: CountsService) {}
  @Get('weekly-counts') @RequireAnyPermission('employee.manage', 'discrepancy.view', 'discrepancy.resolve') weekly(@Query('weeks') weeks?: string) { return this.svc.weeklyCompliance(Math.min(Math.max(Number(weeks) || 8, 1), 26)); }
}
