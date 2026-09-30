import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, RequirePermission, Audited } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';
import { EcomWaybillsService } from './ecom-waybills.service';

const Patch_ = z.object({ productId: z.string().uuid().nullable().optional(), qty: z.number().int().min(1).max(999).optional() });
const Rates = z.object({ commissionPct: z.number().min(0).max(99.99), transactionPct: z.number().min(0).max(99.99), affiliatePct: z.number().min(0).max(99.99), shippingPerOrder: z.number().min(0) });
const Confirm = z.object({ ids: z.array(z.string().uuid()).max(2000) });

/** Upload waybills and read the SRP, fees and order income report (owner request 2026-09-30): E-comm Associate, Head Auditor, Owner. */
@Controller('api/ecommerce-waybills')
export class EcomWaybillsController {
  constructor(private svc: EcomWaybillsService) {}
  @Post('upload') @RequirePermission('ecom.waybill') @UseInterceptors(FilesInterceptor('files', 40, { limits: { fileSize: 25 * 1024 * 1024 } })) @Audited('EcomWaybill', 'UPLOAD') upload(@UploadedFiles() files: { buffer: Buffer; originalname: string }[], @CurrentUser() u: SessionUser) { return this.svc.upload(files ?? [], u); }
  @Get() @RequirePermission('ecom.waybill') list(@Query('platform') platform?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('open') open?: string) { return this.svc.list({ platform: platform || undefined, from, to, onlyOpen: open === '1' }); }
  @Get('export.xlsx') @RequirePermission('ecom.waybill') async export(@Res() res: Response, @Query('platform') platform?: string, @Query('from') from?: string, @Query('to') to?: string) { const o = await this.svc.export({ platform: platform || undefined, from, to }); res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${o.fileName}"`); res.send(o.buffer); }
  @Patch(':id') @RequirePermission('ecom.waybill') update(@Param('id') id: string, @Body(Z(Patch_)) dto: z.infer<typeof Patch_>) { return this.svc.update(id, dto); }
  @Post('confirm') @RequirePermission('ecom.waybill') confirm(@Body(Z(Confirm)) dto: z.infer<typeof Confirm>) { return this.svc.confirmGuessed(dto.ids); }
  @Delete(':id') @RequirePermission('ecom.waybill') @Audited('EcomWaybill', 'DELETE') remove(@Param('id') id: string) { return this.svc.remove(id); }
  @Put('rates/:platform') @RequirePermission('ecom.waybill') @Audited('Setting', 'WAYBILL_RATES') rates(@Param('platform') platform: string, @Body(Z(Rates)) dto: z.infer<typeof Rates>, @CurrentUser() u: SessionUser) { return this.svc.setRates(platform.toUpperCase(), dto, u.id); }
}
