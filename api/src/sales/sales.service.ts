import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PaymentMode, Prisma, SalesChannel } from '@prisma/client';
import { PrismaService, Tx } from '../common/prisma.service';
import { SequenceService } from '../common/sequence.service';
import { StockService } from '../stock/stock.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { MasterService } from '../master/master.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../common/audit.service';
import { SettingsService } from '../common/settings.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { PostingService } from '../gl/posting.service';
import { r3r4Sale, r4Collection, r8ConsigneeSale } from '../gl/posting-rules';
import { toDateOnly, todayManila, addDays, dateStr, daysBetween } from '../common/manila';
import { D, round2, sum, ZERO } from '../common/money';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';
import { ClosingService } from '../closing/closing.service';
import { ScopeService } from '../common/scope.service';

export interface SalesLineInput { productId: string; qty: number; unitPrice?: number | null; batchId?: string | null; isFreebie?: boolean; lineRemarks?: string; priceTier?: string }
export interface SalesInput {
  locationId?: string; docDate?: string; channel: SalesChannel; channelSub?: string | null; customerId?: string | null; agentId?: string | null; riderId?: string | null; customerName?: string | null; customerPhone?: string | null; customerEmail?: string | null; drSiNo: string;
  paymentMode: PaymentMode; paymentAccountId?: string | null; proofOfPaymentAttachmentId?: string | null; cardMid?: string; cardSlipNo?: string; cardApprovalCode?: string; cardBatchNo?: string;
  deliveryFee?: number; riderIncentive?: number; shippingFee?: number; shippingExpense?: number; marketplaceCharges?: number; dueDate?: string | null; pdcBank?: string; pdcChequeNo?: string; pdcDate?: string | null; notes?: string;
  lines: SalesLineInput[];
}

export const TIER_BY_CHANNEL: Record<SalesChannel, string> = { WALK_IN: 'RETAIL', DELIVERY: 'RETAIL', SHIPPING_COURIER: 'RETAIL', SHIPPING_MARKETPLACE: 'RETAIL', FRANCHISE: 'FRANCHISE', DEALER: 'DEALER', AGENT: 'AGENT', PERSONAL: 'RETAIL', OTHER: 'RETAIL' };

/** §8 Sales module: entry (all channels/modes), agents, AR/PDC, payments, credit notes. Stock is deducted on save (FEFO). */
@Injectable()
export class SalesService implements OnModuleInit {
  constructor(private prisma: PrismaService, private seq: SequenceService, private stock: StockService, private approvals: ApprovalsService, private master: MasterService, private notify: NotificationsService, private audit: AuditService, private settings: SettingsService, private attachments: AttachmentsService, private posting: PostingService, private closing: ClosingService, private scope: ScopeService) {}

  onModuleInit() {
    this.approvals.register('SPECIAL_PRICE', (req, outcome) => this.onSpecialPriceDecision(req.documentId, outcome));
    this.approvals.register('AR_PAYMENT', (req, outcome, actor) => this.onPaymentDecision(req.documentId, outcome, actor?.id ?? null));
  }

  private include = { location: { select: { id: true, code: true, name: true, type: true } }, customer: { select: { id: true, code: true, name: true, type: true } }, agent: { select: { id: true, name: true } }, rider: { select: { id: true, name: true } }, paymentAccount: { select: { id: true, title: true, paymentAccountType: true } }, lines: { include: { product: { select: { id: true, sku: true, name: true, category: { select: { accountingClass: true, name: true } } } }, batch: { select: { id: true, batchNo: true, expiryDate: true, isConsignmentIn: true } } } }, payments: { include: { payment: true } } } as const;

  list(user: SessionUser, q: { locationId?: string; from?: string; to?: string; channel?: string; paymentMode?: string; open?: boolean; take?: number }) {
    const where: Prisma.SalesDocWhereInput = { locationId: this.scope.locationFilter(user, q.locationId) as never, channel: q.channel as SalesChannel | undefined, paymentMode: q.paymentMode as PaymentMode | undefined, voidedAt: null, docDate: q.from || q.to ? { gte: q.from ? toDateOnly(q.from) : undefined, lte: q.to ? toDateOnly(q.to) : undefined } : undefined };
    return this.prisma.db.salesDoc.findMany({ where, include: this.include, orderBy: [{ docDate: 'desc' }, { createdAt: 'desc' }], take: q.take ?? 500 });
  }
  async get(id: string, user: SessionUser) {
    const doc = await this.prisma.db.salesDoc.findUnique({ where: { id }, include: this.include });
    if (!doc) throw new NotFoundException();
    if (user.locationScoped && !user.locationIds.includes(doc.locationId)) throw new ForbiddenException();
    return { ...doc, attachments: await this.attachments.list('SalesDoc', id), balance: doc.grandTotal.minus(doc.amountPaid) };
  }

  async create(input: SalesInput, user: SessionUser) {
    const locationId = input.locationId ?? user.locationIds[0];
    if (!locationId) throw new BadRequestException('locationId required');
    if (user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException('Outside your branch');
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: locationId } });
    if (!loc.isSelling) throw new BadRequestException('This location does not sell');
    const docDate = input.docDate ? toDateOnly(input.docDate) : todayManila();
    if (docDate > todayManila()) throw new BadRequestException('Sale date cannot be in the future');
    if (await this.closing.isClosed(locationId, docDate)) throw new BadRequestException({ message: 'This business day is closed; submit a post-close edit request instead', code: 'DAY_CLOSED' });
    if (!input.lines.length) throw new BadRequestException('At least one line');
    if (!input.drSiNo?.trim()) throw new BadRequestException('DR/SI number is required');
    if (await this.prisma.db.salesDoc.findUnique({ where: { locationId_drSiNo: { locationId, drSiNo: input.drSiNo.trim() } } })) throw new BadRequestException({ message: `DR/SI ${input.drSiNo.trim()} already exists at this branch (one SalesDoc per DR/SI)`, code: 'DUPLICATE_DR' });
    this.validatePayment(input);
    const franchiseUser = user.roleKey.startsWith('FRANCHISE');
    const nearExpiryDays = await this.settings.get<number>('alerts.near_expiry_days');
    const autoDiscountPct = D(await this.settings.get<number>('approval.special_price_auto_discount_pct'));
    const defaultTier = input.agentId && input.channel !== 'AGENT' ? 'AGENT' : TIER_BY_CHANNEL[input.channel];

    const doc = await this.prisma.db.$transaction(async (tx) => {
      const controlNo = await this.seq.form(tx, 'DR', locationId);
      const lineRows: Prisma.SalesLineUncheckedCreateWithoutDocInput[] = [];
      let productTotal = ZERO; let special = false;
      for (const l of input.lines) {
        if (l.qty <= 0) throw new BadRequestException('Qty must be positive');
        const product = await tx.product.findUniqueOrThrow({ where: { id: l.productId }, include: { category: true, bundleComponents: true } });
        if (franchiseUser && !product.franchiseVisible) throw new ForbiddenException(`${product.name} is not available to franchises`);
        const tier = l.priceTier ?? defaultTier;
        if (!user.permissions.has(`price.view.${tier}`) && !franchiseUser) throw new ForbiddenException(`You may not sell at tier ${tier}`);
        const isFreebie = !!l.isFreebie || product.category.accountingClass === 'FREEBIE' || product.category.accountingClass === 'PLASTIC';
        const tierPrice = isFreebie ? ZERO : D(await this.master.priceFor(product.id, tier, docDate, tx));
        let unitPrice = isFreebie ? ZERO : l.unitPrice != null ? D(l.unitPrice) : tierPrice;
        if (franchiseUser && l.unitPrice != null && !unitPrice.equals(tierPrice)) {
          if (user.roleKey === 'FRANCHISE_SALES_ASSOCIATE') throw new ForbiddenException('Franchise associates cannot change prices'); // §18.2
          // Franchise owner sells at their own retail price: no SPECIAL_PRICE approval applies (§18.2)
        }
        let flag: string | null = null;
        if (!franchiseUser && !isFreebie && unitPrice.lt(tierPrice)) {
          const discountPct = tierPrice.isZero() ? D(0) : tierPrice.minus(unitPrice).div(tierPrice).mul(100);
          if (discountPct.gt(autoDiscountPct)) { special = true; flag = 'PENDING'; }
        }
        // Bundles consume components (§4.2)
        const consume = product.isBundle && product.bundleComponents.length ? product.bundleComponents.map((c) => ({ productId: c.componentProductId, qty: c.qty * l.qty })) : [{ productId: product.id, qty: l.qty }];
        let first = true;
        for (const c of consume) {
          const picks = await this.stock.pickFefo(tx, locationId, c.productId, c.qty, { preferBatchId: l.batchId ?? undefined });
          for (const p of picks) {
            const near = !!p.expiryDate && daysBetween(todayManila(), p.expiryDate) <= nearExpiryDays;
            const lineQty = product.isBundle ? (first ? l.qty : 0) : p.qty;
            const amount = round2(unitPrice.mul(lineQty));
            // for bundles: the sale line records the bundle product once; component picks record cost with qty 0 price
            lineRows.push({ productId: product.isBundle ? product.id : c.productId, batchId: p.batchId, qty: product.isBundle ? (first ? l.qty : p.qty) : p.qty, priceTier: tier, tierPrice: tierPrice.toFixed(2), unitPrice: unitPrice.toFixed(2), unitCost: p.unitCost, amount: amount.toFixed(2), isFreebie, lineRemarks: l.lineRemarks, nearExpiryWarn: near, specialPriceFlag: flag });
            productTotal = productTotal.plus(amount);
            await this.stock.post(tx, [{ locationId, productId: c.productId, batchId: p.batchId, qtyDelta: -p.qty, movementType: isFreebie ? 'FREEBIE_ISSUE' : 'SALE', documentType: 'SalesDoc', documentId: controlNo /* replaced below */, unitCost: p.unitCost, businessDate: docDate, createdBy: user.id }]);
            first = false;
          }
        }
        unitPrice = ZERO;
      }
      const deliveryFee = D(input.deliveryFee ?? 0), shippingFee = D(input.shippingFee ?? 0);
      const grandTotal = round2(productTotal.plus(deliveryFee).plus(shippingFee));
      const created = await tx.salesDoc.create({
        data: {
          controlNo, docDate, locationId, channel: input.channel, channelSub: input.channelSub ?? null, customerId: input.customerId ?? null, agentId: input.agentId ?? null, riderId: input.riderId ?? null, customerName: input.customerName ?? null, customerPhone: input.customerPhone || null, customerEmail: input.customerEmail || null, drSiNo: input.drSiNo.trim(),
          paymentMode: input.paymentMode, paymentAccountId: input.paymentAccountId ?? null, proofOfPaymentAttachmentId: input.proofOfPaymentAttachmentId ?? null, cardMid: input.cardMid, cardSlipNo: input.cardSlipNo, cardApprovalCode: input.cardApprovalCode, cardBatchNo: input.cardBatchNo,
          deliveryFee: deliveryFee.toFixed(2), riderIncentive: D(input.riderIncentive ?? 0).toFixed(2), shippingFee: shippingFee.toFixed(2), shippingExpense: D(input.shippingExpense ?? 0).toFixed(2), marketplaceCharges: D(input.marketplaceCharges ?? 0).toFixed(2),
          productTotal: productTotal.toFixed(2), grandTotal: grandTotal.toFixed(2), amountPaid: input.paymentMode === 'AR_PDC' ? '0.00' : grandTotal.toFixed(2),
          dueDate: input.dueDate ? toDateOnly(input.dueDate) : null, pdcBank: input.pdcBank, pdcChequeNo: input.pdcChequeNo, pdcDate: input.pdcDate ? toDateOnly(input.pdcDate) : null, notes: input.notes,
          preparedBy: user.id, createdBy: user.id, specialPriceStatus: special ? 'PENDING' : null, status: 'POSTED',
          lines: { create: lineRows },
        }, include: this.include,
      });
      // ledger rows were keyed by controlNo before the doc existed; point them at the doc id
      await tx.stockLedger.updateMany({ where: { documentType: 'SalesDoc', documentId: controlNo }, data: { documentId: created.id } });
      // journal R3/R4 + R5
      const counterparty = created.customer ? { type: created.customer.type, id: created.customer.id, locationId: null } : created.agent ? { type: 'AGENT', id: created.agent.id } : null;
      await this.posting.post(tx, { type: 'SalesDoc', id: created.id, date: docDate, name: created.customer?.name ?? created.customerName, createdBy: user.id }, (r) => r3r4Sale(r, {
        locationId, channel: created.channel, channelSub: created.channelSub, paymentMode: created.paymentMode, paymentAccountId: created.paymentAccountId, counterparty, drSiNo: created.drSiNo,
        productTotal: created.productTotal, deliveryFee: created.deliveryFee, shippingFee: created.shippingFee, grandTotal: created.grandTotal,
        costLines: created.lines.map((l) => ({ accountingClass: l.product.category.accountingClass, qty: l.qty, unitCost: l.unitCost, isConsignmentIn: l.batch.isConsignmentIn })),
      }));
      return created;
    });

    if (doc.specialPriceStatus === 'PENDING') {
      const costs = doc.lines.filter((l) => l.specialPriceFlag === 'PENDING').map((l) => ({ product: l.product.name, tierPrice: l.tierPrice, soldPrice: l.unitPrice, discountPct: l.tierPrice.isZero() ? 0 : l.tierPrice.minus(l.unitPrice).div(l.tierPrice).mul(100).toDecimalPlaces(1).toNumber(), unitCost: l.unitCost, grossMargin: l.unitPrice.minus(l.unitCost).mul(l.qty), grossMarginPct: l.unitPrice.isZero() ? 0 : l.unitPrice.minus(l.unitCost).div(l.unitPrice).mul(100).toDecimalPlaces(1).toNumber(), tier: l.priceTier }));
      const req = await this.approvals.request({ type: 'SPECIAL_PRICE', documentType: 'SalesDoc', documentId: doc.id, requestedBy: user.id, summary: { controlNo: doc.controlNo, drSiNo: doc.drSiNo, locationId, locationName: loc.name, franchiseTier: costs.some((c) => c.tier === 'FRANCHISE'), lines: costs, total: doc.grandTotal.toFixed(2) } });
      await this.prisma.db.salesDoc.update({ where: { id: doc.id }, data: { specialPriceApprovalId: req.id } });
    }
    if (doc.lines.some((l) => l.nearExpiryWarn)) await this.audit.log({ action: 'NEAR_EXPIRY_SALE', entityType: 'SalesDoc', entityId: doc.id, after: doc.lines.filter((l) => l.nearExpiryWarn).map((l) => ({ product: l.product.name, batch: l.batch.batchNo, expiry: l.batch.expiryDate })) });
    await this.audit.log({ action: 'CREATE', entityType: 'SalesDoc', entityId: doc.id, after: doc });
    return this.get(doc.id, user);
  }

  private validatePayment(input: SalesInput) {
    if ((input.paymentMode === 'ONLINE' || input.paymentMode === 'CREDIT_CARD') && !input.paymentAccountId) throw new BadRequestException('payment account is required for ONLINE / CREDIT_CARD');
    if ((input.paymentMode === 'ONLINE' || input.paymentMode === 'CREDIT_CARD') && !input.proofOfPaymentAttachmentId) throw new BadRequestException({ message: 'Proof of payment upload is required for ONLINE / CREDIT_CARD', code: 'PROOF_REQUIRED' });
    if (input.paymentMode === 'CREDIT_CARD' && !(input.cardMid && input.cardSlipNo && input.cardApprovalCode && input.cardBatchNo)) throw new BadRequestException('Credit card sales need MID, slip no., approval code and batch no.');
    if (input.paymentMode === 'AR_PDC') { if (!input.customerId && !input.agentId) throw new BadRequestException('AR/PDC requires a customer or agent'); if (!input.dueDate) throw new BadRequestException('AR/PDC requires a due date'); }
    if (input.channel === 'DELIVERY' && !input.riderId) throw new BadRequestException('Delivery sales need a rider');
  }

  private async onSpecialPriceDecision(docId: string, outcome: 'APPROVED' | 'REJECTED') {
    await requestContext.runSystem(async () => {
      await this.prisma.db.salesDoc.update({ where: { id: docId }, data: { specialPriceStatus: outcome } });
      await this.prisma.db.salesLine.updateMany({ where: { docId, specialPriceFlag: 'PENDING' }, data: { specialPriceFlag: outcome } });
      if (outcome === 'REJECTED') { const d = await this.prisma.db.salesDoc.findUniqueOrThrow({ where: { id: docId } }); await this.notify.toUsers([d.preparedBy], { type: 'SPECIAL_PRICE_REJECTED', title: `Special price on ${d.drSiNo} rejected — correct via edit`, link: `/sales/${docId}` }); }
    });
  }

  /** Same-day edit by the associate (whole-document replace) or by auditors. Post-close → ClosingService.requestEdit. */
  async void(id: string, reason: string, user: SessionUser) {
    const doc = await this.get(id, user);
    if (doc.voidedAt) throw new BadRequestException('Already voided');
    if (await this.closing.isClosed(doc.locationId, doc.docDate) && !user.permissions.has('sale.edit.postclose')) throw new BadRequestException({ message: 'Day is closed; request a post-close edit', code: 'DAY_CLOSED' });
    if (doc.amountPaid.gt(0) && doc.paymentMode === 'AR_PDC') throw new BadRequestException('Void payments first');
    await this.posting.assertPeriodOpen(null, doc.docDate);
    await this.prisma.db.$transaction(async (tx) => {
      await this.stock.post(tx, doc.lines.map((l) => ({ locationId: doc.locationId, productId: l.productId, batchId: l.batchId, qtyDelta: l.qty, movementType: 'SALE_RETURN' as const, documentType: 'SalesDoc', documentId: doc.id, unitCost: l.unitCost, createdBy: user.id })));
      await tx.salesDoc.update({ where: { id }, data: { status: 'VOIDED', voidedAt: new Date(), voidedBy: user.id, voidReason: reason } });
      // reverse journal
      const vouchers = await tx.journalVoucher.findMany({ where: { sourceDocumentType: 'SalesDoc', sourceDocumentId: id, voidedAt: null }, include: { lines: true } });
      for (const v of vouchers) await this.posting.persist(tx, { rule: v.rule ?? 'REV', book: v.book, remarks: `Reversal of ${v.voucherNo}: ${reason}`, lines: v.lines.map((l) => ({ accountId: l.accountId, debit: D(l.credit), credit: D(l.debit) })) }, { type: 'SalesDoc', id, date: todayManila(), createdBy: user.id });
    });
    await this.approvals.cancelForDocument('SalesDoc', id);
    await this.audit.log({ action: 'VOID', entityType: 'SalesDoc', entityId: id, before: doc, after: { reason } });
    return this.get(id, user);
  }

  // ── AR / payments / credit notes (§8.3) ──
  async arList(user: SessionUser, q: { locationId?: string; customerId?: string; overdueOnly?: boolean }) {
    const where: Prisma.SalesDocWhereInput = { paymentMode: 'AR_PDC', voidedAt: null, locationId: this.scope.locationFilter(user, q.locationId) as never, customerId: q.customerId };
    const docs = await this.prisma.db.salesDoc.findMany({ where, include: { customer: true, agent: true, location: { select: { code: true, name: true } } }, orderBy: { dueDate: 'asc' } });
    const today = todayManila();
    return docs.map((d) => ({ id: d.id, location: d.location, customer: d.customer?.name ?? d.agent?.name ?? d.customerName, customerId: d.customerId, agentId: d.agentId, drSiNo: d.drSiNo, docDate: dateStr(d.docDate), amount: d.grandTotal, paid: d.amountPaid, balance: d.grandTotal.minus(d.amountPaid), dueDate: d.dueDate ? dateStr(d.dueDate) : null, daysOverdue: d.dueDate && d.grandTotal.gt(d.amountPaid) ? Math.max(0, daysBetween(d.dueDate, today)) : 0, pdc: d.pdcChequeNo ? { bank: d.pdcBank, chequeNo: d.pdcChequeNo, date: d.pdcDate } : null }))
      .filter((r) => r.balance.gt(0) && (!q.overdueOnly || r.daysOverdue > 0));
  }

  /**
   * AR collection (owner request 2026-09-26). Accounting (ar.approve) records a payment and it applies at once; the branch is notified.
   * Anyone else (a sales associate, any day) records it as PENDING: Accounting Associate or Head approves before the invoices are
   * credited. Franchise AR stays with the franchise and applies at once.
   */
  async recordPayment(input: { salesDocIds: string[]; amount: number; discount?: number; paymentMode: PaymentMode; paymentAccountId?: string | null; proofAttachmentId?: string | null; receivedAt?: string; notes?: string }, user: SessionUser) {
    if (!input.salesDocIds.length) throw new BadRequestException('Pick at least one invoice');
    if ((input.paymentMode === 'ONLINE' || input.paymentMode === 'CREDIT_CARD') && (!input.paymentAccountId || !input.proofAttachmentId)) throw new BadRequestException('Online/card collections need a payment account and proof upload');
    const docs = await this.openInvoices(input.salesDocIds, user);
    const total = D(input.amount).plus(input.discount ?? 0);
    const pending = await this.pendingFor(input.salesDocIds);
    const open = sum(docs.map((d) => d.grandTotal.minus(d.amountPaid))).minus(pending);
    if (total.gt(open)) throw new BadRequestException(`Payment ${total} exceeds open balance ${open}${pending.gt(0) ? ` (after ${pending} already waiting for approval)` : ''}`);
    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: docs[0].locationId } });
    const direct = user.permissions.has('ar.approve') || loc.type === 'FRANCHISE';
    const payment = await this.prisma.db.$transaction(async (tx) => {
      const creditNoteNo = await this.seq.form(tx, 'CN', loc.id);
      const p = await tx.payment.create({ data: { creditNoteNo, customerId: docs[0].customerId, amount: D(input.amount).toFixed(2), discount: D(input.discount ?? 0).toFixed(2), paymentMode: input.paymentMode, paymentAccountId: input.paymentAccountId ?? null, proofAttachmentId: input.proofAttachmentId ?? null, receivedAt, businessDate: toDateOnly(receivedAt), notes: input.notes, createdBy: user.id, status: direct ? 'POSTED' : 'PENDING', requestedSalesDocIds: docs.map((d) => d.id), locationId: loc.id } });
      if (direct) await this.applyPayment(tx, p, docs, user.id);
      return p;
    });
    await this.audit.log({ action: direct ? 'CREATE' : 'CREATE_PENDING', entityType: 'Payment', entityId: payment.id, after: payment });
    const who = docs[0].customer?.name ?? docs[0].agent?.name ?? docs[0].customerName ?? '';
    if (direct) {
      await this.notify.toLocation(loc.id, { type: 'AR_PAYMENT_RECORDED', title: `AR payment ${payment.creditNoteNo} recorded by ${user.fullName}: ₱${payment.amount} from ${who}`, body: `Applied to ${docs.map((d) => d.drSiNo).join(', ')}`, link: '/ar' });
    } else {
      const req = await this.approvals.request({ type: 'AR_PAYMENT', documentType: 'Payment', documentId: payment.id, requestedBy: user.id, summary: { controlNo: payment.creditNoteNo, locationId: loc.id, locationName: loc.name, customer: who, total: payment.amount, discount: payment.discount, paymentMode: payment.paymentMode, receivedAt: receivedAt.toISOString().slice(0, 10), invoices: docs.map((d) => d.drSiNo).join(', '), enteredBy: user.fullName } });
      await this.prisma.db.payment.update({ where: { id: payment.id }, data: { approvalRequestId: req.id } });
    }
    return this.prisma.db.payment.findUniqueOrThrow({ where: { id: payment.id }, include: { allocations: { include: { salesDoc: { select: { drSiNo: true, grandTotal: true, amountPaid: true } } } }, customer: true } });
  }

  private async openInvoices(ids: string[], user: SessionUser | null) {
    const docs = await this.prisma.db.salesDoc.findMany({ where: { id: { in: ids }, voidedAt: null, ...(user ? { locationId: this.scope.locationFilter(user) as never } : {}) }, include: { customer: true, agent: true } });
    if (docs.length !== ids.length) throw new BadRequestException('Unknown invoice');
    if (user) for (const d of docs) if (user.locationScoped && !user.locationIds.includes(d.locationId)) throw new ForbiddenException();
    if (new Set(docs.map((d) => d.customerId ?? d.agentId)).size > 1) throw new BadRequestException('One payment must belong to one customer');
    return docs;
  }
  private async pendingFor(docIds: string[], exceptPaymentId?: string) {
    const rows = await this.prisma.db.payment.findMany({ where: { status: 'PENDING', voidedAt: null, requestedSalesDocIds: { hasSome: docIds }, id: exceptPaymentId ? { not: exceptPaymentId } : undefined }, select: { amount: true, discount: true } });
    return sum(rows.map((r) => D(r.amount).plus(r.discount)));
  }
  /** Allocates oldest invoice first and posts R4. */
  private async applyPayment(tx: Tx, p: { id: string; amount: Prisma.Decimal; discount: Prisma.Decimal; paymentMode: PaymentMode; paymentAccountId: string | null; receivedAt: Date; creditNoteNo: string }, docs: Awaited<ReturnType<SalesService['openInvoices']>>, actorId: string | null) {
    let remaining = D(p.amount).plus(p.discount);
    for (const d of [...docs].sort((a, b) => a.docDate.getTime() - b.docDate.getTime())) {
      if (remaining.lte(0)) break;
      const fresh = await tx.salesDoc.findUniqueOrThrow({ where: { id: d.id }, select: { grandTotal: true, amountPaid: true } });
      const bal = fresh.grandTotal.minus(fresh.amountPaid);
      const alloc = bal.lt(remaining) ? bal : remaining;
      if (alloc.lte(0)) continue;
      await tx.paymentAllocation.create({ data: { paymentId: p.id, salesDocId: d.id, amount: alloc.toFixed(2) } });
      await tx.salesDoc.update({ where: { id: d.id }, data: { amountPaid: { increment: alloc.toFixed(2) } } });
      remaining = remaining.minus(alloc);
    }
    if (remaining.gt(0)) throw new BadRequestException(`Payment exceeds the open balance by ${remaining}`);
    const cp = docs[0].customer ? { type: docs[0].customer.type, id: docs[0].customer.id } : docs[0].agent ? { type: 'AGENT', id: docs[0].agent.id } : null;
    if (p.paymentAccountId || p.paymentMode === 'CASH') {
      await this.posting.post(tx, { type: 'Payment', id: p.id, date: toDateOnly(p.receivedAt), name: docs[0].customer?.name, createdBy: actorId }, (r) => r4Collection(r, { locationId: docs[0].locationId, counterparty: cp, amount: p.amount, discount: p.discount, paymentAccountId: p.paymentAccountId ?? r.branch('CASH_ON_HAND', docs[0].locationId), creditNoteNo: p.creditNoteNo }));
    }
  }
  private async onPaymentDecision(paymentId: string, outcome: 'APPROVED' | 'REJECTED', actorId: string | null) {
    await requestContext.runSystem(async () => {
      const p = await this.prisma.db.payment.findUniqueOrThrow({ where: { id: paymentId } });
      if (p.status !== 'PENDING') return;
      if (outcome === 'REJECTED') { await this.prisma.db.payment.update({ where: { id: paymentId }, data: { status: 'REJECTED' } }); }
      else {
        const docs = await this.openInvoices(p.requestedSalesDocIds, null);
        await this.prisma.db.$transaction(async (tx) => { await this.applyPayment(tx, p, docs, actorId); await tx.payment.update({ where: { id: paymentId }, data: { status: 'POSTED' } }); });
      }
      if (p.locationId) await this.notify.toLocation(p.locationId, { type: 'AR_PAYMENT_DECIDED', title: `AR payment ${p.creditNoteNo} (₱${p.amount}) ${outcome === 'APPROVED' ? 'approved and applied' : 'rejected'} by Accounting`, link: '/ar' });
    });
  }

  async creditNotes(user: SessionUser, q: { from?: string; to?: string }) {
    const rows = await this.prisma.db.payment.findMany({ where: { voidedAt: null, businessDate: q.from || q.to ? { gte: q.from ? toDateOnly(q.from) : undefined, lte: q.to ? toDateOnly(q.to) : undefined } : undefined, ...(user.locationScoped ? { OR: [{ allocations: { some: { salesDoc: { locationId: { in: user.locationIds } } } } }, { locationId: { in: user.locationIds } }] } : {}) }, include: { customer: true, allocations: { include: { salesDoc: { select: { drSiNo: true, locationId: true } } } } }, orderBy: { receivedAt: 'desc' } });
    // who entered each payment (branch transactions are shared by the branch but tagged to the person)
    const users = await this.prisma.db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdBy).filter((x): x is string => !!x))] } }, select: { id: true, fullName: true } });
    return rows.map((r) => ({ ...r, enteredBy: users.find((u) => u.id === r.createdBy)?.fullName ?? null }));
  }

  /** §8.2 Agent sales report per agent per period with totals by payment mode. */
  async agentReport(user: SessionUser, q: { from: string; to: string; agentId?: string }) {
    const docs = await this.prisma.db.salesDoc.findMany({ where: { voidedAt: null, agentId: q.agentId ?? { not: null }, locationId: user.locationScoped ? { in: user.locationIds } : { not: '' }, docDate: { gte: toDateOnly(q.from), lte: toDateOnly(q.to) } }, include: { agent: true } });
    const byAgent = new Map<string, { agent: string; count: number; total: Prisma.Decimal; byMode: Record<string, Prisma.Decimal>; arOpen: Prisma.Decimal }>();
    for (const d of docs) {
      const k = d.agentId!; const cur = byAgent.get(k) ?? { agent: d.agent!.name, count: 0, total: new Prisma.Decimal(0), byMode: {}, arOpen: new Prisma.Decimal(0) };
      cur.count++; cur.total = cur.total.plus(d.grandTotal); cur.byMode[d.paymentMode] = (cur.byMode[d.paymentMode] ?? new Prisma.Decimal(0)).plus(d.grandTotal);
      if (d.paymentMode === 'AR_PDC') cur.arOpen = cur.arOpen.plus(d.grandTotal.minus(d.amountPaid));
      byAgent.set(k, cur);
    }
    return [...byAgent.entries()].map(([agentId, v]) => ({ agentId, ...v }));
  }

  /** Overdue AR job (§8.3): notify branch users, franchise owner, Head Auditor, Admin (daily digest handles email). */
  async notifyOverdue() {
    const today = todayManila();
    const overdue = await this.prisma.db.salesDoc.findMany({ where: { paymentMode: 'AR_PDC', voidedAt: null, dueDate: { lt: today } }, include: { customer: true, location: true } });
    const open = overdue.filter((d) => d.grandTotal.gt(d.amountPaid));
    const byLoc = new Map<string, typeof open>();
    for (const d of open) byLoc.set(d.locationId, [...(byLoc.get(d.locationId) ?? []), d]);
    for (const [locationId, docs] of byLoc) {
      const total = sum(docs.map((d) => d.grandTotal.minus(d.amountPaid)));
      const n = { type: 'AR_OVERDUE', title: `${docs.length} overdue receivable(s) at ${docs[0].location.name} — ₱${total.toFixed(2)}`, link: `/ar?locationId=${locationId}&overdue=1` };
      const state = await this.prisma.db.alertState.findUnique({ where: { kind_refKey: { kind: 'AR_OVERDUE', refKey: locationId } } });
      if (state && daysBetween(state.lastSentAt, new Date()) < 1) continue;
      await this.notify.toLocation(locationId, n, ['HEAD_AUDITOR', 'ADMIN']);
      await this.prisma.db.alertState.upsert({ where: { kind_refKey: { kind: 'AR_OVERDUE', refKey: locationId } }, create: { kind: 'AR_OVERDUE', refKey: locationId, lastSentAt: new Date() }, update: { lastSentAt: new Date() } });
    }
    return { locations: byLoc.size, invoices: open.length };
  }

  // ── Consignment sale report (§7.4 OUT) ──
  async consignmentSaleReport(input: { agreementId: string; periodFrom: string; periodTo: string; notes?: string; lines: { productId: string; qty: number; unitPrice: number }[] }, user: SessionUser) {
    const ag = await this.prisma.db.consignmentAgreement.findUniqueOrThrow({ where: { id: input.agreementId }, include: { counterpartyLocation: true } });
    if (ag.direction !== 'OUT' || !ag.counterpartyLocation) throw new BadRequestException('Agreement is not a consignment-out agreement');
    const consignee = ag.counterpartyLocation;
    const wh = await this.prisma.db.location.findFirstOrThrow({ where: { type: 'WAREHOUSE' } });
    const customer = await this.prisma.db.customer.findFirst({ where: { locationId: consignee.id } }) ?? await this.master.createCustomer({ name: consignee.name, type: 'CONSIGNEE', locationId: consignee.id }, user.id);
    const periodTo = toDateOnly(input.periodTo);
    const result = await this.prisma.db.$transaction(async (tx) => {
      const report = await tx.consignmentSaleReport.create({ data: { agreementId: ag.id, periodFrom: toDateOnly(input.periodFrom), periodTo, notes: input.notes, createdBy: user.id, lines: { create: input.lines } } });
      const controlNo = await this.seq.form(tx, 'DR', wh.id);
      const lineRows: Prisma.SalesLineUncheckedCreateWithoutDocInput[] = []; let total = ZERO; const costLines: { accountingClass: string; qty: number; unitCost: Prisma.Decimal }[] = [];
      for (const l of input.lines) {
        const picks = await this.stock.pickFefo(tx, consignee.id, l.productId, l.qty, { allowExpired: true });
        const prod = await tx.product.findUniqueOrThrow({ where: { id: l.productId }, include: { category: true } });
        for (const p of picks) {
          const amt = round2(D(l.unitPrice).mul(p.qty)); total = total.plus(amt);
          lineRows.push({ productId: l.productId, batchId: p.batchId, qty: p.qty, priceTier: 'OTHER', tierPrice: D(l.unitPrice).toFixed(2), unitPrice: D(l.unitPrice).toFixed(2), unitCost: p.unitCost, amount: amt.toFixed(2) });
          costLines.push({ accountingClass: prod.category.accountingClass, qty: p.qty, unitCost: p.unitCost });
          await this.stock.post(tx, [{ locationId: consignee.id, productId: l.productId, batchId: p.batchId, qtyDelta: -p.qty, movementType: 'CONSIGN_SALE', documentType: 'ConsignmentSaleReport', documentId: report.id, unitCost: p.unitCost, businessDate: periodTo, createdBy: user.id }]);
        }
      }
      const sale = await tx.salesDoc.create({ data: { controlNo, docDate: periodTo, locationId: wh.id, channel: 'OTHER', channelSub: 'CONSIGNMENT', customerId: customer.id, drSiNo: `CSG-${report.id.slice(0, 8)}`, paymentMode: 'AR_PDC', dueDate: addDays(periodTo, 30), productTotal: total.toFixed(2), grandTotal: total.toFixed(2), preparedBy: user.id, createdBy: user.id, lines: { create: lineRows } } });
      await tx.consignmentSaleReport.update({ where: { id: report.id }, data: { salesDocId: sale.id } });
      await this.posting.post(tx, { type: 'SalesDoc', id: sale.id, date: periodTo, name: consignee.name, createdBy: user.id }, (r) => r8ConsigneeSale(r, { branchLocationId: wh.id, consigneeLocationId: consignee.id, ref: sale.drSiNo, saleTotal: total, costLines }));
      return { report, sale };
    });
    await this.audit.log({ action: 'CREATE', entityType: 'ConsignmentSaleReport', entityId: result.report.id, after: result });
    return result;
  }
  listAgreements() { return this.prisma.db.consignmentAgreement.findMany({ include: { counterpartyLocation: { select: { id: true, code: true, name: true } }, supplier: { select: { id: true, code: true, name: true } } } }); }
  createAgreement(data: { direction: 'OUT' | 'IN'; counterpartyLocationId?: string; supplierId?: string; valuationBasis?: 'SRP' | 'COST' | 'CONSIGNEE_PRICE'; settlementTerms?: string }, user: SessionUser) { return this.prisma.db.consignmentAgreement.create({ data: { ...data, createdBy: user.id } }); }
  /** Consignment Out Summary (§7.4). */
  async consignmentOutSummary() {
    const consignees = await this.prisma.db.location.findMany({ where: { type: 'CONSIGNEE', active: true } });
    const out = [];
    for (const c of consignees) {
      const bal = await this.prisma.db.stockBalance.findMany({ where: { locationId: c.id, qty: { gt: 0 } }, include: { batch: true, product: { select: { id: true, sku: true, name: true } } } });
      const prices = await this.master.currentPrices(bal.map((b) => b.productId));
      const sold = await this.prisma.db.stockLedger.groupBy({ by: ['productId'], where: { locationId: c.id, movementType: 'CONSIGN_SALE' }, _sum: { qtyDelta: true } });
      const ar = await this.prisma.db.salesDoc.aggregate({ where: { customer: { locationId: c.id }, voidedAt: null }, _sum: { grandTotal: true, amountPaid: true } });
      out.push({ consignee: c, unpaidAr: D(ar._sum.grandTotal).minus(D(ar._sum.amountPaid)), products: bal.map((b) => ({ product: b.product, qty: b.qty, valueAtCost: b.batch.unitCost.mul(b.qty), valueAtSrp: D(prices.get(b.productId)?.RETAIL ?? 0).mul(b.qty), soldToDate: -(sold.find((s) => s.productId === b.productId)?._sum.qtyDelta ?? 0) })) });
    }
    return out;
  }
  /** Consignment In Settlement per consignor (§7.4 IN). */
  async consignmentInSettlement(q: { from: string; to: string }) {
    const lines = await this.prisma.db.salesLine.findMany({ where: { batch: { isConsignmentIn: true }, doc: { voidedAt: null, docDate: { gte: toDateOnly(q.from), lte: toDateOnly(q.to) } } }, include: { batch: { include: { supplier: { select: { id: true, code: true, name: true } } } }, product: { select: { sku: true, name: true } } } });
    const bySupplier = new Map<string, { supplier: unknown; qtySold: number; costPayable: Prisma.Decimal }>();
    for (const l of lines) { const k = l.batch.supplierId ?? 'unknown'; const cur = bySupplier.get(k) ?? { supplier: l.batch.supplier, qtySold: 0, costPayable: new Prisma.Decimal(0) }; cur.qtySold += l.qty; cur.costPayable = cur.costPayable.plus(l.unitCost.mul(l.qty)); bySupplier.set(k, cur); }
    return [...bySupplier.values()];
  }
}
