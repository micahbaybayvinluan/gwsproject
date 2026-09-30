import { Body, Controller, Get, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { CurrentUser, RequirePermission, Audited } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';
import { EcomPricesService } from './ecom-prices.service';

const Set = z.object({ rows: z.array(z.object({ productId: z.string().uuid(), tier: z.enum(['TIKTOK', 'SHOPEE', 'LAZADA', 'CC']), price: z.number().positive().nullable() })).min(1).max(2000) });
const Cc = z.object({ pct: z.number().min(0).max(50), method: z.enum(['GROSS_UP', 'ADD']).default('GROSS_UP') });

/** The Admin's e-commerce and credit-card prices (owner request 2026-09-30). Everyone with a price permission reads their own tiers elsewhere; editing here is the Admin's alone. */
@Controller('api/pricing')
export class EcomPricesController {
  constructor(private svc: EcomPricesService) {}
  @Get('ecom') @RequirePermission('ecom.price.edit') list(@Query('q') q?: string) { return this.svc.list(q); }
  @Put('ecom') @RequirePermission('ecom.price.edit') @Audited('PriceList', 'ECOM_PRICES') set(@Body(Z(Set)) dto: z.infer<typeof Set>, @CurrentUser() u: SessionUser) { return this.svc.set(dto.rows, u); }
  @Post('ecom/import') @RequirePermission('ecom.price.edit') @UseInterceptors(FileInterceptor('file')) @Audited('PriceList', 'ECOM_IMPORT') import(@UploadedFile() f: { buffer: Buffer }, @CurrentUser() u: SessionUser) { return this.svc.importMasterlist(f.buffer, u); }
  @Get('cc-markup') @RequirePermission('ecom.price.edit') cc() { return this.svc.ccMarkup(); }
  @Put('cc-markup') @RequirePermission('ecom.price.edit') @Audited('Setting', 'CC_MARKUP') setCc(@Body(Z(Cc)) dto: z.infer<typeof Cc>, @CurrentUser() u: SessionUser) { return this.svc.setCcMarkup(dto.pct, dto.method, u); }
}
