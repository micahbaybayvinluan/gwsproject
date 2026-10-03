import { Body, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, RequireAnyPermission, RequirePermission } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';
import { RestockService } from './restock.service';

const Generate = z.object({ supplierIds: z.array(z.string().uuid()).max(100).optional(), basisDays: z.number().int().min(7).max(180).optional(), coverDays: z.number().int().min(7).max(180).optional(), reserveDays: z.number().int().min(0).max(60).optional(), surplusDays: z.number().int().min(7).max(365).optional() });
const Update = z.object({ notes: z.string().max(1000).nullable().optional(), expectedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), removeLineIds: z.array(z.string().uuid()).max(300).optional(),
  lines: z.array(z.object({ lineId: z.string().uuid(), orderQty: z.number().int().min(0).optional(), note: z.string().max(200).nullable().optional(), rows: z.array(z.object({ rowId: z.string().uuid(), transferQty: z.number().int().min(0).optional(), transferFromId: z.string().uuid().nullable().optional(), allocQty: z.number().int().min(0).optional() })).max(60).optional() })).max(500).optional() });
const VIEW = ['po.view', 'po.manage'] as const;

/** Restocking and purchase orders: the Head Auditor and the Owner generate, change and approve; the warehouse and the branches read what concerns them. */
@Controller('api/purchase-orders')
export class RestockController {
  constructor(private svc: RestockService) {}
  @Get('branch-plan') @RequireAnyPermission('po.view', 'po.manage', 'sale.create', 'sale.create.warehouse') branchPlan(@CurrentUser() u: SessionUser) { return this.svc.branchPlan(u); }
  @Get('open') @RequireAnyPermission('po.view', 'po.manage', 'receiving.create') open(@CurrentUser() u: SessionUser, @Query('supplierId') supplierId?: string) { return this.svc.openFor(u, supplierId); }
  @Post('generate') @RequirePermission('po.manage') generate(@Body(Z(Generate)) dto: z.infer<typeof Generate>, @CurrentUser() u: SessionUser) { return this.svc.generate(u, dto); }
  @Get() @RequireAnyPermission(...VIEW) list(@CurrentUser() u: SessionUser, @Query('status') status?: string, @Query('supplierId') supplierId?: string) { return this.svc.list(u, { status, supplierId }); }
  @Get(':id') @RequireAnyPermission(...VIEW) get(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.get(u, id); }
  @Put(':id') @RequirePermission('po.manage') update(@Param('id') id: string, @Body(Z(Update)) dto: z.infer<typeof Update>, @CurrentUser() u: SessionUser) { return this.svc.update(u, id, dto); }
  @Post(':id/lines') @RequirePermission('po.manage') addLine(@Param('id') id: string, @Body(Z(z.object({ productId: z.string().uuid(), orderQty: z.number().int().min(0) }))) dto: { productId: string; orderQty: number }, @CurrentUser() u: SessionUser) { return this.svc.addLine(u, id, dto); }
  @Post(':id/submit') @RequirePermission('po.manage') submit(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.submit(u, id); }
  @Post(':id/inform-transfers') @RequirePermission('po.manage') inform(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.informTransfers(u, id); }
  @Post(':id/sent') @RequirePermission('po.manage') sent(@Param('id') id: string, @Body(Z(z.object({ expectedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }))) dto: { expectedOn?: string | null }, @CurrentUser() u: SessionUser) { return this.svc.markSent(u, id, dto.expectedOn); }
  @Post(':id/cancel') @RequirePermission('po.manage') cancel(@Param('id') id: string, @Body(Z(z.object({ reason: z.string().trim().min(3).max(300) }))) dto: { reason: string }, @CurrentUser() u: SessionUser) { return this.svc.cancel(u, id, dto.reason); }
  @Get(':id/pdf') @RequireAnyPermission(...VIEW) async pdf(@Param('id') id: string, @Query('copy') copy: string | undefined, @CurrentUser() u: SessionUser, @Res() res: Response) {
    const o = await this.svc.print(u, id, copy === 'SUPPLIER' ? 'SUPPLIER' : copy === 'WAREHOUSE' ? 'WAREHOUSE' : 'INTERNAL');
    res.setHeader('Content-Type', o.contentType); res.setHeader('Content-Disposition', `attachment; filename="${o.fileName}"`); res.send(o.buffer);
  }
}
