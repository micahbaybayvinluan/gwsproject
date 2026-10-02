import { Body, Controller, Delete, Get, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { EcommerceService } from './ecommerce.service';
import { CurrentUser, RequirePermission, RequireAnyPermission, Audited } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';

type F = { buffer: Buffer; originalname: string };
const Up = () => UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }));
const SkuMap = z.object({ platformSku: z.string().min(1), productId: z.string().uuid() });
const Reason = z.object({ reason: z.string().min(1) });
const ReturnIn = z.object({ ref: z.string().min(1), reason: z.enum(['FAILED_DELIVERY', 'BUYER_RETURN', 'OTHER']).optional(), notes: z.string().optional(), lines: z.array(z.object({ productId: z.string().uuid(), qty: z.number().int().positive() })).optional() });
const Receive = z.object({ lines: z.array(z.object({ productId: z.string().uuid(), goodQty: z.number().int().min(0), damagedQty: z.number().int().min(0) })) });
const Ads = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), amount: z.number().positive(), paidFromAccountId: z.string().uuid().nullable().optional(), reference: z.string().optional(), notes: z.string().optional() });

/** E-commerce (TikTok, Shopee, Lazada — each separate). `:platform` is tiktok | shopee | lazada. */
@Controller('api/ecommerce')
export class EcommerceController {
  constructor(private svc: EcommerceService) {}

  @Get('overview') @RequireAnyPermission('ecom.manage', 'ecom.view', 'ecom.receive') overview() { return this.svc.overview(); }
  @Get('report') @RequireAnyPermission('ecom.manage', 'ecom.view') report(@CurrentUser() u: SessionUser, @Query('from') from: string, @Query('to') to: string) { return this.svc.report(u, { from, to }); }
  @Get('templates/:kind.xlsx') async template(@Param('kind') kind: string, @Res() res: Response) {
    const k = (['orders', 'settlement', 'ads'].includes(kind) ? kind : 'orders') as 'orders' | 'settlement' | 'ads';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="gws-ecommerce-${k}-template.xlsx"`); res.send(await this.svc.template(k));
  }
  @Get('payment-accounts') @RequirePermission('ecom.manage') paymentAccounts() { return this.svc.paymentAccounts(); }

  // pull-outs
  @Get('pullouts/:id') @RequireAnyPermission('ecom.manage', 'ecom.view', 'ecom.receive') pullout(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.pullout(id, u); }
  @Post('pullouts/:id/remove-order/:orderId') @RequirePermission('ecom.manage') @Audited('TransferDoc', 'ECOM_REMOVE_ORDER') removeOrder(@Param('id') id: string, @Param('orderId') orderId: string, @CurrentUser() u: SessionUser) { return this.svc.removeOrder(id, orderId, u); }
  @Post('pullouts/:id/submit') @RequirePermission('ecom.manage') @Audited('TransferDoc', 'SUBMIT') submit(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.submitPullout(id, u); }
  @Post('pullouts/:id/void') @RequirePermission('ecom.manage') @Audited('TransferDoc', 'VOID') void(@Param('id') id: string, @Body(Z(Reason)) dto: z.infer<typeof Reason>, @CurrentUser() u: SessionUser) { return this.svc.voidPullout(id, dto.reason, u); }

  // payouts
  @Get('settlements/:id') @RequireAnyPermission('ecom.manage', 'ecom.view') settlement(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.settlement(id, u); }
  @Post('settlements/:id/submit') @RequirePermission('ecom.manage') @Audited('EcomSettlement', 'SUBMIT') submitSettlement(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.submitSettlement(id, u); }
  @Delete('settlements/:id') @RequirePermission('ecom.manage') deleteSettlement(@Param('id') id: string) { return this.svc.deleteSettlement(id); }

  // returns (all platforms, for the Warehouse)
  @Get('returns') @RequireAnyPermission('ecom.manage', 'ecom.view', 'ecom.receive') allReturns(@Query('status') status?: string) { return this.svc.returns({ status: status || undefined }); }
  @Post('returns/:id/receive') @RequirePermission('ecom.receive') @Audited('EcomReturn', 'RECEIVE') receive(@Param('id') id: string, @Body(Z(Receive)) dto: z.infer<typeof Receive>, @CurrentUser() u: SessionUser) { return this.svc.receiveReturn(id, dto, u); }

  @Delete('sku-maps/:id') @RequirePermission('ecom.manage') deleteMap(@Param('id') id: string) { return this.svc.deleteSkuMap(id); }

  // per platform
  @Get(':platform/sku-maps') @RequireAnyPermission('ecom.manage', 'ecom.view') maps(@Param('platform') p: string) { return this.svc.skuMaps(this.svc.platform(p)); }
  @Post(':platform/sku-maps') @RequirePermission('ecom.manage') setMap(@Param('platform') p: string, @Body(Z(SkuMap)) dto: z.infer<typeof SkuMap>, @CurrentUser() u: SessionUser) { return this.svc.setSkuMap(this.svc.platform(p), dto.platformSku, dto.productId, u); }
  @Post(':platform/orders/upload') @RequirePermission('ecom.manage') @Up() uploadOrders(@Param('platform') p: string, @UploadedFile() f: F, @CurrentUser() u: SessionUser, @Query('warehouseId') warehouseId?: string, @Query('send') send?: string) { return this.svc.uploadOrders(this.svc.platform(p), f, u, warehouseId || undefined, send === '1'); }
  @Get(':platform/orders') @RequireAnyPermission('ecom.manage', 'ecom.view') orders(@Param('platform') p: string, @Query('status') status?: string, @Query('search') search?: string) { return this.svc.orders(this.svc.platform(p), { status: status || undefined, search }); }
  @Get(':platform/pullouts') @RequireAnyPermission('ecom.manage', 'ecom.view', 'ecom.receive') pullouts(@Param('platform') p: string) { return this.svc.pullouts(this.svc.platform(p)); }
  @Post(':platform/settlements/upload') @RequirePermission('ecom.manage') @Up() uploadSettlement(@Param('platform') p: string, @UploadedFile() f: F, @CurrentUser() u: SessionUser, @Query('includeUnmatched') inc?: string) { return this.svc.uploadSettlement(this.svc.platform(p), f, u, inc === 'true'); }
  @Get(':platform/settlements') @RequireAnyPermission('ecom.manage', 'ecom.view') settlements(@Param('platform') p: string) { return this.svc.settlements(this.svc.platform(p)); }
  @Get(':platform/returns') @RequireAnyPermission('ecom.manage', 'ecom.view', 'ecom.receive') returns(@Param('platform') p: string, @Query('status') status?: string) { return this.svc.returns({ platform: this.svc.platform(p), status: status || undefined }); }
  @Post(':platform/returns') @RequirePermission('ecom.manage') createReturn(@Param('platform') p: string, @Body(Z(ReturnIn)) dto: z.infer<typeof ReturnIn>, @CurrentUser() u: SessionUser) { return this.svc.createReturn(this.svc.platform(p), dto, u); }
  @Get(':platform/ads') @RequireAnyPermission('ecom.manage', 'ecom.view') ads(@Param('platform') p: string) { return this.svc.ads(this.svc.platform(p)); }
  @Post(':platform/ads') @RequirePermission('ecom.manage') addAds(@Param('platform') p: string, @Body(Z(Ads)) dto: z.infer<typeof Ads>, @CurrentUser() u: SessionUser) { return this.svc.addAds(this.svc.platform(p), dto, u); }
  @Post(':platform/ads/upload') @RequirePermission('ecom.manage') @Up() uploadAds(@Param('platform') p: string, @UploadedFile() f: F, @CurrentUser() u: SessionUser, @Query('paidFromAccountId') acct?: string, @Query('month') month?: string) { return this.svc.uploadAds(this.svc.platform(p), f, u, acct || null, month); }
}
