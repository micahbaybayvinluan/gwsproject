import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { InspectionsService } from './inspections.service';
import { Audited, CurrentUser, RequireAnyPermission, RequirePermission } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';

const Item = z.object({ key: z.string(), status: z.enum(['COMPLIED', 'NO', 'NA']).nullable(), date: z.string().nullable().optional(), amount: z.number().nonnegative().nullable().optional(), reason: z.string().nullable().optional() });
const Body_ = z.object({ locationId: z.string().uuid(), inspectionDate: z.string().optional(), staffOnDutyEmployeeId: z.string().uuid().nullable().optional(), staffOnDutyName: z.string().nullable().optional(), items: z.array(Item), comments: z.string().nullable().optional() });
const Review = z.object({ notes: z.string().optional() });

@Controller('api/inspections')
export class InspectionsController {
  constructor(private svc: InspectionsService) {}
  @Get('checklist') @RequirePermission('dashboard.view') checklist() { return this.svc.checklist(); }
  @Get() @RequirePermission('dashboard.view') list(@CurrentUser() u: SessionUser, @Query('locationId') locationId?: string, @Query('status') status?: string) { return this.svc.list(u, { locationId, status }); }
  @Get(':id') @RequirePermission('dashboard.view') get(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.get(id, u); }
  @Post() @RequirePermission('inspection.create') @Audited('StoreInspection', 'CREATE') create(@Body(Z(Body_)) dto: z.infer<typeof Body_>, @CurrentUser() u: SessionUser) { return this.svc.create(dto, u); }
  @Put(':id') @RequirePermission('inspection.create') @Audited('StoreInspection', 'UPDATE') update(@Param('id') id: string, @Body(Z(Body_.partial())) dto: Partial<z.infer<typeof Body_>>, @CurrentUser() u: SessionUser) { return this.svc.update(id, dto, u); }
  @Post(':id/submit') @RequirePermission('inspection.create') @Audited('StoreInspection', 'SUBMIT') submit(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.submit(id, u); }
  @Post(':id/acknowledge') @RequirePermission('dashboard.view') @Audited('StoreInspection', 'ACKNOWLEDGE') ack(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.acknowledge(id, u); }
  @Post(':id/review') @RequireAnyPermission('inspection.review') @Audited('StoreInspection', 'REVIEW') review(@Param('id') id: string, @Body(Z(Review)) dto: z.infer<typeof Review>, @CurrentUser() u: SessionUser) { return this.svc.review(id, dto.notes, u); }
}
