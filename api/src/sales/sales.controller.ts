import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { SalesService } from './sales.service';
import { CurrentUser, RequirePermission, RequireAnyPermission, Audited } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';

const Line = z.object({ productId: z.string().uuid(), qty: z.number().int().positive(), unitPrice: z.number().nonnegative().nullable().optional(), batchId: z.string().uuid().nullable().optional(), isFreebie: z.boolean().optional(), lineRemarks: z.string().optional(), priceTier: z.string().optional() });
const Create = z.object({
  locationId: z.string().uuid().optional(), docDate: z.string().optional(), channel: z.enum(['WALK_IN', 'DELIVERY', 'SHIPPING_COURIER', 'SHIPPING_MARKETPLACE', 'FRANCHISE', 'DEALER', 'AGENT', 'PERSONAL', 'OTHER']), channelSub: z.string().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(), agentId: z.string().uuid().nullable().optional(), riderId: z.string().uuid().nullable().optional(), customerName: z.string().nullable().optional(), drSiNo: z.string().min(1),
  paymentMode: z.enum(['CASH', 'ONLINE', 'CREDIT_CARD', 'AR_PDC']), paymentAccountId: z.string().uuid().nullable().optional(), proofOfPaymentAttachmentId: z.string().uuid().nullable().optional(),
  cardMid: z.string().optional(), cardSlipNo: z.string().optional(), cardApprovalCode: z.string().optional(), cardBatchNo: z.string().optional(),
  deliveryFee: z.number().nonnegative().optional(), riderIncentive: z.number().nonnegative().optional(), shippingFee: z.number().nonnegative().optional(), shippingExpense: z.number().nonnegative().optional(), marketplaceCharges: z.number().nonnegative().optional(),
  dueDate: z.string().nullable().optional(), pdcBank: z.string().optional(), pdcChequeNo: z.string().optional(), pdcDate: z.string().nullable().optional(), notes: z.string().optional(), lines: z.array(Line).min(1),
});
const Void = z.object({ reason: z.string().min(3) });
const Payment = z.object({ salesDocIds: z.array(z.string().uuid()).min(1), amount: z.number().positive(), discount: z.number().nonnegative().optional(), paymentMode: z.enum(['CASH', 'ONLINE', 'CREDIT_CARD', 'AR_PDC']), paymentAccountId: z.string().uuid().nullable().optional(), proofAttachmentId: z.string().uuid().nullable().optional(), receivedAt: z.string().optional(), notes: z.string().optional() });
const CsgReport = z.object({ agreementId: z.string().uuid(), periodFrom: z.string(), periodTo: z.string(), notes: z.string().optional(), lines: z.array(z.object({ productId: z.string().uuid(), qty: z.number().int().positive(), unitPrice: z.number().nonnegative() })).min(1) });
const Agreement = z.object({ direction: z.enum(['OUT', 'IN']), counterpartyLocationId: z.string().uuid().optional(), supplierId: z.string().uuid().optional(), valuationBasis: z.enum(['SRP', 'COST', 'CONSIGNEE_PRICE']).optional(), settlementTerms: z.string().optional() });

@Controller('api/sales')
export class SalesController {
  constructor(private svc: SalesService) {}
  @Get() @RequireAnyPermission('sale.create', 'report.sales.own', 'report.sales.all') list(@CurrentUser() u: SessionUser, @Query('locationId') locationId?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('channel') channel?: string, @Query('paymentMode') paymentMode?: string) { return this.svc.list(u, { locationId, from, to, channel, paymentMode }); }
  @Get('agent-report') @RequireAnyPermission('report.sales.own', 'report.sales.all') agents(@CurrentUser() u: SessionUser, @Query('from') from: string, @Query('to') to: string, @Query('agentId') agentId?: string) { return this.svc.agentReport(u, { from, to, agentId }); }
  @Get(':id') @RequireAnyPermission('sale.create', 'report.sales.own', 'report.sales.all') get(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.get(id, u); }
  @Post() @RequirePermission('sale.create') @Audited('SalesDoc', 'CREATE') create(@Body(Z(Create)) dto: z.infer<typeof Create>, @CurrentUser() u: SessionUser) { return this.svc.create(dto, u); }
  @Post(':id/void') @RequireAnyPermission('sale.void', 'sale.edit.sameday') @Audited('SalesDoc', 'VOID') void(@Param('id') id: string, @Body(Z(Void)) dto: z.infer<typeof Void>, @CurrentUser() u: SessionUser) { return this.svc.void(id, dto.reason, u); }
}

@Controller('api/ar')
export class ArController {
  constructor(private svc: SalesService) {}
  @Get() @RequirePermission('ar.view') list(@CurrentUser() u: SessionUser, @Query('locationId') locationId?: string, @Query('customerId') customerId?: string, @Query('overdue') overdue?: string) { return this.svc.arList(u, { locationId, customerId, overdueOnly: overdue === '1' }); }
  @Get('credit-notes') @RequirePermission('ar.view') creditNotes(@CurrentUser() u: SessionUser, @Query('from') from?: string, @Query('to') to?: string) { return this.svc.creditNotes(u, { from, to }); }
  @Post('payments') @RequirePermission('ar.collect') @Audited('Payment', 'CREATE') pay(@Body(Z(Payment)) dto: z.infer<typeof Payment>, @CurrentUser() u: SessionUser) { return this.svc.recordPayment(dto, u); }
}

@Controller('api/consignment')
@RequirePermission('consignment.manage')
export class ConsignmentController {
  constructor(private svc: SalesService) {}
  @Get('agreements') agreements() { return this.svc.listAgreements(); }
  @Post('agreements') @Audited('ConsignmentAgreement', 'CREATE') createAgreement(@Body(Z(Agreement)) dto: z.infer<typeof Agreement>, @CurrentUser() u: SessionUser) { return this.svc.createAgreement(dto, u); }
  @Post('sale-reports') @Audited('ConsignmentSaleReport', 'CREATE') report(@Body(Z(CsgReport)) dto: z.infer<typeof CsgReport>, @CurrentUser() u: SessionUser) { return this.svc.consignmentSaleReport(dto, u); }
  @Get('out-summary') outSummary() { return this.svc.consignmentOutSummary(); }
  @Get('in-settlement') inSettlement(@Query('from') from: string, @Query('to') to: string) { return this.svc.consignmentInSettlement({ from, to }); }
}
