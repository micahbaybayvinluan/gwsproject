import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { TransfersService } from './transfers.service';
import { TransferDiscrepancyService } from './transfer-discrepancy.service';
import { CurrentUser, RequirePermission, RequireAnyPermission, Audited } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';

const Line = z.object({ productId: z.string().uuid(), qty: z.number().int().positive(), batchId: z.string().uuid().nullable().optional(), exactBatch: z.boolean().optional(), checkerRemarks: z.string().optional() });
const Create = z.object({ fromLocationId: z.string().uuid().optional(), toLocationId: z.string().uuid(), transferType: z.enum(['RESTOCK', 'RETURN', 'REPLACEMENT', 'CONSIGNMENT_OUT', 'CONSIGNMENT_RETURN', 'INTERNAL', 'MARKETING_PULLOUT']), endorseExpense: z.boolean().optional(), returnReason: z.string().optional(), docDate: z.string().optional(), notes: z.string().optional(), lines: z.array(Line).min(1) });
const Confirm = z.object({ lines: z.array(z.object({ lineId: z.string().uuid(), checked: z.boolean().optional(), qtyReceived: z.number().int().min(0).optional(), discrepancyNote: z.string().optional() })), extras: z.array(z.object({ productId: z.string().uuid(), qty: z.number().int().positive(), note: z.string().optional() })).optional() });
const Resolve = z.object({ resolution: z.enum(['TO_SENDER', 'TO_RECEIVER', 'WRITEOFF']) });
const Void = z.object({ reason: z.string().min(3) });
const StockRequest = z.object({ locationId: z.string().uuid().optional(), items: z.array(z.object({ productId: z.string().uuid(), qty: z.number().int().positive() })).min(1), notes: z.string().optional() });
const WriteoffCharge = z.object({ chargeTo: z.enum(['COMPANY', 'STAFF']), employeeIds: z.array(z.string().uuid()).default([]) });
const Writeoff = z.object({ chargeTo: z.enum(['COMPANY', 'STAFF']).optional(), employeeIds: z.array(z.string().uuid()).optional(), locationId: z.string().uuid().optional(), docDate: z.string().optional(), notes: z.string().optional(), lines: z.array(z.object({ productId: z.string().uuid(), batchId: z.string().uuid(), qty: z.number().int().positive(), reason: z.enum(['EXPIRED', 'DAMAGED', 'SPOILED']) })).min(1) });

@Controller('api/transfers')
export class TransfersController {
  constructor(private svc: TransfersService) {}
  @Get() @RequireAnyPermission('transfer.create', 'transfer.confirm', 'report.inventory.all', 'report.inventory.own') list(@CurrentUser() u: SessionUser, @Query('direction') direction?: 'out' | 'in', @Query('status') status?: string, @Query('locationId') locationId?: string, @Query('branchIds') branchIds?: string, @Query('from') from?: string, @Query('to') to?: string) { return this.svc.list(u, { direction, status, locationId, branchIds: branchIds ? branchIds.split(',').filter(Boolean) : undefined, from, to }); }
  @Post('request-stock') @RequireAnyPermission('transfer.confirm', 'transfer.create') @Audited('Location', 'STOCK_REQUEST') requestStock(@Body(Z(StockRequest)) dto: z.infer<typeof StockRequest>, @CurrentUser() u: SessionUser) { return this.svc.requestStock(dto, u); }
  @Get(':id') @RequireAnyPermission('transfer.create', 'transfer.confirm', 'report.inventory.all', 'report.inventory.own') get(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.get(id, u); }
  @Post() @RequirePermission('transfer.create') @Audited('TransferDoc', 'CREATE') create(@Body(Z(Create)) dto: z.infer<typeof Create>, @CurrentUser() u: SessionUser) { return this.svc.create(dto, u); }
  @Post(':id/submit') @RequirePermission('transfer.create') @Audited('TransferDoc', 'SUBMIT') submit(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.submit(id, u); }
  @Post(':id/confirm') @RequirePermission('transfer.confirm') @Audited('TransferDoc', 'CONFIRM') confirm(@Param('id') id: string, @Body(Z(Confirm)) dto: z.infer<typeof Confirm>, @CurrentUser() u: SessionUser) { return this.svc.confirm(id, dto.lines, u, dto.extras ?? []); }
  @Post(':id/resolve') @RequirePermission('transfer.resolve_discrepancy') @Audited('TransferDoc', 'RESOLVE') resolve(@Param('id') id: string, @Body(Z(Resolve)) dto: z.infer<typeof Resolve>, @CurrentUser() u: SessionUser) { return this.svc.resolveShortfall(id, dto.resolution, u); }
  @Post(':id/void') @RequirePermission('transfer.create') @Audited('TransferDoc', 'VOID') void(@Param('id') id: string, @Body(Z(Void)) dto: z.infer<typeof Void>, @CurrentUser() u: SessionUser) { return this.svc.void(id, dto.reason, u); }
}

@Controller('api/writeoffs')
export class WriteoffsController {
  constructor(private svc: TransfersService) {}
  @Get() @RequireAnyPermission('writeoff.create', 'writeoff.approve', 'report.inventory.all') list(@CurrentUser() u: SessionUser) { return this.svc.listWriteoffs(u); }
  @Post() @RequirePermission('writeoff.create') @Audited('ExpiryWriteoffDoc', 'CREATE') create(@Body(Z(Writeoff)) dto: z.infer<typeof Writeoff>, @CurrentUser() u: SessionUser) { return this.svc.createWriteoff(dto, u); }
  @Put(':id/charge') @RequireAnyPermission('writeoff.approve', 'charge.assign') @Audited('ExpiryWriteoffDoc', 'SET_CHARGE_TO') charge(@Param('id') id: string, @Body(Z(WriteoffCharge)) dto: z.infer<typeof WriteoffCharge>, @CurrentUser() u: SessionUser) { return this.svc.setWriteoffCharge(id, dto.chargeTo, dto.employeeIds, u); }
}

const DiffDecide = z.object({ outcome: z.enum(['RETURN_TO_SENDER', 'RECEIVED_AS_SENT', 'LOST_COMPANY', 'LOST_CHARGE']), note: z.string().optional(), employeeIds: z.array(z.string().uuid()).optional() });

/** Difference between a transfer form and what was received: its steps and the Owner's decision. */
@Controller('api/transfers')
export class TransferDiscrepancyController {
  constructor(private svc: TransferDiscrepancyService) {}
  @Get(':id/discrepancy') @RequireAnyPermission('transfer.create', 'transfer.confirm', 'report.inventory.all', 'report.inventory.own') get(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.get(id, u); }
  @Post(':id/discrepancy/decide') @RequirePermission('transfer.resolve_discrepancy') @Audited('TransferDoc', 'DISCREPANCY_DECIDE') decide(@Param('id') id: string, @Body(Z(DiffDecide)) dto: z.infer<typeof DiffDecide>, @CurrentUser() u: SessionUser) { return this.svc.adminDecide(id, dto, u); }
}
