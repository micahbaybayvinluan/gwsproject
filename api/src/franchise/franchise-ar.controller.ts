import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, RequireAnyPermission, RequirePermission, Audited } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';
import { FranchiseArService } from './franchise-ar.service';
import { FranchiseShippingService } from './franchise-shipping.service';

const Pay = z.object({ amount: z.number().positive(), paidOn: z.string().optional(), mode: z.enum(['BANK_TRANSFER', 'GCASH', 'CHEQUE', 'CASH']), paymentAccountId: z.string().uuid().nullable().optional(), reference: z.string().nullable().optional(), proofAttachmentId: z.string().uuid().nullable().optional(), notes: z.string().nullable().optional() });
const Waive = z.object({ amount: z.number().positive().optional(), reason: z.string().trim().min(5) });
const Extend = z.object({ requestedDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(5) });
const ShipFill = z.object({ amount: z.number().positive(), courier: z.string().trim().max(120).nullable().optional(), reference: z.string().trim().max(120).nullable().optional(), notes: z.string().trim().max(500).nullable().optional() });
const ShipEdit = z.object({ amount: z.number().positive().optional(), fillBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), reason: z.string().trim().min(5) });
const Hold = z.object({ hold: z.boolean(), note: z.string().optional() });

@Controller('api/franchise-ar')
export class FranchiseArController {
  constructor(private svc: FranchiseArService, private ship: FranchiseShippingService) {}
  @Get('shipping-charges') @RequireAnyPermission('franchise.ar.view', 'franchise.ar.own', 'franchise.shipping.fill') shippingList(@CurrentUser() u: SessionUser, @Query('status') status?: string) { return this.ship.list(u, { status }); }
  @Post('shipping-charges/:id/fill') @RequirePermission('franchise.shipping.fill') @Audited('FranchiseShippingCharge', 'FILL') shippingFill(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body(Z(ShipFill)) dto: z.infer<typeof ShipFill>) { return this.ship.fill(u, id, dto); }
  @Post('shipping-charges/:id/edit') @RequirePermission('franchise.shipping.fill') @Audited('FranchiseShippingCharge', 'REQUEST_EDIT') shippingEdit(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body(Z(ShipEdit)) dto: z.infer<typeof ShipEdit>) { return this.ship.requestEdit(u, id, dto); }
  @Get() @RequireAnyPermission('franchise.ar.view', 'franchise.ar.own') list(@CurrentUser() u: SessionUser, @Query('locationId') locationId?: string, @Query('status') status?: string) { return this.svc.list(u, { locationId, status }); }
  @Get(':id') @RequireAnyPermission('franchise.ar.view', 'franchise.ar.own') get(@CurrentUser() u: SessionUser, @Param('id') id: string) { return this.svc.get(u, id); }
  @Post(':id/payments') @RequirePermission('franchise.ar.pay') @Audited('FranchisePayment', 'CREATE') pay(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body(Z(Pay)) dto: z.infer<typeof Pay>) { return this.svc.recordPayment(u, id, dto); }
  @Post(':id/waive') @RequirePermission('franchise.ar.manage') @Audited('FranchiseInvoice', 'WAIVE') waive(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body(Z(Waive)) dto: z.infer<typeof Waive>) { return this.svc.waive(u, id, dto); }
  @Post(':id/extension') @RequireAnyPermission('franchise.ar.extend', 'franchise.ar.manage') @Audited('FranchiseArExtension', 'REQUEST') extend(@CurrentUser() u: SessionUser, @Param('id') id: string, @Body(Z(Extend)) dto: z.infer<typeof Extend>) { return this.svc.requestExtension(u, id, dto); }
  @Put('locations/:locationId/credit-hold') @RequirePermission('franchise.ar.manage') @Audited('Location', 'CREDIT_HOLD') hold(@CurrentUser() u: SessionUser, @Param('locationId') locationId: string, @Body(Z(Hold)) dto: z.infer<typeof Hold>) { return this.svc.setCreditHold(u, locationId, dto.hold, dto.note); }
}
