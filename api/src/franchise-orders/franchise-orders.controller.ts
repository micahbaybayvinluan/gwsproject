import { Body, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, RequirePermission } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';
import { FranchiseOrdersService } from './franchise-orders.service';

const Flavor = z.object({ flavor: z.string().max(80).nullable(), qty: z.number().int().min(0) });
const Generate = z.object({ notes: z.string().max(500).optional() });
const Review = z.object({ lines: z.array(z.object({ lineId: z.string().uuid(), remove: z.boolean().optional(), flavors: z.array(Flavor).max(40).optional() })).max(400), notes: z.string().max(500).nullable().optional() });
const Publish = z.object({ franchiseIds: z.array(z.string().uuid()).max(100).optional() });
const Order = z.object({ lines: z.array(z.object({ productId: z.string().uuid(), flavor: z.string().max(80).nullable().optional(), qty: z.number().int().min(0) })).min(1).max(400), notes: z.string().max(500).optional() });
const Check = z.object({ lines: z.array(z.object({ lineId: z.string().uuid(), checkedQty: z.number().int().min(0) })).max(400).optional(), note: z.string().max(500).optional(), decision: z.enum(['APPROVE', 'RETURN']) });
const MakeDr = z.object({ drSiNo: z.string().trim().min(1).max(40), paymentMode: z.enum(['AR_PDC', 'CASH']).optional(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), franchiseShipping: z.object({ mode: z.enum(['NONE', 'TO_FOLLOW', 'AMOUNT']), amount: z.number().nonnegative().optional(), courier: z.string().max(60).optional() }).optional() });
const Cancel = z.object({ reason: z.string().trim().min(3).max(300) });

/** Franchise availability and orders: the Franchise Coordinator generates and sends, the warehouse checks, the franchise orders. */
@Controller('api/franchise-orders')
export class FranchiseOrdersController {
  constructor(private svc: FranchiseOrdersService) {}
  @Get('availability') @RequirePermission('fo.view') list(@CurrentUser() u: SessionUser) { return this.svc.list(u); }
  @Post('availability') @RequirePermission('fo.generate') generate(@Body(Z(Generate)) dto: z.infer<typeof Generate>, @CurrentUser() u: SessionUser) { return this.svc.generate(u, dto); }
  @Get('availability/:id') @RequirePermission('fo.view') get(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.get(u, id); }
  @Put('availability/:id') @RequirePermission('fo.review') review(@Param('id') id: string, @Body(Z(Review)) dto: z.infer<typeof Review>, @CurrentUser() u: SessionUser) { return this.svc.review(u, id, dto); }
  @Post('availability/:id/send-to-coordinator') @RequirePermission('fo.review') send(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.sendToCoordinator(u, id); }
  @Post('availability/:id/return-to-warehouse') @RequirePermission('fo.generate') back(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.returnToWarehouse(u, id); }
  @Post('availability/:id/publish') @RequirePermission('fo.generate') publish(@Param('id') id: string, @Body(Z(Publish)) dto: z.infer<typeof Publish>, @CurrentUser() u: SessionUser) { return this.svc.publish(u, id, dto.franchiseIds); }
  @Post('availability/:id/close') @RequirePermission('fo.generate') close(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.close(u, id); }
  @Post('availability/:id/order') @RequirePermission('fo.order') order(@Param('id') id: string, @Body(Z(Order)) dto: z.infer<typeof Order>, @CurrentUser() u: SessionUser) { return this.svc.order(u, id, dto); }
  @Get('orders') @RequirePermission('fo.view') orders(@CurrentUser() u: SessionUser, @Query('availabilityId') availabilityId?: string, @Query('status') status?: string) { return this.svc.listOrders(u, { availabilityId, status }); }
  @Get('orders/:id') @RequirePermission('fo.view') getOrder(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.getOrder(u, id); }
  @Post('orders/:id/picklist') @RequirePermission('fo.generate') picklist(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.generatePicklist(u, id); }
  @Get('orders/:id/picklist.pdf') @RequirePermission('fo.view') async picklistPdf(@Param('id') id: string, @CurrentUser() u: SessionUser, @Res() res: Response) { const o = await this.svc.picklistPdf(u, id); res.setHeader('Content-Type', o.contentType); res.setHeader('Content-Disposition', `attachment; filename="${o.fileName}"`); res.send(o.buffer); }
  @Post('orders/:id/send-to-warehouse') @RequirePermission('fo.generate') toWarehouse(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.sendToWarehouse(u, id); }
  @Post('orders/:id/check') @RequirePermission('fo.review') check(@Param('id') id: string, @Body(Z(Check)) dto: z.infer<typeof Check>, @CurrentUser() u: SessionUser) { return this.svc.check(u, id, dto); }
  @Post('orders/:id/make-dr') @RequirePermission('fo.generate') makeDr(@Param('id') id: string, @Body(Z(MakeDr)) dto: z.infer<typeof MakeDr>, @CurrentUser() u: SessionUser) { return this.svc.makeDr(u, id, dto); }
  @Post('orders/:id/cancel') @RequirePermission('fo.view') cancel(@Param('id') id: string, @Body(Z(Cancel)) dto: z.infer<typeof Cancel>, @CurrentUser() u: SessionUser) { return this.svc.cancel(u, id, dto.reason); }
}
