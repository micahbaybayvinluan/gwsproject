import { SixPackService } from '../sixpack/sixpack.service';
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
import { AccountsService } from '../gl/accounts.service';
import { r3r4Sale, r4Collection, r8ConsigneeSale } from '../gl/posting-rules';
import { toDateOnly, todayManila, addDays, dateStr, daysBetween } from '../common/manila';
import { D, round2, sum, ZERO } from '../common/money';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';
import { ClosingService } from '../closing/closing.service';
import { ScopeService } from '../common/scope.service';
import { ExpensesService } from '../expenses/expenses.service';
import { OutletsService } from '../agents/outlets.service';
import { MonitorService } from '../agents/monitor.service';
import { CustomerFollowUpsService } from './customer-followups.service';
import { FranchiseShippingService } from '../franchise/franchise-shipping.service';
import { FranchiseDrService } from '../franchise/franchise-dr.service';
import { LoyaltyService } from '../members/loyalty.service';
import { PromosService } from '../promos/promos.service';

export interface SalesLineInput { productId: string; qty: number; unitPrice?: number | null; batchId?: string | null; exactBatch?: boolean; isFreebie?: boolean; lineRemarks?: string; priceTier?: string; /** ticked by the associate: sold at the promo price (counted against the promo, owner request 2026-10-15); false = not a promo sale */ promo?: boolean | null }
export interface SalesInput {
  locationId?: string; docDate?: string; channel: SalesChannel; channelSub?: string | null; customerId?: string | null; agentId?: string | null; outletId?: string | null; memberId?: string | null; voucherCode?: string | null; riderId?: string | null; customerName?: string | null; customerPhone?: string | null; customerEmail?: string | null; drSiNo: string;
  paymentMode: PaymentMode; paymentAccountId?: string | null; proofOfPaymentAttachmentId?: string | null; cardMid?: string; cardSlipNo?: string; cardApprovalCode?: string; cardBatchNo?: string; cardAmount?: number | null; cardAdjustReason?: string | null;
  deliveryFee?: number; riderIncentive?: number; incentive?: { amount: number; payee: string; kind?: 'SALES' | 'RIDER' } | null; sixPackSticker?: boolean; franchiseShipping?: { mode: 'NONE' | 'TO_FOLLOW' | 'AMOUNT'; amount?: number; courier?: string; reference?: string }; shippingFee?: number; shippingExpense?: number; marketplaceCharges?: number; dueDate?: string | null; pdcBank?: string; pdcChequeNo?: string; pdcDate?: string | null; notes?: string;
  lines: SalesLineInput[];
}

const franchiseUserOf = (u: SessionUser) => u.roleKey.startsWith('FRANCHISE');
export const TIER_BY_CHANNEL: Record<SalesChannel, string> = { WALK_IN: 'RETAIL', DELIVERY: 'RETAIL', SHIPPING_COURIER: 'RETAIL', SHIPPING_MARKETPLACE: 'RETAIL', FRANCHISE: 'FRANCHISE', DEALER: 'DEALER', AGENT: 'AGENT', PERSONAL: 'RETAIL', OTHER: 'RETAIL' };

/** §8 Sales module: entry (all channels/modes), agents, AR/PDC, payments, credit notes. Stock is deducted on save (FEFO). */
export type AmendInput = { lines: SalesLineInput[]; notes?: string | null; dueDate?: string | null; drSiNo?: string | null; customerName?: string | null };

@Injectable()
export class SalesService implements OnModuleInit {
  constructor(private prisma: PrismaService, private seq: SequenceService, private stock: StockService, private approvals: ApprovalsService, private master: MasterService, private notify: NotificationsService, private audit: AuditService, private settings: SettingsService, private attachments: AttachmentsService, private posting: PostingService, private closing: ClosingService, private scope: ScopeService, private expenses: ExpensesService, private followUps: CustomerFollowUpsService, private outlets: OutletsService, private agentMonitor: MonitorService, private sixPack: SixPackService, private franchiseShipping: FranchiseShippingService, private loyalty: LoyaltyService, private promos: PromosService, private franchiseDr: FranchiseDrService, private accounts: AccountsService) {}

  onModuleInit() {
    this.approvals.register('SPECIAL_PRICE', (req, outcome) => this.onSpecialPriceDecision(req.documentId, outcome));
    this.approvals.register('AR_PAYMENT', (req, outcome, actor) => this.onPaymentDecision(req.documentId, outcome, actor?.id ?? null, actor?.note));
  }

  private include = { location: { select: { id: true, code: true, name: true, type: true } }, customer: { select: { id: true, code: true, name: true, type: true } }, agent: { select: { id: true, name: true } }, outlet: { select: { id: true, name: true, agentName: true } }, member: { select: { id: true, memberNo: true, fullName: true } }, rider: { select: { id: true, name: true } }, paymentAccount: { select: { id: true, title: true, paymentAccountType: true } }, lines: { include: { product: { select: { id: true, sku: true, name: true, category: { select: { accountingClass: true, name: true } } } }, batch: { select: { id: true, batchNo: true, expiryDate: true, flavor: true, isConsignmentIn: true } } } }, payments: { include: { payment: true } } } as const;

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

  async create(input: SalesInput, user: SessionUser, opts: { skipClosedCheck?: boolean; amendedFrom?: string } = {}) {
    // Wheysted member, voucher, 6-Pack sticker and the customer's phone / email are for retail customers only; a franchise, dealer, agent or marketplace sale carries none of them (owner request 2026-10-16)
    if (['FRANCHISE', 'DEALER', 'AGENT', 'SHIPPING_MARKETPLACE'].includes(input.channel)) input = { ...input, memberId: null, voucherCode: null, sixPackSticker: false, customerPhone: null, customerEmail: null };
    const locationId = input.locationId ?? user.locationIds[0];
    if (!locationId) throw new BadRequestException('locationId required');
    if (user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException('Outside your branch');
    // the agent's outlet this sale is tagged to (owner request 2026-10-02): only approved outlets
    if (input.outletId) await this.outlets.assertTaggable(input.outletId);
    // the Wheysted member this sale is for (owner request 2026-10-03)
    if (input.memberId) { const mem = await this.prisma.db.member.findUnique({ where: { id: input.memberId }, select: { status: true, fullName: true } }); if (!mem) throw new BadRequestException('Unknown member'); if (mem.status !== 'ACTIVE') throw new BadRequestException(`${mem.fullName}'s membership is blocked`); }
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: locationId } });
    if (!loc.isSelling) throw new BadRequestException('This location does not sell');
    // Franchise Coordinators (owner requests 2026-10-01 and 2026-10-02) record sales from the warehouse: franchises and every other channel, any payment mode
    const warehouseOnly = !user.permissions.has('sale.create');
    const franchiseCustomer = input.channel === 'FRANCHISE' && input.customerId ? await this.prisma.db.customer.findUnique({ where: { id: input.customerId }, select: { id: true, type: true, locationId: true, name: true } }) : null;
    if (franchiseCustomer && franchiseCustomer.type !== 'FRANCHISE') throw new BadRequestException('Choose a franchisee for a franchise sale');
    if (warehouseOnly && loc.type !== 'WAREHOUSE') throw new ForbiddenException('You can record sales from the warehouse only');
    if (warehouseOnly && input.channel === 'FRANCHISE' && !franchiseCustomer) throw new BadRequestException('Choose the franchisee');
    const ship = input.franchiseShipping && input.franchiseShipping.mode !== 'NONE' ? input.franchiseShipping : null;
    if (ship) {
      if (input.channel !== 'FRANCHISE') throw new BadRequestException('A shipping charge to a franchise belongs on a franchise sale');
      if (!franchiseCustomer?.locationId) throw new BadRequestException('Choose the franchisee: its franchise location is needed to bill the shipping');
      if (ship.mode === 'AMOUNT' && !(ship.amount && ship.amount > 0)) throw new BadRequestException('Type the shipping amount, or choose "to follow"');
    }
    const docDate = input.docDate ? toDateOnly(input.docDate) : todayManila();
    let incentive = input.incentive && input.incentive.amount > 0 ? { amount: round2(D(input.incentive.amount)).toNumber(), payee: input.incentive.payee?.trim() ?? '', kind: input.incentive.kind ?? 'SALES' } : null;
    // the older "Rider incentive" box on delivery sales becomes the same cash-paid rider incentive expense, so every report counts it once
    if (!incentive && (input.riderIncentive ?? 0) > 0 && loc.type !== 'FRANCHISE' && user.permissions.has('sale.incentive')) {
      const rider = input.riderId ? await this.prisma.db.rider.findUnique({ where: { id: input.riderId }, select: { name: true } }) : null;
      incentive = { amount: round2(D(input.riderIncentive!)).toNumber(), payee: rider?.name ?? 'Rider', kind: 'RIDER' };
      input = { ...input, riderIncentive: 0 };
    }
    if (incentive) {
      if (!user.permissions.has('sale.incentive')) throw new ForbiddenException('You are not allowed to add an incentive to a sale');
      if (!incentive.payee) throw new BadRequestException('Who receives the incentive?');
      if (loc.type === 'FRANCHISE') throw new BadRequestException('Franchise incentives are franchise expenses (Franchise Portal)');
      await this.expenses.incentiveAccount(locationId, incentive.kind); // clear error before anything is saved
    }
    if (docDate > todayManila()) throw new BadRequestException('Sale date cannot be in the future');
    if (input.paymentMode === 'AR_PDC' && input.dueDate && toDateOnly(input.dueDate) < docDate) throw new BadRequestException(`The due date (${input.dueDate}) cannot be before the date of the sale (${dateStr(docDate)})`);
    if (!opts.skipClosedCheck && (await this.closing.isClosed(locationId, docDate))) throw new BadRequestException({ message: 'This business day is closed; submit a post-close edit request instead', code: 'DAY_CLOSED' });
    if (!input.lines.length) throw new BadRequestException('At least one line');
    if (!input.drSiNo?.trim()) throw new BadRequestException('DR/SI number is required');
    if (await this.prisma.db.salesDoc.findUnique({ where: { locationId_drSiNo: { locationId, drSiNo: input.drSiNo.trim() } } })) throw new BadRequestException({ message: `DR/SI ${input.drSiNo.trim()} already exists at this branch (one SalesDoc per DR/SI)`, code: 'DUPLICATE_DR' });
    this.validatePayment(input);
    const franchiseUser = user.roleKey.startsWith('FRANCHISE');
    const nearExpiryDays = await this.settings.get<number>('alerts.near_expiry_days');
    const autoDiscountPct = D(await this.settings.get<number>('approval.special_price_auto_discount_pct'));
    // price list by how the customer buys (owner request 2026-09-30): a marketplace order follows that platform's list; paid by credit card = credit-card price
    const platformTier = input.channel === 'SHIPPING_MARKETPLACE' && input.channelSub && ['TIKTOK', 'SHOPEE', 'LAZADA'].includes(input.channelSub.toUpperCase()) ? input.channelSub.toUpperCase() : null;
    const defaultTier = input.agentId && input.channel !== 'AGENT' ? 'AGENT' : platformTier ?? (input.paymentMode === 'CREDIT_CARD' && TIER_BY_CHANNEL[input.channel] === 'RETAIL' ? 'CC' : TIER_BY_CHANNEL[input.channel]);

    // member voucher (owner request 2026-10-06): the member's own, unused, in date; takes its value off the supplement lines
    let voucher: Awaited<ReturnType<LoyaltyService['validate']>> | null = null;
    if (input.voucherCode?.trim()) { if (!input.memberId) throw new BadRequestException('Tag the member first, then use their voucher'); voucher = await this.loyalty.validate(input.voucherCode, input.memberId, docDate); }
    // member prices running today (owner request 2026-10-06): applied when no price is typed and a member is tagged
    const offers = input.memberId && !franchiseUserOf(user) ? await this.loyalty.offerPrices(docDate) : new Map<string, Prisma.Decimal>();
    // promos the Owner or Head Auditor issued (owner request 2026-10-07): a promo price applies by itself while it runs
    const branchPromo = franchiseUserOf(user) ? new Map<string, Prisma.Decimal>() : await this.promos.activePrices(docDate, 'BRANCHES');
    const franchisePromo = franchiseUserOf(user) ? new Map<string, Prisma.Decimal>() : await this.promos.activePrices(docDate, 'FRANCHISES');
    const branchPromoIds = franchiseUserOf(user) ? new Map<string, string>() : await this.promos.activePromoIds(docDate, 'BRANCHES');
    const franchisePromoIds = franchiseUserOf(user) ? new Map<string, string>() : await this.promos.activePromoIds(docDate, 'FRANCHISES');
    const voucherLines: Prisma.SalesLineUncheckedCreateWithoutDocInput[] = [];
    let voucherDiscount = ZERO;

    const doc = await this.prisma.db.$transaction(async (tx) => {
      const controlNo = await this.seq.form(tx, 'DR', locationId);
      const lineRows: Prisma.SalesLineUncheckedCreateWithoutDocInput[] = [];
      let productTotal = ZERO; let special = false; let supplementUnits = 0;
      for (const l of input.lines) {
        if (l.qty <= 0) throw new BadRequestException('Qty must be positive');
        const product = await tx.product.findUniqueOrThrow({ where: { id: l.productId }, include: { category: true, bundleComponents: true } });
        if (franchiseUser && !product.franchiseVisible) throw new ForbiddenException(`${product.name} is not available to franchises`);
        const tier = l.priceTier ?? defaultTier;
        if (!user.permissions.has(`price.view.${tier}`) && !franchiseUser) throw new ForbiddenException(`You may not sell at tier ${tier}`);
        // Plastic (owner request 2026-10-01): priced on a franchise sale (its franchise price: L 4, M 3, S 3, XL 5); for stores and other customers it is free (0) unless the price is typed because it was sold
        const isPlastic = product.category.accountingClass === 'PLASTIC';
        const classFree = !isPlastic && (!!l.isFreebie || product.category.accountingClass === 'FREEBIE');
        const tierPrice = classFree ? ZERO : tier === 'FRANCHISE' || !isPlastic ? D(await this.master.priceFor(product.id, tier, docDate, tx)) : ZERO;
        let unitPrice = classFree ? ZERO : l.unitPrice != null ? D(l.unitPrice) : tierPrice;
        let memberBacked = false;
        const promoIds = tier === 'RETAIL' && loc.type !== 'FRANCHISE' ? branchPromoIds : tier === 'FRANCHISE' ? franchisePromoIds : new Map<string, string>();
        if (l.promo === true && !classFree && !promoIds.has(product.id)) throw new BadRequestException(`No promo is running for ${product.name}: untick "promo price"`);
        let promoId: string | null = null; let promoTicked = false;
        if (!classFree && l.unitPrice == null && !franchiseUser) {
          // unticked "promo price" = the customer is not given the promo: only a member price can apply
          const a = this.autoPriceFor(product.id, tier, tierPrice, { offers, branchPromo: l.promo === false ? new Map() : branchPromo, franchisePromo: l.promo === false ? new Map() : franchisePromo, franchiseLoc: loc.type === 'FRANCHISE' });
          if (a) { unitPrice = a.price; memberBacked = true; if (a.source === 'PROMO') { promoTicked = true; promoId = promoIds.get(product.id) ?? null; } }
        }
        if (l.promo === true && !classFree) { promoTicked = true; promoId = promoIds.get(product.id) ?? promoId; }
        const isFreebie = classFree || (isPlastic && unitPrice.isZero());
        if (!isFreebie && product.category.accountingClass === 'SUPPLEMENT') supplementUnits += l.qty;
        if (franchiseUser && l.unitPrice != null && !unitPrice.equals(tierPrice)) {
          if (user.roleKey === 'FRANCHISE_SALES_ASSOCIATE') throw new ForbiddenException('Franchise associates cannot change prices'); // §18.2
          // Franchise owner sells at their own retail price: no SPECIAL_PRICE approval applies (§18.2)
        }
        let flag: string | null = null;
        if (!franchiseUser && !classFree && !memberBacked && unitPrice.lt(tierPrice)) {
          const discountPct = tierPrice.isZero() ? D(0) : tierPrice.minus(unitPrice).div(tierPrice).mul(100);
          if (discountPct.gt(autoDiscountPct)) { special = true; flag = 'PENDING'; }
        }
        // Bundles consume components (§4.2)
        const consume = product.isBundle && product.bundleComponents.length ? product.bundleComponents.map((c) => ({ productId: c.componentProductId, qty: c.qty * l.qty })) : [{ productId: product.id, qty: l.qty }];
        let first = true;
        for (const c of consume) {
          const picks = await this.stock.pickFefo(tx, locationId, c.productId, c.qty, { preferBatchId: l.batchId ?? undefined, exactBatchId: l.exactBatch && l.batchId && !product.isBundle ? l.batchId : undefined });
          for (const p of picks) {
            const near = !!p.expiryDate && daysBetween(todayManila(), p.expiryDate) <= nearExpiryDays;
            const lineQty = product.isBundle ? (first ? l.qty : 0) : p.qty;
            const amount = round2(unitPrice.mul(lineQty));
            // for bundles: the sale line records the bundle product once; component picks record cost with qty 0 price
            lineRows.push({ promoTicked, promoId, productId: product.isBundle ? product.id : c.productId, batchId: p.batchId, qty: product.isBundle ? (first ? l.qty : p.qty) : p.qty, priceTier: tier, tierPrice: tierPrice.toFixed(2), unitPrice: unitPrice.toFixed(2), unitCost: p.unitCost, amount: amount.toFixed(2), isFreebie, lineRemarks: l.lineRemarks, nearExpiryWarn: near, specialPriceFlag: flag });
            productTotal = productTotal.plus(amount);
            if (voucher && !isFreebie && product.category.accountingClass === 'SUPPLEMENT' && amount.gt(0)) voucherLines.push(lineRows[lineRows.length - 1]!);
            await this.stock.post(tx, [{ locationId, productId: c.productId, batchId: p.batchId, qtyDelta: -p.qty, movementType: isFreebie ? 'FREEBIE_ISSUE' : 'SALE', documentType: 'SalesDoc', documentId: controlNo /* replaced below */, unitCost: p.unitCost, businessDate: docDate, createdBy: user.id }]);
            first = false;
          }
        }
        unitPrice = ZERO;
      }
      if (voucher) {
        const base = voucherLines.reduce((t, r) => t.plus(D(r.amount as string)), ZERO);
        if (base.isZero()) throw new BadRequestException(`The voucher ${voucher.code} takes off supplements only; this sale has none`);
        if (base.lt(D(voucher.minPurchase))) throw new BadRequestException(`The voucher ${voucher.code} needs at least ${D(voucher.minPurchase).toFixed(2)} of supplements`);
        voucherDiscount = round2(voucher.kind === 'PERCENT' ? base.mul(D(voucher.value)).div(100) : D(voucher.value)); if (voucherDiscount.gt(base)) voucherDiscount = base;
        let left = voucherDiscount;
        voucherLines.forEach((r, i) => {
          const a = D(r.amount as string); const share = i === voucherLines.length - 1 ? left : round2(voucherDiscount.mul(a).div(base)); left = left.minus(share);
          const na = a.minus(share); r.amount = na.toFixed(2); r.unitPrice = round2(na.div(r.qty as number)).toFixed(2);
        });
        productTotal = productTotal.minus(voucherDiscount);
      }
      const deliveryFee = D(input.deliveryFee ?? 0), shippingFee = D(input.shippingFee ?? 0);
      const grandTotal = round2(productTotal.plus(deliveryFee).plus(shippingFee));
      // credit card: what the terminal really charged when it is not the total (surcharge / rounding); a reason is needed (owner request 2026-10-23)
      let cardAmount: ReturnType<typeof D> | null = null;
      if (input.paymentMode === 'CREDIT_CARD' && input.cardAmount != null) {
        const typed = round2(D(input.cardAmount));
        if (typed.lte(0)) throw new BadRequestException('The amount charged on the card must be more than zero');
        if (!typed.equals(grandTotal)) { if (!input.cardAdjustReason?.trim()) throw new BadRequestException({ message: `The card was charged ${typed.toFixed(2)} but the total is ${grandTotal.toFixed(2)}: type the reason`, code: 'CARD_REASON' }); cardAmount = typed; }
      }
      const created = await tx.salesDoc.create({
        data: {
          controlNo, docDate, locationId, channel: input.channel, channelSub: input.channelSub ?? null, customerId: input.customerId ?? null, agentId: input.agentId ?? null, outletId: input.outletId ?? null, memberId: input.memberId ?? null, voucherId: voucher?.id ?? null, voucherDiscount: voucherDiscount.toFixed(2), riderId: input.riderId ?? null, customerName: input.customerName ?? null, customerPhone: input.customerPhone || null, customerEmail: input.customerEmail || null, drSiNo: input.drSiNo.trim(),
          paymentMode: input.paymentMode, paymentAccountId: input.paymentAccountId ?? null, proofOfPaymentAttachmentId: input.proofOfPaymentAttachmentId ?? null, cardMid: input.cardMid, cardSlipNo: input.cardSlipNo, cardApprovalCode: input.cardApprovalCode, cardBatchNo: input.cardBatchNo, cardAmount: cardAmount != null ? cardAmount.toFixed(2) : null, cardAdjustReason: cardAmount != null ? input.cardAdjustReason?.trim() || null : null,
          deliveryFee: deliveryFee.toFixed(2), riderIncentive: D(input.riderIncentive ?? 0).toFixed(2), shippingFee: shippingFee.toFixed(2), shippingExpense: D(input.shippingExpense ?? 0).toFixed(2), marketplaceCharges: D(input.marketplaceCharges ?? 0).toFixed(2),
          productTotal: productTotal.toFixed(2), grandTotal: grandTotal.toFixed(2), amountPaid: input.paymentMode === 'AR_PDC' ? '0.00' : (cardAmount ?? grandTotal).toFixed(2),
          dueDate: input.dueDate ? toDateOnly(input.dueDate) : null, pdcBank: input.pdcBank, pdcChequeNo: input.pdcChequeNo, pdcDate: input.pdcDate ? toDateOnly(input.pdcDate) : null, notes: input.notes,
          preparedBy: user.id, createdBy: user.id, specialPriceStatus: special ? 'PENDING' : null, status: 'POSTED',
          lines: { create: lineRows },
        }, include: this.include,
      });
      if (voucher) { const claim = await tx.memberVoucher.updateMany({ where: { id: voucher.id, usedAt: null }, data: { usedAt: new Date(), usedSaleId: created.id, discountApplied: voucherDiscount.toFixed(2) } }); if (!claim.count) throw new BadRequestException(`The voucher ${voucher.code} was just used`); }
      // 6-Pack Card: one sticker per supplement on the DR, with the customer tagged (owner request 2026-09-30)
      if (input.sixPackSticker) await this.sixPack.issue(tx, { saleId: created.id, locationId, docDate, name: input.customerName, phone: input.customerPhone, email: input.customerEmail, supplementUnits, userId: user.id });
      if (incentive) {
        if (D(incentive.amount).gt(grandTotal)) throw new BadRequestException('The incentive cannot be more than the sale');
        const ex = await this.expenses.saleIncentive(tx, { locationId, docDate, kind: incentive.kind, payee: incentive.payee, amount: incentive.amount, drSiNo: created.drSiNo, userId: user.id });
        await tx.salesDoc.update({ where: { id: created.id }, data: { incentiveAmount: D(incentive.amount).toFixed(2), incentivePayee: incentive.payee, incentiveExpenseId: ex.id } });
      }
      // ledger rows were keyed by controlNo before the doc existed; point them at the doc id
      await tx.stockLedger.updateMany({ where: { documentType: 'SalesDoc', documentId: controlNo }, data: { documentId: created.id } });
      // journal R3/R4 + R5
      if (cardAmount && (await this.posting.enabled())) await this.accounts.ensureGlobal('OTHER_INCOME_CARD_ADJUSTMENT', user.id, tx);
      const counterparty = created.customer ? { type: created.customer.type, id: created.customer.id, locationId: null } : created.agent ? { type: 'AGENT', id: created.agent.id } : null;
      await this.posting.post(tx, { type: 'SalesDoc', id: created.id, date: docDate, name: created.customer?.name ?? created.customerName, createdBy: user.id }, (r) => r3r4Sale(r, {
        locationId, channel: created.channel, channelSub: created.channelSub, paymentMode: created.paymentMode, paymentAccountId: created.paymentAccountId, counterparty, drSiNo: created.drSiNo,
        productTotal: created.productTotal, deliveryFee: created.deliveryFee, shippingFee: created.shippingFee, grandTotal: created.grandTotal, cardAmount: created.cardAmount,
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
    // re-order reminder for items with a known consumption period (best effort: never blocks the sale)
    await this.followUps.createForSale(doc.id).catch(() => 0);
    if (input.outletId) await this.agentMonitor.onSaleTagged(input.outletId).catch(() => undefined);
    // a referred member's first purchase gives both a voucher (best effort: never blocks the sale)
    if (input.memberId) await this.loyalty.onFirstPurchase(input.memberId).catch(() => undefined);
    // shipping charged to the franchise: "to follow" for the Franchise Coordinator, or typed now; either way its own receivable, separate from the order
    if (ship) await this.franchiseShipping.createForSale({ id: doc.id, controlNo: doc.controlNo, drSiNo: doc.drSiNo, locationId }, franchiseCustomer!.locationId!, { mode: ship.mode as 'TO_FOLLOW' | 'AMOUNT', amount: ship.amount, courier: ship.courier, reference: ship.reference }, user);
    // a DR for a franchise (owner request 2026-10-15): the franchise is told and confirms receipt; a corrected DR replaces the old one
    if (franchiseCustomer?.locationId && loc.type !== 'FRANCHISE' && input.channel === 'FRANCHISE') {
      const brief = { id: doc.id, drSiNo: doc.drSiNo, locationId, grandTotal: doc.grandTotal, paymentMode: doc.paymentMode, dueDate: doc.dueDate };
      if (opts.amendedFrom) await this.franchiseDr.onAmended(opts.amendedFrom, brief, franchiseCustomer.locationId, user); else await this.franchiseDr.onSale(brief, franchiseCustomer.locationId, user);
    }
    return this.get(doc.id, user);
  }

  /**
   * Correct a franchise DR that has a mistake or changed (owner request 2026-10-15): the Franchise Coordinators replace its items, prices, due date or notes while the franchise has not yet received it.
   * The corrected DR keeps the DR number and date; the old one is voided (stock and journal reversed), its shipping charge moves over, the franchise is told and checks it again.
   */
  async amendFranchiseDr(id: string, input: AmendInput, user: SessionUser) {
    if (!user.permissions.has('franchise.dr.edit')) throw new ForbiddenException('Only the Franchise Coordinators edit a franchise DR');
    return this.amendCore(id, input, user, { franchiseOnly: true, skipClosedCheck: true });
  }

  /**
   * Edit a sale / DR until its day closes (owner request 2026-10-16): the DR keeps its number and date; the old document is voided and the corrected one is made, so stock, journal, AR and proofs follow.
   * The day is open until the branch submits its Daily Sales Report (and never after midnight): after that, a post-close edit request is needed.
   */
  async amendSale(id: string, input: AmendInput, user: SessionUser) {
    if (!user.permissions.has('sale.edit.sameday')) throw new ForbiddenException('You may not edit sales');
    return this.amendCore(id, input, user, { franchiseOnly: false, skipClosedCheck: false });
  }

  private async amendCore(id: string, input: AmendInput, user: SessionUser, o: { franchiseOnly: boolean; skipClosedCheck: boolean }) {
    const old = await requestContext.runSystem(async () => await this.get(id, user));
    if (user.locationScoped && !user.locationIds.includes(old.locationId) && !(o.franchiseOnly && user.permissions.has('franchise.dr.edit'))) throw new ForbiddenException('Outside your branch');
    if (old.voidedAt) throw new BadRequestException('This DR was voided');
    if (o.franchiseOnly && (old.channel !== 'FRANCHISE' || !old.customerId)) throw new BadRequestException('Only a DR made for a franchise is edited here');
    if (old.channelSub === 'CONSIGNMENT') throw new BadRequestException('A consignment sale is changed from its consignment report');
    if (D(old.amountPaid).gt(0) && old.paymentMode === 'AR_PDC') throw new BadRequestException('A payment has been recorded on this DR; void the payment first');
    if (!o.skipClosedCheck && (await this.closing.isClosed(old.locationId, old.docDate))) throw new BadRequestException({ message: 'This business day is closed; submit a post-close edit request instead', code: 'DAY_CLOSED' });
    if (!input.lines.length) throw new BadRequestException('At least one item');
    if (old.channel === 'FRANCHISE' && old.customerId) await this.franchiseDr.assertEditable(id);
    if (old.voucherId) throw new BadRequestException('A member voucher was used on this sale; void it and record it again');
    const drSiNo = input.drSiNo?.trim() || old.drSiNo;
    const base: SalesInput = { locationId: old.locationId, docDate: dateStr(old.docDate), channel: old.channel, channelSub: old.channelSub, customerId: old.customerId, agentId: old.agentId, riderId: old.riderId, customerName: old.customerName ?? undefined, drSiNo: old.drSiNo, paymentMode: old.paymentMode, paymentAccountId: old.paymentAccountId, proofOfPaymentAttachmentId: old.proofOfPaymentAttachmentId, deliveryFee: Number(old.deliveryFee), shippingFee: Number(old.shippingFee), pdcBank: old.pdcBank ?? undefined, pdcChequeNo: old.pdcChequeNo ?? undefined, pdcDate: old.pdcDate ? dateStr(old.pdcDate) : null, dueDate: old.dueDate ? dateStr(old.dueDate) : null, notes: old.notes ?? undefined, lines: [],
      // what the sale already carries stays as it was
      outletId: old.outletId, memberId: old.memberId, customerPhone: old.customerPhone, customerEmail: old.customerEmail, cardAmount: old.cardAmount != null ? Number(old.cardAmount) : undefined, cardAdjustReason: old.cardAdjustReason ?? undefined, cardMid: old.cardMid ?? undefined, cardSlipNo: old.cardSlipNo ?? undefined, cardApprovalCode: old.cardApprovalCode ?? undefined, cardBatchNo: old.cardBatchNo ?? undefined,
      shippingExpense: Number(old.shippingExpense), marketplaceCharges: Number(old.marketplaceCharges), riderIncentive: Number(old.riderIncentive), sixPackSticker: old.sixPackStickers > 0,
      incentive: D(old.incentiveAmount).gt(0) ? { amount: Number(old.incentiveAmount), payee: old.incentivePayee ?? '' } : null };
    const restore: SalesInput = { ...base, lines: old.lines.filter((l) => l.qty > 0).map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: Number(l.unitPrice), batchId: l.batchId, exactBatch: true, isFreebie: l.isFreebie, priceTier: l.priceTier })) };
    const oldTotal = D(old.grandTotal);
    // free the DR number for the corrected DR, then void the old one; if the corrected one cannot be saved the original is put back
    await this.prisma.db.salesDoc.update({ where: { id }, data: { drSiNo: `${old.drSiNo}~V${Date.now().toString(36)}` } });
    const putBack = async () => { await this.prisma.db.salesDoc.update({ where: { id }, data: { drSiNo: old.drSiNo } }).catch(() => undefined); };
    try { await this.void(id, `Corrected by ${user.fullName}`, user, { skipClosedCheck: true }); } catch (e) { await putBack(); throw e; }
    let created;
    try {
      created = await this.create({ ...base, drSiNo, customerName: input.customerName === undefined ? base.customerName : input.customerName ?? undefined, notes: input.notes === undefined ? base.notes : input.notes ?? undefined, dueDate: input.dueDate === undefined ? base.dueDate : input.dueDate, lines: input.lines }, user, { skipClosedCheck: true, amendedFrom: id });
    } catch (e) {
      try { await this.create(restore, user, { skipClosedCheck: true, amendedFrom: id }); } catch { /* the original could not be put back either: the voided DR stays for the auditors */ }
      throw e;
    }
    if (old.channel === 'FRANCHISE') await this.prisma.db.franchiseShippingCharge.updateMany({ where: { salesDocId: id }, data: { salesDocId: created.id } });
    await this.audit.log({ action: o.franchiseOnly ? 'FRANCHISE_DR_AMENDED' : 'SALE_AMENDED', entityType: 'SalesDoc', entityId: created.id, before: { id, total: oldTotal.toFixed(2) }, after: { total: D(created.grandTotal).toFixed(2) } });
    return created;
  }

  /** The price that applies by itself for an item (a member price or a running promo), when it is lower than the list price. The lowest wins. */
  private autoPriceFor(productId: string, tier: string, tierPrice: Prisma.Decimal, ctx: { offers: Map<string, Prisma.Decimal>; branchPromo: Map<string, Prisma.Decimal>; franchisePromo: Map<string, Prisma.Decimal>; franchiseLoc: boolean }): { price: Prisma.Decimal; source: 'MEMBER' | 'PROMO' } | null {
    let best: { price: Prisma.Decimal; source: 'MEMBER' | 'PROMO' } | null = null;
    if ((tier === 'RETAIL' || tier === 'CC') && ctx.offers.has(productId)) { const o = D(ctx.offers.get(productId)!); if (o.lt(tierPrice)) best = { price: o, source: 'MEMBER' }; }
    const promo = tier === 'RETAIL' && !ctx.franchiseLoc ? ctx.branchPromo.get(productId) : tier === 'FRANCHISE' ? ctx.franchisePromo.get(productId) : undefined;
    if (promo && D(promo).lt(best?.price ?? tierPrice)) best = { price: D(promo), source: 'PROMO' };
    return best;
  }

  /** For New Sale: the member / promo price of each item, so the price box is filled in by itself (and can still be changed). */
  async autoPrices(user: SessionUser, i: { locationId?: string; tier: string; memberId?: string | null; productIds: string[]; docDate?: string }) {
    const locationId = i.locationId ?? user.locationIds[0]; if (!locationId || franchiseUserOf(user)) return {};
    if (user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException('Outside your branch');
    if (!user.permissions.has(`price.view.${i.tier}`)) return {};
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: locationId }, select: { type: true } });
    const date = i.docDate ? toDateOnly(i.docDate) : todayManila();
    const ctx = { offers: i.memberId ? await this.loyalty.offerPrices(date) : new Map<string, Prisma.Decimal>(), branchPromo: await this.promos.activePrices(date, 'BRANCHES'), franchisePromo: await this.promos.activePrices(date, 'FRANCHISES'), franchiseLoc: loc.type === 'FRANCHISE' };
    const out: Record<string, { price: number; listPrice: number; source: 'MEMBER' | 'PROMO' | null; promoRunning: boolean }> = {};
    const promoMap = i.tier === 'RETAIL' && !ctx.franchiseLoc ? ctx.branchPromo : i.tier === 'FRANCHISE' ? ctx.franchisePromo : new Map<string, Prisma.Decimal>();
    for (const pid of [...new Set(i.productIds)].slice(0, 100)) {
      const lp = await this.master.priceFor(pid, i.tier, date); if (lp == null) continue;
      const a = this.autoPriceFor(pid, i.tier, D(lp), ctx); const running = promoMap.has(pid);
      if (a || running) out[pid] = { price: Number(a?.price ?? lp), listPrice: Number(lp), source: a?.source ?? null, promoRunning: running };
    }
    return out;
  }

  private validatePayment(input: SalesInput) {
    if ((input.paymentMode === 'ONLINE' || input.paymentMode === 'CREDIT_CARD') && !input.paymentAccountId) throw new BadRequestException('payment account is required for ONLINE / CREDIT_CARD');
    if ((input.paymentMode === 'ONLINE' || input.paymentMode === 'CREDIT_CARD') && !input.proofOfPaymentAttachmentId) throw new BadRequestException({ message: 'Proof of payment upload is required for ONLINE / CREDIT_CARD', code: 'PROOF_REQUIRED' });
    if (input.paymentMode === 'CREDIT_CARD' && !(input.cardMid && input.cardSlipNo && input.cardApprovalCode && input.cardBatchNo)) throw new BadRequestException('Credit card sales need MID, slip no., approval code and batch no.');
    if (input.paymentMode === 'AR_PDC') { if (!input.customerId && !input.agentId) throw new BadRequestException('AR/PDC requires a customer or agent'); if ((input.pdcBank || input.pdcChequeNo || input.pdcDate) && !(input.pdcChequeNo && input.pdcDate)) throw new BadRequestException('With a PDC, type the cheque number and the cheque date'); if (!input.dueDate) throw new BadRequestException('AR/PDC requires a due date'); if (input.pdcChequeNo && !input.proofOfPaymentAttachmentId) throw new BadRequestException({ message: 'Upload a photo of the cheque: a sale with a post-dated cheque cannot be saved without it', code: 'PROOF_REQUIRED' }); }
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
  /**
   * Accounting (or the Head Auditor) corrects the amount really charged on the card after the sale was saved (owner request 2026-10-23).
   * The sale entry is reversed and posted again with the new amount; the difference from the total sits in Other Income - Card Surcharge / Rounding.
   * Not possible once the sale has been cleared by a card remittance (correct it there).
   */
  async correctCardAmount(id: string, amount: number, reason: string, user: SessionUser) {
    const doc = await requestContext.runSystem(async () => await this.get(id, user));
    if (doc.voidedAt) throw new BadRequestException('This sale was voided');
    if (doc.paymentMode !== 'CREDIT_CARD') throw new BadRequestException('Only a credit card sale has a card amount');
    if (doc.cardRemittanceId) throw new BadRequestException('This card sale is already cleared by a card remittance: correct it in the remittance');
    if (!reason.trim()) throw new BadRequestException('Type the reason');
    const typed = round2(D(amount)); if (typed.lte(0)) throw new BadRequestException('The amount must be more than zero');
    const total = D(doc.grandTotal); const nextCard = typed.equals(total) ? null : typed;
    const before = { cardAmount: doc.cardAmount, reason: doc.cardAdjustReason };
    await this.posting.assertPeriodOpen(null, doc.docDate);
    await requestContext.runSystem(async () => {
      await this.prisma.db.$transaction(async (tx) => {
        await tx.salesDoc.update({ where: { id }, data: { cardAmount: nextCard ? nextCard.toFixed(2) : null, cardAdjustReason: nextCard ? reason.trim() : null, amountPaid: (nextCard ?? total).toFixed(2) } });
        const all = await tx.journalVoucher.findMany({ where: { sourceDocumentType: 'SalesDoc', sourceDocumentId: id, rule: 'R3', isReversal: false, voidedAt: null }, include: { lines: true } });
        const reversed = new Set((await tx.journalVoucher.findMany({ where: { reversesVoucherId: { in: all.map((v) => v.id) } }, select: { reversesVoucherId: true } })).map((v) => v.reversesVoucherId));
        for (const v of all.filter((x) => !reversed.has(x.id))) {
          const voucherNo = await this.posting.nextVoucherNo(tx, 'M', doc.docDate.getUTCFullYear());
          await tx.journalVoucher.create({ data: { voucherNo, date: doc.docDate, book: v.book, reference: v.reference, remarks: `Reversal of ${v.voucherNo}: card amount corrected (${reason.trim()})`, name: v.name, isReversal: true, reversesVoucherId: v.id, sourceDocumentType: 'SalesDoc', sourceDocumentId: id, rule: 'R3', createdBy: user.id, lines: { create: v.lines.map((l, i) => ({ lineNo: i + 1, accountId: l.accountId, debit: l.credit, credit: l.debit, memo: l.memo })) } } });
        }
        if (nextCard && (await this.posting.enabled())) await this.accounts.ensureGlobal('OTHER_INCOME_CARD_ADJUSTMENT', user.id, tx);
        const counterparty = doc.customer ? { type: doc.customer.type, id: doc.customer.id, locationId: null } : doc.agent ? { type: 'AGENT', id: doc.agent.id } : null;
        if (all.length) await this.posting.post(tx, { type: 'SalesDoc', id, date: doc.docDate, name: doc.customer?.name ?? doc.customerName, createdBy: user.id }, (r) => r3r4Sale(r, { locationId: doc.locationId, channel: doc.channel, channelSub: doc.channelSub, paymentMode: doc.paymentMode, paymentAccountId: doc.paymentAccountId, counterparty, drSiNo: doc.drSiNo, productTotal: doc.productTotal, deliveryFee: doc.deliveryFee, shippingFee: doc.shippingFee, grandTotal: doc.grandTotal, cardAmount: nextCard ? nextCard.toFixed(2) : null, costLines: [] }));
      });
    });
    await this.audit.log({ action: 'CARD_AMOUNT_CORRECTED', entityType: 'SalesDoc', entityId: id, before, after: { cardAmount: nextCard?.toFixed(2) ?? null, total: total.toFixed(2), reason: reason.trim() } });
    await this.notify.toLocation(doc.locationId, { type: 'CARD_AMOUNT_CORRECTED', title: `Card amount of ${doc.drSiNo} corrected to ${typed.toFixed(2)} by ${user.fullName}`, body: reason.trim(), link: '/sales' }).catch(() => undefined);
    return this.get(id, user);
  }

  async void(id: string, reason: string, user: SessionUser, opts: { skipClosedCheck?: boolean } = {}) {
    const doc = await this.get(id, user);
    if (doc.voidedAt) throw new BadRequestException('Already voided');
    if (!opts.skipClosedCheck && (await this.closing.isClosed(doc.locationId, doc.docDate)) && !user.permissions.has('sale.edit.postclose')) throw new BadRequestException({ message: 'Day is closed; request a post-close edit', code: 'DAY_CLOSED' });
    if (doc.amountPaid.gt(0) && doc.paymentMode === 'AR_PDC') throw new BadRequestException('Void payments first');
    await this.posting.assertPeriodOpen(null, doc.docDate);
    await this.prisma.db.$transaction(async (tx) => {
      await this.stock.post(tx, doc.lines.map((l) => ({ locationId: doc.locationId, productId: l.productId, batchId: l.batchId, qtyDelta: l.qty, movementType: 'SALE_RETURN' as const, documentType: 'SalesDoc', documentId: doc.id, unitCost: l.unitCost, createdBy: user.id })));
      await tx.salesDoc.update({ where: { id }, data: { status: 'VOIDED', voidedAt: new Date(), voidedBy: user.id, voidReason: reason } });
      await this.sixPack.voidForSale(tx, doc.id);
      await tx.memberVoucher.updateMany({ where: { usedSaleId: doc.id }, data: { usedAt: null, usedSaleId: null, discountApplied: null } });
      // the incentive paid from this sale is voided with it
      if (doc.incentiveExpenseId) { const ex = await tx.expenseDoc.findUnique({ where: { id: doc.incentiveExpenseId } }); if (ex && !ex.voidedAt) await this.expenses.voidInTx(tx, ex, `Sale ${doc.drSiNo} voided: ${reason}`, user.id); }
      // reverse journal
      const vouchers = await tx.journalVoucher.findMany({ where: { sourceDocumentType: 'SalesDoc', sourceDocumentId: id, voidedAt: null }, include: { lines: true } });
      for (const v of vouchers) await this.posting.persist(tx, { rule: v.rule ?? 'REV', book: v.book, remarks: `Reversal of ${v.voucherNo}: ${reason}`, lines: v.lines.map((l) => ({ accountId: l.accountId, debit: D(l.credit), credit: D(l.debit) })) }, { type: 'SalesDoc', id, date: todayManila(), createdBy: user.id });
    });
    await this.approvals.cancelForDocument('SalesDoc', id);
    await this.followUps.dismissForSale(id);
    await this.audit.log({ action: 'VOID', entityType: 'SalesDoc', entityId: id, before: doc, after: { reason } });
    return this.get(id, user);
  }

  // ── AR / payments / credit notes (§8.3) ──
  async arList(user: SessionUser, q: { locationId?: string; customerId?: string; overdueOnly?: boolean }) {
    const where: Prisma.SalesDocWhereInput = { paymentMode: 'AR_PDC', voidedAt: null, locationId: this.scope.locationFilter(user, q.locationId) as never, customerId: q.customerId };
    const docs = await this.prisma.db.salesDoc.findMany({ where, include: { customer: true, agent: true, location: { select: { id: true, code: true, name: true, type: true } } }, orderBy: { dueDate: 'asc' } });
    const today = todayManila();
    return docs.map((d) => ({ id: d.id, location: d.location, customer: d.customer?.name ?? d.agent?.name ?? d.customerName, customerId: d.customerId, agentId: d.agentId, drSiNo: d.drSiNo, docDate: dateStr(d.docDate), amount: d.grandTotal, paid: d.amountPaid, balance: d.grandTotal.minus(d.amountPaid), dueDate: d.dueDate ? dateStr(d.dueDate) : null, daysOverdue: d.dueDate && d.grandTotal.gt(d.amountPaid) ? Math.max(0, daysBetween(d.dueDate, today)) : 0, pdc: d.pdcChequeNo ? { bank: d.pdcBank, chequeNo: d.pdcChequeNo, date: d.pdcDate } : null }))
      .filter((r) => r.balance.gt(0) && (!q.overdueOnly || r.daysOverdue > 0));
  }

  /** Everything Accounting needs to approve a branch's AR payment in one look: proof, account deposited to, invoices (owner request 2026-09-29). */
  async paymentReview(id: string) {
    return requestContext.runSystem(async () => {
      const p = await this.prisma.db.payment.findUnique({ where: { id }, include: { paymentAccount: { select: { code: true, title: true } }, customer: { select: { name: true, type: true } }, allocations: { include: { salesDoc: { select: { id: true, drSiNo: true, docDate: true, dueDate: true, grandTotal: true, amountPaid: true, pdcChequeNo: true, customerName: true, agent: { select: { name: true } } } } } } } });
      if (!p) throw new NotFoundException();
      const docs = await this.prisma.db.salesDoc.findMany({ where: { id: { in: p.requestedSalesDocIds } }, select: { id: true, drSiNo: true, docDate: true, dueDate: true, grandTotal: true, amountPaid: true, pdcChequeNo: true, customerName: true, customer: { select: { name: true } }, agent: { select: { name: true } } } });
      const proof = p.proofAttachmentId ? await this.prisma.db.attachment.findUnique({ where: { id: p.proofAttachmentId }, select: { id: true, fileName: true, contentType: true } }) : null;
      const loc = p.locationId ? await this.prisma.db.location.findUnique({ where: { id: p.locationId }, select: { name: true } }) : null;
      const by = p.createdBy ? await this.prisma.db.user.findUnique({ where: { id: p.createdBy }, select: { fullName: true } }) : null;
      return {
        id: p.id, creditNoteNo: p.creditNoteNo, status: p.status, amount: p.amount, discount: p.discount, paymentMode: p.paymentMode, receivedAt: p.receivedAt, notes: p.notes,
        account: p.paymentAccount, branch: loc?.name ?? null, enteredBy: by?.fullName ?? null, customer: p.customer?.name ?? docs[0]?.customer?.name ?? docs[0]?.agent?.name ?? docs[0]?.customerName ?? null, proof,
        invoices: (docs.length ? docs : p.allocations.map((a) => a.salesDoc)).map((d) => ({ id: d.id, drSiNo: d.drSiNo, date: dateStr(d.docDate), dueDate: d.dueDate ? dateStr(d.dueDate) : null, total: d.grandTotal, balance: d.grandTotal.minus(d.amountPaid), pdcChequeNo: d.pdcChequeNo })),
      };
    });
  }

  /**
   * AR collection (owner request 2026-09-26). Accounting (ar.approve) records a payment and it applies at once; the branch is notified.
   * Anyone else (a sales associate, any day) records it as PENDING: Accounting Associate or Head approves before the invoices are
   * credited. Franchise AR stays with the franchise and applies at once.
   */
  async recordPayment(input: { salesDocIds: string[]; amount: number; discount?: number; paymentMode: PaymentMode; paymentAccountId?: string | null; proofAttachmentId?: string | null; receivedAt?: string; notes?: string }, user: SessionUser) {
    if (!input.salesDocIds.length) throw new BadRequestException('Pick at least one invoice');
    if (input.paymentMode !== 'CASH' && !input.paymentAccountId) throw new BadRequestException(input.paymentMode === 'AR_PDC' ? 'Cheque collections need the bank account the cheque is deposited to' : 'Online/card collections need a payment account');
    if (input.paymentMode !== 'CASH' && !input.proofAttachmentId) throw new BadRequestException({ message: input.paymentMode === 'AR_PDC' ? 'Upload a photo of the cheque (and its deposit slip when you have it): a cheque collection cannot be saved without it' : 'Upload the proof of payment (screenshot or slip): online and card collections cannot be saved without it', code: 'PROOF_REQUIRED' });
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
  private async onPaymentDecision(paymentId: string, outcome: 'APPROVED' | 'REJECTED', actorId: string | null, note?: string) {
    await requestContext.runSystem(async () => {
      const p = await this.prisma.db.payment.findUniqueOrThrow({ where: { id: paymentId } });
      if (p.status !== 'PENDING') return;
      if (outcome === 'REJECTED') { await this.prisma.db.payment.update({ where: { id: paymentId }, data: { status: 'REJECTED' } }); }
      else {
        const docs = await this.openInvoices(p.requestedSalesDocIds, null);
        await this.prisma.db.$transaction(async (tx) => { await this.applyPayment(tx, p, docs, actorId); await tx.payment.update({ where: { id: paymentId }, data: { status: 'POSTED' } }); });
      }
      if (p.locationId) await this.notify.toLocation(p.locationId, { type: 'AR_PAYMENT_DECIDED', title: `AR payment ${p.creditNoteNo} (₱${p.amount}) ${outcome === 'APPROVED' ? 'approved and applied' : 'rejected'} by Accounting`, body: outcome === 'REJECTED' && note ? `Reason: ${note}. Check it, then record the payment again.` : undefined, link: '/ar' });
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

  /**
   * Daily AR reminder (owner request 2026-09-29): every branch's open receivables that are overdue or due within 7 days, listed by
   * due date with the nearest first, to the branch staff and the sales associate who made each sale, the auditors and the Owner.
   */
  async notifyOverdue() {
    const today = todayManila();
    const soon = addDays(today, 7);
    const rows = await this.prisma.db.salesDoc.findMany({ where: { paymentMode: 'AR_PDC', voidedAt: null, dueDate: { lte: soon } }, include: { customer: true, agent: true, location: true }, orderBy: { dueDate: 'asc' } });
    const open = rows.filter((d) => d.grandTotal.gt(d.amountPaid));
    const byLoc = new Map<string, typeof open>();
    for (const d of open) byLoc.set(d.locationId, [...(byLoc.get(d.locationId) ?? []), d]);
    let sent = 0;
    for (const [locationId, docs] of byLoc) {
      const state = await this.prisma.db.alertState.findUnique({ where: { kind_refKey: { kind: 'AR_OVERDUE', refKey: locationId } } });
      if (state && daysBetween(state.lastSentAt, new Date()) < 1) continue;
      const total = sum(docs.map((d) => d.grandTotal.minus(d.amountPaid)));
      const overdue = docs.filter((d) => d.dueDate! < today).length;
      const line = (d: (typeof docs)[number]) => { const days = daysBetween(today, d.dueDate!); return `${dateStr(d.dueDate!)} (${days < 0 ? `${-days}d overdue` : days === 0 ? 'today' : `in ${days}d`}) ${d.customer?.name ?? d.agent?.name ?? d.customerName ?? ''} DR ${d.drSiNo} ₱${d.grandTotal.minus(d.amountPaid).toFixed(2)}${d.pdcChequeNo ? ' PDC' : ''}`; };
      const n = { type: 'AR_OVERDUE', title: `AR at ${docs[0].location.name}: ${docs.length} due${overdue ? ` (${overdue} overdue)` : ' within 7 days'} — ₱${total.toFixed(2)}`, body: docs.slice(0, 10).map(line).join('\n') + (docs.length > 10 ? `\n… and ${docs.length - 10} more` : ''), link: `/ar?locationId=${locationId}` };
      await this.notify.toLocation(locationId, n, ['HEAD_AUDITOR', 'ASST_AUDITOR', 'AUDIT_ASSOCIATE', 'ADMIN']);
      // the sales associates who made these sales, if they are not (or no longer) at this branch
      const makers = [...new Set(docs.map((d) => d.preparedBy))];
      const atBranch = new Set((await this.prisma.db.userLocationAssignment.findMany({ where: { locationId }, select: { userId: true } })).map((a) => a.userId));
      const others = makers.filter((m) => !atBranch.has(m));
      if (others.length) await this.notify.toUsers(others, n);
      await this.prisma.db.alertState.upsert({ where: { kind_refKey: { kind: 'AR_OVERDUE', refKey: locationId } }, create: { kind: 'AR_OVERDUE', refKey: locationId, lastSentAt: new Date() }, update: { lastSentAt: new Date() } });
      sent++;
    }
    return { locations: sent, invoices: open.length };
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
      // consignee AR is company-wide (not a branch's sales), so it is read outside the branch scope
      const ar = await requestContext.runSystem(async () => await this.prisma.db.salesDoc.aggregate({ where: { customer: { locationId: c.id }, voidedAt: null }, _sum: { grandTotal: true, amountPaid: true } }));
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
