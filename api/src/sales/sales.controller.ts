import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ConsignmentService } from './consignment.service';
import { PdfService } from '../reports/pdf.service';
import { z } from 'zod';
import { SalesService } from './sales.service';
import { OpeningArService } from './opening-ar.service';
import { CurrentUser, RequirePermission, RequireAnyPermission, Audited } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';

const Line = z.object({ productId: z.string().uuid(), qty: z.number().int().positive(), unitPrice: z.number().nonnegative().nullable().optional(), batchId: z.string().uuid().nullable().optional(), exactBatch: z.boolean().optional(), isFreebie: z.boolean().optional(), lineRemarks: z.string().optional(), priceTier: z.string().optional() });
const Create = z.object({
  locationId: z.string().uuid().optional(), docDate: z.string().optional(), channel: z.enum(['WALK_IN', 'DELIVERY', 'SHIPPING_COURIER', 'SHIPPING_MARKETPLACE', 'FRANCHISE', 'DEALER', 'AGENT', 'PERSONAL', 'OTHER']), channelSub: z.string().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(), agentId: z.string().uuid().nullable().optional(), outletId: z.string().uuid().nullable().optional(), riderId: z.string().uuid().nullable().optional(), customerName: z.string().nullable().optional(), customerPhone: z.string().trim().max(40).nullable().optional(), customerEmail: z.string().trim().email().or(z.literal('')).nullable().optional(), drSiNo: z.string().min(1),
  paymentMode: z.enum(['CASH', 'ONLINE', 'CREDIT_CARD', 'AR_PDC']), paymentAccountId: z.string().uuid().nullable().optional(), proofOfPaymentAttachmentId: z.string().uuid().nullable().optional(),
  cardMid: z.string().optional(), cardSlipNo: z.string().optional(), cardApprovalCode: z.string().optional(), cardBatchNo: z.string().optional(),
  deliveryFee: z.number().nonnegative().optional(), riderIncentive: z.number().nonnegative().optional(), sixPackSticker: z.boolean().optional(), incentive: z.object({ amount: z.number().nonnegative(), payee: z.string().trim().max(120), kind: z.enum(['SALES', 'RIDER']).optional() }).nullable().optional(), shippingFee: z.number().nonnegative().optional(), shippingExpense: z.number().nonnegative().optional(), marketplaceCharges: z.number().nonnegative().optional(),
  dueDate: z.string().nullable().optional(), pdcBank: z.string().optional(), pdcChequeNo: z.string().optional(), pdcDate: z.string().nullable().optional(), notes: z.string().optional(), lines: z.array(Line).min(1),
  franchiseShipping: z.object({ mode: z.enum(['NONE', 'TO_FOLLOW', 'AMOUNT']), amount: z.number().positive().optional(), courier: z.string().trim().max(120).optional(), reference: z.string().trim().max(120).optional() }).optional(),
});
const Void = z.object({ reason: z.string().min(3) });
const Payment = z.object({ salesDocIds: z.array(z.string().uuid()).min(1), amount: z.number().positive(), discount: z.number().nonnegative().optional(), paymentMode: z.enum(['CASH', 'ONLINE', 'CREDIT_CARD', 'AR_PDC']), paymentAccountId: z.string().uuid().nullable().optional(), proofAttachmentId: z.string().uuid().nullable().optional(), receivedAt: z.string().optional(), notes: z.string().optional() });
const CsgReport = z.object({ agreementId: z.string().uuid(), periodFrom: z.string(), periodTo: z.string(), notes: z.string().optional(), lines: z.array(z.object({ productId: z.string().uuid(), qty: z.number().int().positive(), unitPrice: z.number().nonnegative().nullable().optional() })).min(1) });
const Consignee = z.object({ name: z.string().trim().min(2), code: z.string().trim().max(20).optional(), contactPerson: z.string().optional(), phone: z.string().optional(), address: z.string().optional(), priceBasis: z.enum(['SRP', 'CONSIGNEE_PRICE', 'COST']), settlementDays: z.number().int().min(0).max(365).optional(), notes: z.string().optional() });
const Prefill = z.object({ agreementId: z.string().uuid(), productIds: z.array(z.string().uuid()).max(300), date: z.string() });
const Agreement = z.object({ direction: z.enum(['OUT', 'IN']), counterpartyLocationId: z.string().uuid().optional(), supplierId: z.string().uuid().optional(), valuationBasis: z.enum(['SRP', 'COST', 'CONSIGNEE_PRICE']).optional(), settlementTerms: z.string().optional() });

@Controller('api/sales')
export class SalesController {
  constructor(private svc: SalesService) {}
  @Get() @RequireAnyPermission('sale.create', 'sale.create.warehouse', 'report.sales.own', 'report.sales.all') list(@CurrentUser() u: SessionUser, @Query('locationId') locationId?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('channel') channel?: string, @Query('paymentMode') paymentMode?: string) { return this.svc.list(u, { locationId, from, to, channel, paymentMode }); }
  @Get('agent-report') @RequireAnyPermission('report.sales.own', 'report.sales.all') agents(@CurrentUser() u: SessionUser, @Query('from') from: string, @Query('to') to: string, @Query('agentId') agentId?: string) { return this.svc.agentReport(u, { from, to, agentId }); }
  @Get(':id') @RequireAnyPermission('sale.create', 'sale.create.warehouse', 'report.sales.own', 'report.sales.all') get(@Param('id') id: string, @CurrentUser() u: SessionUser) { return this.svc.get(id, u); }
  @Post() @RequireAnyPermission('sale.create', 'sale.create.warehouse') @Audited('SalesDoc', 'CREATE') create(@Body(Z(Create)) dto: z.infer<typeof Create>, @CurrentUser() u: SessionUser) { return this.svc.create(dto, u); }
  @Post(':id/void') @RequireAnyPermission('sale.void', 'sale.edit.sameday') @Audited('SalesDoc', 'VOID') void(@Param('id') id: string, @Body(Z(Void)) dto: z.infer<typeof Void>, @CurrentUser() u: SessionUser) { return this.svc.void(id, dto.reason, u); }
}

@Controller('api/ar')
export class ArController {
  constructor(private svc: SalesService) {}
  @Get() @RequirePermission('ar.view') list(@CurrentUser() u: SessionUser, @Query('locationId') locationId?: string, @Query('customerId') customerId?: string, @Query('overdue') overdue?: string) { return this.svc.arList(u, { locationId, customerId, overdueOnly: overdue === '1' }); }
  @Get('credit-notes') @RequirePermission('ar.view') creditNotes(@CurrentUser() u: SessionUser, @Query('from') from?: string, @Query('to') to?: string) { return this.svc.creditNotes(u, { from, to }); }
  @Get('payments/:id/review') @RequireAnyPermission('ar.approve', 'ar.collect', 'approval.act.AR_PAYMENT') review(@Param('id') id: string) { return this.svc.paymentReview(id); }
  @Post('payments') @RequirePermission('ar.collect') @Audited('Payment', 'CREATE') pay(@Body(Z(Payment)) dto: z.infer<typeof Payment>, @CurrentUser() u: SessionUser) { return this.svc.recordPayment(dto, u); }
}

@Controller('api/consignment')
export class ConsignmentController {
  constructor(private svc: SalesService, private csg: ConsignmentService, private pdf: PdfService) {}
  @Get('consignees') @RequireAnyPermission('consignment.manage', 'consignment.request') consignees() { return this.csg.consignees(); }
  @Post('consignees') @RequirePermission('consignment.manage') @Audited('Consignee', 'CREATE') createConsignee(@Body(Z(Consignee)) dto: z.infer<typeof Consignee>, @CurrentUser() u: SessionUser) { return this.csg.createConsignee(dto, u); }
  @Get('agreements') @RequireAnyPermission('consignment.manage', 'consignment.request') agreements() { return this.svc.listAgreements(); }
  @Post('agreements') @RequirePermission('consignment.manage') @Audited('ConsignmentAgreement', 'CREATE') createAgreement(@Body(Z(Agreement)) dto: z.infer<typeof Agreement>, @CurrentUser() u: SessionUser) { return this.svc.createAgreement(dto, u); }
  @Post('sale-reports') @RequireAnyPermission('consignment.manage', 'consignment.request') @Audited('ConsignmentSaleReport', 'CREATE') report(@Body(Z(CsgReport)) dto: z.infer<typeof CsgReport>, @CurrentUser() u: SessionUser) { return this.csg.saleReport(dto, u); }
  @Post('sale-reports/prefill') @RequireAnyPermission('consignment.manage', 'consignment.request') prefill(@Body(Z(Prefill)) dto: z.infer<typeof Prefill>, @CurrentUser() u: SessionUser) { return this.csg.prefill(dto.agreementId, dto.productIds, dto.date, u); }
  @Post('sale-reports/draft') @RequireAnyPermission('consignment.manage', 'consignment.request') async draft(@Body(Z(CsgReport)) dto: z.infer<typeof CsgReport>, @CurrentUser() u: SessionUser, @Res() res: Response) {
    const f = await this.csg.draftForm(dto, u); const r = await this.pdf.render(this.pdf.formHtml(f.title, f.header, f.columns, f.rows, [], f.signatures, 'DRAFT'));
    res.setHeader('Content-Type', r.contentType); res.setHeader('Content-Disposition', `attachment; filename="ConsigneeSales_DRAFT.${r.ext}"`); res.send(r.buffer);
  }
  @Get('out-summary') @RequireAnyPermission('consignment.manage', 'consignment.request') outSummary() { return this.svc.consignmentOutSummary(); }
  @Get('in-settlement') @RequirePermission('consignment.manage') inSettlement(@Query('from') from: string, @Query('to') to: string) { return this.svc.consignmentInSettlement({ from, to }); }
}

const OpeningAr = z.object({
  locationId: z.string().uuid(), kind: z.enum(['DEALER', 'FRANCHISE', 'AGENT', 'OTHER']),
  customerId: z.string().uuid().nullable().optional(), agentId: z.string().uuid().nullable().optional(), customerName: z.string().trim().max(160).nullable().optional(),
  drSiNo: z.string().trim().min(1).max(60), docDate: z.string().min(8), dueDate: z.string().min(8), amount: z.number().positive(),
  pdcBank: z.string().trim().max(80).nullable().optional(), pdcChequeNo: z.string().trim().max(60).nullable().optional(), pdcDate: z.string().nullable().optional(), notes: z.string().trim().max(500).nullable().optional(),
});

/** AR from before GWS-ERP, entered by Accounting for any branch and approved by the Owner (owner request 2026-09-29). */
@Controller('api/ar/opening')
export class OpeningArController {
  constructor(private svc: OpeningArService) {}
  @Get() @RequireAnyPermission('ar.opening', 'approval.act.OPENING_AR') list(@Query('status') status?: string, @Query('locationId') locationId?: string) { return this.svc.list({ status, locationId }); }
  @Post() @RequirePermission('ar.opening') @Audited('OpeningArEntry', 'CREATE') create(@Body(Z(OpeningAr)) b: z.infer<typeof OpeningAr>, @CurrentUser() u: SessionUser) { return this.svc.create(b, u); }
}
