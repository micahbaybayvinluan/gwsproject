import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ReceivingService } from './receiving.service';
import { CurrentUser, RequirePermission, RequireAnyPermission, Audited } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';

const Line = z.object({ productId: z.string().uuid(), qty: z.number().int().min(0), freeQty: z.number().int().min(0).optional(), expiryDate: z.string().nullable().optional(), batchNo: z.string().nullable().optional(), flavor: z.string().trim().max(60).nullable().optional(), unitCost: z.number().nonnegative().nullable().optional(), remarks: z.string().optional() }).refine((l) => l.qty + (l.freeQty ?? 0) > 0, { message: 'Quantity must be more than zero (no negative or empty lines)' });
const Create = z.object({ locationId: z.string().uuid().optional(), supplierId: z.string().uuid(), supplierRef: z.string().optional(), docDate: z.string().optional(), isConsignmentIn: z.boolean().optional(), paidOnReceipt: z.boolean().optional(), paymentAccountId: z.string().uuid().nullable().optional(), notes: z.string().optional(), lines: z.array(Line).min(1) });
const Costs = z.object({ costs: z.array(z.object({ lineId: z.string().uuid(), unitCost: z.number().nonnegative() })) });
const Void = z.object({ reason: z.string().min(3) });

@Controller('api/receiving')
export class ReceivingController {
  constructor(private svc: ReceivingService) {}
  @Get() @RequireAnyPermission('receiving.create', 'report.inventory.all', 'report.inventory.own') list(@CurrentUser() u: SessionUser, @Query('status') status?: string, @Query('locationId') locationId?: string, @Query('from') from?: string, @Query('to') to?: string) { return this.svc.list(u, { status, locationId, from, to }); }
  @Get(':id') @RequireAnyPermission('receiving.create', 'report.inventory.all', 'report.inventory.own') get(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.get(id, u); }
  @Post() @RequirePermission('receiving.create') @Audited('ReceivingDoc', 'CREATE') create(@Body(Z(Create)) dto: z.infer<typeof Create>, @CurrentUser() u: SessionUser) { return this.svc.create(dto, u); }
  @Post(':id/submit') @RequirePermission('receiving.create') @Audited('ReceivingDoc', 'SUBMIT') submit(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.submit(id, u); }
  @Post(':id/costs') @RequirePermission('cost.edit') @Audited('ReceivingDoc', 'SET_COST') costs(@Param('id') id: string, @Body(Z(Costs)) dto: z.infer<typeof Costs>, @CurrentUser() u: SessionUser) { return this.svc.setCosts(id, dto.costs, u); }
  @Post(':id/void') @RequirePermission('receiving.create') @Audited('ReceivingDoc', 'VOID') void(@Param('id') id: string, @Body(Z(Void)) dto: z.infer<typeof Void>, @CurrentUser() u: SessionUser) { return this.svc.void(id, dto.reason, u); }
}
