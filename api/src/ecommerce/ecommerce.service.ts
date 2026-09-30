import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { AccountClass, Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService, Tx } from '../common/prisma.service';
import { SequenceService } from '../common/sequence.service';
import { StockService } from '../stock/stock.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../common/audit.service';
import { SettingsService } from '../common/settings.service';
import { MasterService } from '../master/master.service';
import { TransfersService } from '../transfers/transfers.service';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { assertBalanced, consolidate, type Entry, type Line } from '../gl/posting-rules';
import { directCostTemplateFor, inventoryTemplateFor } from '../gl/account-templates';
import { XlsxService } from '../reports/xlsx.service';
import { dateStr, todayManila, toDateOnly, daysBetween } from '../common/manila';
import { D, round2 } from '../common/money';
import type { SessionUser } from '../common/request-context';
import { requestContext } from '../common/request-context';
import {
  AMOUNT_KEYS, type Amounts, isPlatform, parseAds, parseOrders, parseSettlement, type Platform, PLATFORMS, PLATFORM_INFO, readSheets, TEMPLATES, zeroAmounts,
} from './ecom-files';

type Kind = 'SALE' | 'MONEY_ONLY' | 'NOT_SHIPPED' | 'ALREADY_SETTLED' | 'UNKNOWN';
interface DetailRow { orderId: string; ecomOrderId: string | null; kind: Kind; included: boolean; amounts: Amounts; trackingNo?: string | null }
interface ReturnLine { productId: string; name?: string; qty: number; goodQty?: number; damagedQty?: number }

/** The e-commerce accounts, one set per platform, created the first time they are needed. */
const ACCOUNT_DEFS = (p: Platform) => {
  const n = PLATFORM_INFO[p].name.replace(' Shop', '');
  return {
    sales: { title: `Sales - E-commerce ${n}`, class: 'REVENUE' as AccountClass },
    sellerDiscounts: { title: `Seller Discounts & Vouchers - ${n}`, class: 'REVENUE' as AccountClass },
    refunds: { title: `Sales Returns & Refunds - ${n}`, class: 'REVENUE' as AccountClass },
    commission: { title: `Commission Fee - ${n}`, class: 'OPEX' as AccountClass },
    transactionFee: { title: `Transaction / Payment Fee - ${n}`, class: 'OPEX' as AccountClass },
    shippingFee: { title: `Shipping Fee - ${n}`, class: 'OPEX' as AccountClass },
    affiliateFee: { title: `Affiliate Commission - ${n}`, class: 'OPEX' as AccountClass },
    otherFees: { title: `Other Platform Fees & Adjustments - ${n}`, class: 'OPEX' as AccountClass },
    ads: { title: `Advertising - ${PLATFORM_INFO[p].ads}`, class: 'OPEX' as AccountClass },
    withholdingTax: { title: 'Creditable Withholding Tax (E-commerce)', class: 'ADVANCES_TO' as AccountClass },
  };
};
const PLATFORM_CASH: Record<Platform, { code: string; title: string }> = {
  TIKTOK: { code: '1091', title: 'Cash - Tiktok - Getwheysted (Platform)' },
  SHOPEE: { code: '1080', title: 'Cash - Shopee GWS 1 (Platform)' },
  LAZADA: { code: '1085', title: 'Cash - Lazada GWS (Platform)' },
};

/**
 * E-commerce arm (owner request 2026-09-28): TikTok Shop, Shopee and Lazada, each kept separate.
 * - No separate e-commerce stock: the uploaded order / waybill file drafts a Warehouse pull-out; the Warehouse In-Charge is the only
 *   approver; the goods then sit in the platform's "with courier" holding place until the platform pays or the parcel comes back.
 * - The platform's settlement (payout) file records the sale, every fee, refunds, withholding tax and the payout; Accounting approves it.
 * - Returns come back through the In-Charge (good → Warehouse stock, damaged → write-off for the Head Auditor). Ads are an expense.
 */
@Injectable()
export class EcommerceService implements OnModuleInit {
  constructor(
    private prisma: PrismaService, private seq: SequenceService, private stock: StockService, private approvals: ApprovalsService, private notify: NotificationsService,
    private audit: AuditService, private settings: SettingsService, private master: MasterService, private transfers: TransfersService, private posting: PostingService,
    private accounts: AccountsService, private xlsx: XlsxService,
  ) {}

  onModuleInit() {
    this.transfers.onEcomPulloutDecided((docId, outcome) => this.onPulloutDecided(docId, outcome));
    this.approvals.register('ECOM_SETTLEMENT', (req, outcome, actor) => this.onSettlementDecision(req.documentId, outcome, actor?.id ?? null), 'EcomSettlement');
  }

  platform(p: string): Platform { const u = p.toUpperCase(); if (!isPlatform(u)) throw new BadRequestException('Platform must be TikTok, Shopee or Lazada'); return u; }

  /** The platform's "with courier" holding place (created on first use). */
  async platformLocation(p: Platform, tx: Tx | null = null) {
    const db = (tx ?? this.prisma.db) as Tx;
    const info = PLATFORM_INFO[p];
    return (await db.location.findUnique({ where: { code: info.locationCode } })) ?? db.location.create({ data: { code: info.locationCode, name: info.locationName, type: 'VIRTUAL' } });
  }
  warehouses() { return this.prisma.db.location.findMany({ where: { type: 'WAREHOUSE', active: true }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } }); }
  private async defaultWarehouse(id?: string) {
    if (id) { const w = await this.prisma.db.location.findUnique({ where: { id } }); if (!w || w.type !== 'WAREHOUSE') throw new BadRequestException('Choose a warehouse'); return w; }
    const code = await this.settings.get<string>('ecom.warehouse_code');
    const w = (code && (await this.prisma.db.location.findUnique({ where: { code } }))) || (await this.prisma.db.location.findFirst({ where: { type: 'WAREHOUSE', active: true }, orderBy: { code: 'asc' } }));
    if (!w) throw new BadRequestException('No warehouse set up');
    return w;
  }

  // ─────────────── Overview ───────────────

  async overview() {
    const overdueDays = (await this.settings.get<number>('ecom.overdue_days')) ?? 30;
    const since = new Date(Date.now() - overdueDays * 86400000);
    const out = [];
    for (const p of PLATFORMS) {
      const [pending, shipped, overdue, returns, drafts, lastSettlement] = await Promise.all([
        this.prisma.db.ecomOrder.count({ where: { platform: p, status: 'PENDING' } }),
        this.prisma.db.ecomOrder.count({ where: { platform: p, status: 'SHIPPED' } }),
        this.prisma.db.ecomOrder.count({ where: { platform: p, status: 'SHIPPED', shippedAt: { lt: since } } }),
        this.prisma.db.ecomReturn.count({ where: { platform: p, status: 'PENDING' } }),
        this.prisma.db.ecomSettlement.count({ where: { platform: p, status: { in: ['DRAFT', 'SUBMITTED'] } } }),
        this.prisma.db.ecomSettlement.findFirst({ where: { platform: p, status: 'POSTED' }, orderBy: { postedAt: 'desc' }, select: { controlNo: true, payout: true, postedAt: true } }),
      ]);
      out.push({ platform: p, name: PLATFORM_INFO[p].name, pendingPullOut: pending, awaitingPayment: shipped, overdue, returnsWaiting: returns, settlementsOpen: drafts, lastSettlement });
    }
    return { platforms: out, overdueDays, warehouses: await this.warehouses() };
  }

  // ─────────────── SKU matches ───────────────

  async skuMaps(p: Platform) {
    const maps = await this.prisma.db.ecomSkuMap.findMany({ where: { platform: p }, orderBy: { platformSku: 'asc' } });
    const products = await this.prisma.db.product.findMany({ where: { id: { in: maps.map((m) => m.productId) } }, select: { id: true, sku: true, name: true } });
    return maps.map((m) => ({ ...m, product: products.find((x) => x.id === m.productId) ?? null }));
  }
  async setSkuMap(p: Platform, platformSku: string, productId: string, user: SessionUser) {
    const sku = platformSku.trim(); if (!sku) throw new BadRequestException('Platform SKU is required');
    await this.prisma.db.product.findUniqueOrThrow({ where: { id: productId } });
    const row = await this.prisma.db.ecomSkuMap.upsert({ where: { platform_platformSku: { platform: p, platformSku: sku } }, create: { platform: p, platformSku: sku, productId, createdBy: user.id }, update: { productId } });
    await this.audit.log({ action: 'ECOM_SKU_MAP', entityType: 'EcomSkuMap', entityId: row.id, after: row });
    return row;
  }
  async deleteSkuMap(id: string) { await this.prisma.db.ecomSkuMap.delete({ where: { id } }); return { ok: true }; }

  /** Platform SKU → GWS product: a remembered match first, then the GWS SKU or barcode typed in the platform's Seller SKU. */
  private async resolveSkus(p: Platform, skus: string[]) {
    const uniq = [...new Set(skus)];
    const out = new Map<string, string>();
    for (const m of await this.prisma.db.ecomSkuMap.findMany({ where: { platform: p, platformSku: { in: uniq } } })) out.set(m.platformSku, m.productId);
    const rest = uniq.filter((s) => !out.has(s));
    if (rest.length) {
      const products = await this.prisma.db.product.findMany({ where: { OR: [{ sku: { in: rest, mode: 'insensitive' } }, { barcode: { in: rest } }] }, select: { id: true, sku: true, barcode: true } });
      for (const s of rest) { const hit = products.find((x) => x.sku.toLowerCase() === s.toLowerCase() || x.barcode === s); if (hit) out.set(s, hit.id); }
    }
    return out;
  }

  // ─────────────── Orders → draft pull-out ───────────────

  /**
   * Upload the platform's order / waybill export: every new order whose SKUs are known goes on ONE draft pull-out from the Warehouse
   * (items totalled by SKU, oldest expiry first). Orders already uploaded, cancelled orders, unknown SKUs and items short in the
   * Warehouse are listed back so the associate can fix them and upload the same file again (orders are never pulled out twice).
   */
  async uploadOrders(p: Platform, file: { buffer: Buffer; originalname: string }, user: SessionUser, warehouseId?: string) {
    const parsed = parseOrders(await readSheets(file.buffer, file.originalname));
    if (!parsed.orders.length && parsed.errors.length) throw new BadRequestException(parsed.errors.join(' '));
    const wh = await this.defaultWarehouse(warehouseId);
    const dest = await this.platformLocation(p);
    const existing = await this.prisma.db.ecomOrder.findMany({ where: { platform: p, orderId: { in: parsed.orders.map((o) => o.orderId) } } });
    const active = new Map(existing.filter((o) => !['CANCELLED', 'REJECTED'].includes(o.status)).map((o) => [o.orderId, o]));
    const skuMap = await this.resolveSkus(p, parsed.orders.flatMap((o) => o.lines.map((l) => l.sku)));
    const unknown = new Map<string, { platformSku: string; name: string | null; orders: number }>();
    const duplicates: string[] = []; const short: { orderId: string; item: string }[] = [];
    // what the Warehouse can still give (unexpired), less what earlier draft / waiting pull-outs already hold
    const need = new Map<string, number>();
    const candidates = parsed.orders.filter((o) => {
      if (active.has(o.orderId)) { duplicates.push(o.orderId); return false; }
      const missing = o.lines.filter((l) => !skuMap.has(l.sku));
      for (const m of missing) { const u = unknown.get(m.sku) ?? { platformSku: m.sku, name: m.name, orders: 0 }; u.orders++; unknown.set(m.sku, u); }
      return missing.length === 0;
    });
    const productIds = [...new Set(candidates.flatMap((o) => o.lines.map((l) => skuMap.get(l.sku)!)))];
    const available = await this.availableAt(wh.id, productIds);
    const products = new Map((await this.prisma.db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, sku: true } })).map((x) => [x.id, x]));
    const accepted = candidates.filter((o) => {
      const want = new Map<string, number>();
      for (const l of o.lines) { const pid = skuMap.get(l.sku)!; want.set(pid, (want.get(pid) ?? 0) + l.qty); }
      for (const [pid, q] of want) if ((need.get(pid) ?? 0) + q > (available.get(pid) ?? 0)) { short.push({ orderId: o.orderId, item: products.get(pid)?.name ?? pid }); return false; }
      for (const [pid, q] of want) need.set(pid, (need.get(pid) ?? 0) + q);
      return true;
    });
    let pullOut: { id: string; controlNo: string } | null = null;
    if (accepted.length) {
      const doc = await this.transfers.create({ fromLocationId: wh.id, toLocationId: dest.id, transferType: 'ECOMMERCE', notes: `${PLATFORM_INFO[p].name}: ${accepted.length} order(s) from ${file.originalname}`, lines: [...need.entries()].map(([productId, qty]) => ({ productId, qty })) }, user);
      pullOut = { id: doc.id, controlNo: doc.controlNo };
      await this.prisma.db.$transaction(async (tx) => {
        for (const o of accepted) {
          const data = { trackingNo: o.trackingNo, status: 'PENDING', pullOutId: doc.id, settlementId: null, salesDocId: null, sourceFile: file.originalname, shippedAt: null, settledAt: null, returnedAt: null, createdBy: user.id };
          const prev = existing.find((e) => e.orderId === o.orderId);
          const row = prev ? await tx.ecomOrder.update({ where: { id: prev.id }, data }) : await tx.ecomOrder.create({ data: { ...data, platform: p, orderId: o.orderId } });
          if (prev) await tx.ecomOrderLine.deleteMany({ where: { orderId: row.id } });
          await tx.ecomOrderLine.createMany({ data: o.lines.map((l) => ({ orderId: row.id, productId: skuMap.get(l.sku)!, platformSku: l.sku, productName: l.name, qty: l.qty })) });
        }
      });
      await this.audit.log({ action: 'ECOM_ORDERS_UPLOAD', entityType: 'TransferDoc', entityId: doc.id, after: { platform: p, file: file.originalname, orders: accepted.map((o) => o.orderId) } });
    }
    return { pullOut, ordersAdded: accepted.length, duplicates, cancelled: parsed.cancelled, unknownSkus: [...unknown.values()], notEnoughStock: short, errors: parsed.errors, warehouse: wh.name };
  }
  private async availableAt(locationId: string, productIds: string[]) {
    const today = todayManila();
    const rows = await this.prisma.db.stockBalance.findMany({ where: { locationId, productId: { in: productIds }, qty: { gt: 0 } }, include: { batch: { select: { expiryDate: true } } } });
    const out = new Map<string, number>();
    for (const r of rows) if (!r.batch.expiryDate || r.batch.expiryDate >= today) out.set(r.productId, (out.get(r.productId) ?? 0) + r.qty);
    return out;
  }

  async pullouts(p: Platform) {
    const dest = await this.platformLocation(p);
    const docs = await this.prisma.db.transferDoc.findMany({ where: { toLocationId: dest.id, transferType: 'ECOMMERCE' }, include: { fromLocation: { select: { name: true } }, lines: { select: { qtySent: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
    const counts = await this.prisma.db.ecomOrder.groupBy({ by: ['pullOutId'], where: { pullOutId: { in: docs.map((d) => d.id) } }, _count: true });
    return docs.map((d) => ({ id: d.id, controlNo: d.controlNo, docDate: d.docDate, status: d.status, from: d.fromLocation.name, notes: d.notes, units: d.lines.reduce((t, l) => t + l.qtySent, 0), orders: counts.find((c) => c.pullOutId === d.id)?._count ?? 0 }));
  }
  async pullout(id: string, user: SessionUser) {
    const doc = await this.transfers.get(id, user);
    if (doc.transferType !== 'ECOMMERCE') throw new NotFoundException();
    const orders = await this.prisma.db.ecomOrder.findMany({ where: { pullOutId: id }, include: { lines: true }, orderBy: { orderId: 'asc' } });
    const platform = PLATFORMS.find((p) => PLATFORM_INFO[p].locationCode === doc.toLocation.code) ?? null;
    // picking list: one row per item and batch, oldest expiry first
    const picking = doc.lines.map((l) => ({ sku: l.product.sku, product: l.product.name, batchNo: l.batch.batchNo, expiryDate: l.batch.expiryDate, qty: l.qtySent })).sort((a, b) => a.product.localeCompare(b.product) || String(a.expiryDate ?? '').localeCompare(String(b.expiryDate ?? '')));
    return { ...doc, platform, orders, picking };
  }
  /** Take a cancelled order off a draft pull-out: the items are re-totalled from the orders left. */
  async removeOrder(pullOutId: string, ecomOrderId: string, user: SessionUser) {
    const doc = await this.prisma.db.transferDoc.findUniqueOrThrow({ where: { id: pullOutId } });
    if (doc.status !== 'DRAFT') throw new BadRequestException('Orders can be removed only while the pull-out is a draft');
    const order = await this.prisma.db.ecomOrder.findFirst({ where: { id: ecomOrderId, pullOutId } });
    if (!order) throw new NotFoundException('Order not on this pull-out');
    await this.prisma.db.ecomOrder.update({ where: { id: order.id }, data: { status: 'CANCELLED', pullOutId: null } });
    const left = await this.prisma.db.ecomOrder.findMany({ where: { pullOutId }, include: { lines: true } });
    if (!left.length) { await this.transfers.void(pullOutId, 'All orders removed', user); return { voided: true }; }
    const need = new Map<string, number>();
    for (const o of left) for (const l of o.lines) need.set(l.productId, (need.get(l.productId) ?? 0) + l.qty);
    await this.transfers.applyEdit(pullOutId, { lines: [...need.entries()].map(([productId, qty]) => ({ productId, qty })) }, user.id, user);
    return { voided: false };
  }
  async submitPullout(id: string, user: SessionUser) {
    const doc = await this.prisma.db.transferDoc.findUniqueOrThrow({ where: { id } });
    if (doc.transferType !== 'ECOMMERCE') throw new NotFoundException();
    return this.transfers.submit(id, user);
  }
  async voidPullout(id: string, reason: string, user: SessionUser) {
    const doc = await this.prisma.db.transferDoc.findUniqueOrThrow({ where: { id } });
    if (doc.transferType !== 'ECOMMERCE') throw new NotFoundException();
    await this.transfers.void(id, reason, user);
    await this.prisma.db.ecomOrder.updateMany({ where: { pullOutId: id }, data: { status: 'CANCELLED' } });
    return { ok: true };
  }
  private async onPulloutDecided(docId: string, outcome: 'APPROVED' | 'REJECTED') {
    await requestContext.runSystem(async () => {
      const doc = await this.prisma.db.transferDoc.findUniqueOrThrow({ where: { id: docId } });
      await this.prisma.db.ecomOrder.updateMany({ where: { pullOutId: docId, status: 'PENDING' }, data: outcome === 'APPROVED' ? { status: 'SHIPPED', shippedAt: new Date() } : { status: 'REJECTED' } });
      await this.notify.toUsers([doc.preparedBy], { type: 'ECOM_PULLOUT_DECIDED', title: outcome === 'APPROVED' ? `E-commerce pull-out ${doc.controlNo} approved: hand the parcels to the courier` : `E-commerce pull-out ${doc.controlNo} was not approved; check with the Warehouse and upload the orders again`, link: '/ecommerce' });
    });
  }

  /** Order tracker: every order with how long since it shipped; shipped, unpaid and unreturned after X days = overdue. */
  async orders(p: Platform, q: { status?: string; search?: string }) {
    const overdueDays = (await this.settings.get<number>('ecom.overdue_days')) ?? 30;
    const where: Prisma.EcomOrderWhereInput = { platform: p };
    if (q.status === 'OVERDUE') { where.status = 'SHIPPED'; where.shippedAt = { lt: new Date(Date.now() - overdueDays * 86400000) }; }
    else if (q.status) where.status = q.status;
    if (q.search?.trim()) where.OR = [{ orderId: { contains: q.search.trim() } }, { trackingNo: { contains: q.search.trim() } }];
    const rows = await this.prisma.db.ecomOrder.findMany({ where, include: { lines: true }, orderBy: { createdAt: 'desc' }, take: 500 });
    const docs = await this.prisma.db.transferDoc.findMany({ where: { id: { in: rows.map((r) => r.pullOutId).filter((x): x is string => !!x) } }, select: { id: true, controlNo: true } });
    const today = new Date();
    return {
      overdueDays,
      orders: rows.map((o) => {
        const days = o.shippedAt ? Math.floor((today.getTime() - o.shippedAt.getTime()) / 86400000) : null;
        return { ...o, pullOutNo: docs.find((d) => d.id === o.pullOutId)?.controlNo ?? null, daysSinceShipped: days, overdue: o.status === 'SHIPPED' && days != null && days > overdueDays, units: o.lines.reduce((t, l) => t + l.qty, 0) };
      }),
    };
  }

  /** Weekly (Friday): overdue orders per platform go to the E-comm Associates and the Owner to follow up with the platform. */
  async remindOverdue() {
    const { platforms, overdueDays } = await this.overview();
    const late = platforms.filter((p) => p.overdue > 0);
    if (!late.length) return { sent: 0 };
    await this.notify.toRoles(['ECOMM_ASSOCIATE', 'ADMIN'], { type: 'ECOM_OVERDUE', title: `E-commerce orders not paid nor returned after ${overdueDays} days: ${late.map((p) => `${p.name} ${p.overdue}`).join(', ')}`, body: 'Open E-commerce → Order tracker → Overdue and follow up with the platform (or file a lost-parcel claim)', link: '/ecommerce' });
    return { sent: late.length };
  }

  // ─────────────── Settlements (payouts) ───────────────

  /** Upload a payout file: nothing is posted yet. Each order is matched to a shipped order; the associate checks it, then sends it to Accounting. */
  async uploadSettlement(p: Platform, file: { buffer: Buffer; originalname: string }, user: SessionUser, includeUnmatched = false) {
    const parsed = parseSettlement(await readSheets(file.buffer, file.originalname));
    if (!parsed.orders.length) throw new BadRequestException(parsed.errors.join(' ') || 'No orders found in the file');
    const dup = await this.prisma.db.ecomSettlement.findFirst({ where: { platform: p, sourceFile: file.originalname, status: { not: 'REJECTED' } } });
    if (dup) throw new BadRequestException(`This file was already uploaded (${dup.controlNo}). Delete that draft first if you want to upload it again.`);
    const known = await this.prisma.db.ecomOrder.findMany({ where: { platform: p, orderId: { in: parsed.orders.map((o) => o.orderId) } } });
    const details: DetailRow[] = parsed.orders.map((o) => {
      const e = known.find((k) => k.orderId === o.orderId);
      let kind: Kind;
      if (!e || ['CANCELLED', 'REJECTED'].includes(e.status)) kind = 'UNKNOWN';
      else if (e.status === 'PENDING') kind = 'NOT_SHIPPED';
      else if (e.status === 'SHIPPED') kind = 'SALE';
      else kind = o.amounts.grossSales > 0 ? 'ALREADY_SETTLED' : 'MONEY_ONLY'; // a later refund / fee on an order already paid or returned
      if (kind === 'SALE' && e?.status === 'SHIPPED' && o.amounts.grossSales <= 0) kind = 'MONEY_ONLY';
      const included = kind === 'SALE' || kind === 'MONEY_ONLY' || (kind === 'UNKNOWN' && includeUnmatched);
      return { orderId: o.orderId, ecomOrderId: e?.id ?? null, kind, included, amounts: o.amounts, trackingNo: e?.trackingNo ?? null };
    });
    const totals = this.totals(details);
    const row = await this.prisma.db.$transaction(async (tx) => {
      const controlNo = await this.seq.form(tx, 'EP', (await this.platformLocation(p, tx)).id);
      return tx.ecomSettlement.create({ data: { controlNo, platform: p, docDate: todayManila(), sourceFile: file.originalname, includeUnmatched, ...totals, filePayout: D(parsed.filePayout).toFixed(2), details: details as unknown as Prisma.InputJsonValue, createdBy: user.id } });
    });
    await this.audit.log({ action: 'ECOM_SETTLEMENT_UPLOAD', entityType: 'EcomSettlement', entityId: row.id, after: { platform: p, file: file.originalname, orders: totals.orders, payout: totals.payout } });
    return { ...(await this.settlement(row.id, user)), warnings: parsed.errors, columnsUsed: parsed.columnsUsed, format: parsed.format };
  }
  private totals(details: DetailRow[]) {
    const t = zeroAmounts(); let orders = 0;
    for (const d of details) if (d.included) { orders++; for (const k of [...AMOUNT_KEYS, 'payout', 'adjustments'] as const) t[k] += d.amounts[k]; }
    const f = (n: number) => D(n).toDecimalPlaces(2).toFixed(2);
    return { orders, grossSales: f(t.grossSales), sellerDiscounts: f(t.sellerDiscounts), commission: f(t.commission), transactionFee: f(t.transactionFee), shippingFee: f(t.shippingFee), affiliateFee: f(t.affiliateFee), otherFees: f(t.otherFees), refunds: f(t.refunds), withholdingTax: f(t.withholdingTax), adjustments: f(t.adjustments), payout: f(t.payout) };
  }
  async settlements(p: Platform) {
    return this.prisma.db.ecomSettlement.findMany({ where: { platform: p }, select: { id: true, controlNo: true, docDate: true, status: true, sourceFile: true, orders: true, grossSales: true, payout: true, filePayout: true, postedAt: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 100 });
  }
  async settlement(id: string, user: SessionUser) {
    const s = await this.prisma.db.ecomSettlement.findUnique({ where: { id } });
    if (!s) throw new NotFoundException();
    const details = s.details as unknown as DetailRow[];
    const fees = D(s.commission).plus(s.transactionFee).plus(s.shippingFee).plus(s.affiliateFee).plus(s.otherFees).minus(s.adjustments);
    const counts = details.reduce<Record<string, number>>((m, d) => { m[d.kind] = (m[d.kind] ?? 0) + 1; return m; }, {});
    const canCost = user.permissions.has('cost.view');
    return {
      ...s, costOfSales: canCost ? s.costOfSales : undefined, details, counts,
      netSales: D(s.grossSales).minus(s.sellerDiscounts).toFixed(2), totalFees: fees.toFixed(2),
      check: { computed: D(s.grossSales).minus(s.sellerDiscounts).minus(fees).minus(s.refunds).minus(s.withholdingTax).toFixed(2), payout: s.payout, notInBatch: D(s.filePayout).minus(s.payout).toFixed(2) },
    };
  }
  async deleteSettlement(id: string) {
    const s = await this.prisma.db.ecomSettlement.findUniqueOrThrow({ where: { id } });
    if (!['DRAFT', 'REJECTED'].includes(s.status)) throw new BadRequestException('Only a draft (or a rejected payout) can be deleted');
    await this.prisma.db.ecomSettlement.delete({ where: { id } });
    await this.audit.log({ action: 'DELETE', entityType: 'EcomSettlement', entityId: id, before: { controlNo: s.controlNo } });
    return { ok: true };
  }
  async submitSettlement(id: string, user: SessionUser) {
    const s = await this.prisma.db.ecomSettlement.findUniqueOrThrow({ where: { id } });
    if (s.status !== 'DRAFT') throw new BadRequestException('Already sent to Accounting');
    const details = s.details as unknown as DetailRow[];
    if (!details.some((d) => d.included)) throw new BadRequestException('No order in this file can be posted yet (none shipped through GWS-ERP)');
    // an order may be in only one open payout batch
    const open = await this.prisma.db.ecomSettlement.findMany({ where: { platform: s.platform, status: 'SUBMITTED', id: { not: id } } });
    const mine = new Set(details.filter((d) => d.included && d.kind === 'SALE').map((d) => d.orderId));
    for (const o of open) { const clash = (o.details as unknown as DetailRow[]).find((d) => d.included && d.kind === 'SALE' && mine.has(d.orderId)); if (clash) throw new BadRequestException(`Order ${clash.orderId} is already in ${o.controlNo}, waiting for Accounting`); }
    const p = s.platform as Platform;
    const req = await this.approvals.request({ type: 'ECOM_SETTLEMENT', documentType: 'EcomSettlement', documentId: id, requestedBy: user.id, summary: { controlNo: s.controlNo, locationName: PLATFORM_INFO[p].name, platform: PLATFORM_INFO[p].name, orders: s.orders, grossSales: s.grossSales.toFixed(2), sellerDiscounts: s.sellerDiscounts.toFixed(2), fees: D(s.commission).plus(s.transactionFee).plus(s.shippingFee).plus(s.affiliateFee).plus(s.otherFees).minus(s.adjustments).toFixed(2), refunds: s.refunds.toFixed(2), withholdingTax: s.withholdingTax.toFixed(2), payout: s.payout.toFixed(2), step: 'Check that gross sales − discounts − fees − refunds − withholding tax = the payout received, then approve' } });
    await this.prisma.db.ecomSettlement.update({ where: { id }, data: { status: 'SUBMITTED', approvalRequestId: req.id } });
    return this.settlement(id, user);
  }

  /** Accounting approved: the sale of each shipped order (stock leaves the holding place), the fees, refunds, tax and payout are posted. */
  private async onSettlementDecision(id: string, outcome: 'APPROVED' | 'REJECTED', actorId: string | null) {
    await requestContext.runSystem(async () => {
      const s = await this.prisma.db.ecomSettlement.findUniqueOrThrow({ where: { id } });
      if (s.status !== 'SUBMITTED') return;
      if (outcome === 'REJECTED') {
        await this.prisma.db.ecomSettlement.update({ where: { id }, data: { status: 'REJECTED' } });
        if (s.createdBy) await this.notify.toUsers([s.createdBy], { type: 'ECOM_SETTLEMENT_REJECTED', title: `Payout ${s.controlNo} was not approved by Accounting; check the file and upload it again`, link: '/ecommerce' });
        return;
      }
      const p = s.platform as Platform;
      const details = s.details as unknown as DetailRow[];
      const loc = await this.platformLocation(p);
      await this.prisma.db.$transaction(async (tx) => {
        const acct = await this.ensureAccounts(tx, p, actorId);
        const cost = new Map<string, { warehouseId: string; accountingClass: string; amount: Decimal }>();
        for (const d of details.filter((x) => x.included && x.kind === 'SALE')) {
          const order = await tx.ecomOrder.findUniqueOrThrow({ where: { id: d.ecomOrderId! }, include: { lines: true } });
          if (order.status !== 'SHIPPED') continue; // settled in another batch meanwhile: its money is still booked, no second sale
          const pull = order.pullOutId ? await tx.transferDoc.findUnique({ where: { id: order.pullOutId }, select: { fromLocationId: true } }) : null;
          const sale = await this.recordSale(tx, p, loc.id, order, d.amounts, s.docDate, actorId, acct.cash);
          for (const c of sale.costLines) {
            const key = `${pull?.fromLocationId}|${c.accountingClass}`;
            const cur = cost.get(key) ?? { warehouseId: pull?.fromLocationId ?? '', accountingClass: c.accountingClass, amount: D(0) };
            cur.amount = cur.amount.plus(c.amount); cost.set(key, cur);
          }
          await tx.ecomOrder.update({ where: { id: order.id }, data: { status: 'SETTLED', settledAt: new Date(), settlementId: id, salesDocId: sale.id } });
        }
        for (const d of details.filter((x) => x.included && x.kind === 'MONEY_ONLY' && x.ecomOrderId)) await tx.ecomOrder.update({ where: { id: d.ecomOrderId! }, data: { settlementId: id } });
        const costOfSales = [...cost.values()].reduce((t, c) => t.plus(c.amount), D(0));
        await tx.ecomSettlement.update({ where: { id }, data: { status: 'POSTED', postedAt: new Date(), costOfSales: costOfSales.toFixed(2) } });
        await this.posting.post(tx, { type: 'EcomSettlement', id, date: s.docDate, name: PLATFORM_INFO[p].name, createdBy: actorId }, (r) => {
          const out: Entry[] = [this.settlementEntry(s, acct)];
          const lines: Line[] = [];
          for (const c of cost.values()) {
            if (c.amount.isZero() || !c.warehouseId) continue;
            lines.push({ accountId: r.branch(directCostTemplateFor(c.accountingClass), c.warehouseId), debit: round2(c.amount), credit: D(0) });
            lines.push({ accountId: r.branch(inventoryTemplateFor(c.accountingClass), c.warehouseId), debit: D(0), credit: round2(c.amount) });
          }
          if (lines.length) { const e: Entry = { rule: 'ECOM', book: 'GASTOS_DC', lines: consolidate(lines), remarks: `Cost of ${PLATFORM_INFO[p].name} sales ${s.controlNo}` }; assertBalanced(e.lines); out.push(e); }
          return out;
        });
      }, { timeout: 60000 });
      if (s.createdBy) await this.notify.toUsers([s.createdBy], { type: 'ECOM_SETTLEMENT_POSTED', title: `Payout ${s.controlNo} (${PLATFORM_INFO[p].name}) approved and posted`, link: '/ecommerce' });
    });
  }

  /** Dr payout (platform wallet), each fee, refunds, discounts and withholding tax; Cr sales. Adjustments keep it equal to the payout. */
  settlementEntry(s: { controlNo: string; grossSales: Prisma.Decimal; sellerDiscounts: Prisma.Decimal; commission: Prisma.Decimal; transactionFee: Prisma.Decimal; shippingFee: Prisma.Decimal; affiliateFee: Prisma.Decimal; otherFees: Prisma.Decimal; refunds: Prisma.Decimal; withholdingTax: Prisma.Decimal; adjustments: Prisma.Decimal; payout: Prisma.Decimal; platform: string }, acct: Record<string, string>): Entry {
    const lines: Line[] = [];
    const side = (accountId: string, amount: Decimal.Value, memo: string) => { const a = round2(amount); if (a.isZero()) return; lines.push(a.isPositive() ? { accountId, debit: a, credit: D(0), memo } : { accountId, debit: D(0), credit: a.abs(), memo }); };
    side(acct.cash, D(s.payout), 'Payout');
    side(acct.sellerDiscounts, D(s.sellerDiscounts), 'Seller discounts / vouchers');
    side(acct.commission, D(s.commission), 'Commission');
    side(acct.transactionFee, D(s.transactionFee), 'Transaction / payment fee');
    side(acct.shippingFee, D(s.shippingFee), 'Shipping fee');
    side(acct.affiliateFee, D(s.affiliateFee), 'Affiliate commission');
    side(acct.otherFees, D(s.otherFees).minus(s.adjustments), 'Other fees and adjustments');
    side(acct.refunds, D(s.refunds), 'Refunds');
    side(acct.withholdingTax, D(s.withholdingTax), 'Withholding tax (creditable)');
    side(acct.sales, D(s.grossSales).neg(), 'Gross sales');
    const e: Entry = { rule: 'ECOM', book: 'BENTA', lines: consolidate(lines), remarks: `${PLATFORM_INFO[s.platform as Platform].name} payout ${s.controlNo}` };
    assertBalanced(e.lines);
    return e;
  }

  /** The e-commerce accounts of a platform (created when missing, so posting never skips for lack of an account). */
  private async ensureAccounts(tx: Tx, p: Platform, actorId: string | null) {
    const out: Record<string, string> = {};
    for (const [key, def] of Object.entries(ACCOUNT_DEFS(p))) {
      const a = (await tx.account.findFirst({ where: { title: def.title } })) ?? (await this.accounts.create({ title: def.title, class: def.class, entryScope: 'MAIN', isPaymentAccount: false }, actorId ?? 'system', tx));
      out[key] = a.id;
    }
    const c = PLATFORM_CASH[p];
    const cash = (await tx.account.findFirst({ where: { OR: [{ code: c.code }, { title: c.title }] } })) ?? (await this.accounts.create({ code: c.code, title: c.title, class: 'CASH', entryScope: 'MAIN', paymentAccountType: 'PLATFORM' }, actorId ?? 'system', tx));
    out.cash = cash.id;
    return out;
  }

  /** One sale per paid order at the platform's holding place: net sales spread over the items by retail price; stock leaves oldest expiry first. */
  private async recordSale(tx: Tx, p: Platform, locationId: string, order: { id: string; orderId: string; lines: { productId: string; qty: number }[] }, a: Amounts, date: Date, actorId: string | null, cashAccountId: string) {
    const net = D(a.grossSales).minus(a.sellerDiscounts);
    const weights = [];
    for (const l of order.lines) weights.push(D((await this.master.priceFor(l.productId, 'RETAIL', date, tx)) ?? 1).mul(l.qty));
    const totalW = weights.reduce((t, w) => t.plus(w), D(0));
    const products = await tx.product.findMany({ where: { id: { in: order.lines.map((l) => l.productId) } }, select: { id: true, category: { select: { accountingClass: true } } } });
    const salesLines: Prisma.SalesLineUncheckedCreateWithoutDocInput[] = []; const costLines: { accountingClass: string; amount: Decimal }[] = []; const posts: Parameters<StockService['post']>[1] = [];
    let allocated = D(0);
    for (let i = 0; i < order.lines.length; i++) {
      const l = order.lines[i];
      const lineAmt = i === order.lines.length - 1 ? net.minus(allocated) : round2(totalW.isZero() ? net.div(order.lines.length) : net.mul(weights[i]).div(totalW));
      allocated = allocated.plus(lineAmt);
      const picks = await this.stock.pickFefo(tx, locationId, l.productId, l.qty, { allowExpired: true });
      let left = lineAmt;
      for (let j = 0; j < picks.length; j++) {
        const pk = picks[j];
        const amt = j === picks.length - 1 ? left : round2(lineAmt.mul(pk.qty).div(l.qty));
        left = left.minus(amt);
        const unitPrice = round2(amt.div(pk.qty));
        salesLines.push({ productId: l.productId, batchId: pk.batchId, qty: pk.qty, priceTier: 'RETAIL', tierPrice: unitPrice, unitPrice, unitCost: pk.unitCost, amount: amt });
        costLines.push({ accountingClass: products.find((x) => x.id === l.productId)?.category.accountingClass ?? 'SUPPLEMENT', amount: D(pk.unitCost).mul(pk.qty) });
        posts.push({ locationId, productId: l.productId, batchId: pk.batchId, qtyDelta: -pk.qty, movementType: 'SALE', documentType: 'SalesDoc', documentId: '', unitCost: pk.unitCost, businessDate: date, createdBy: actorId ?? undefined });
      }
    }
    const controlNo = await this.seq.form(tx, 'DR', locationId);
    const fees = D(a.commission).plus(a.transactionFee).plus(a.shippingFee).plus(a.affiliateFee).plus(a.otherFees).minus(a.adjustments);
    const doc = await tx.salesDoc.create({ data: {
      controlNo, docDate: date, locationId, channel: 'SHIPPING_MARKETPLACE', channelSub: p, customerName: `${PLATFORM_INFO[p].name} order ${order.orderId}`, drSiNo: `${p}-${order.orderId}`,
      paymentMode: 'ONLINE', paymentAccountId: cashAccountId, productTotal: D(a.grossSales).toFixed(2), marketplaceCharges: fees.toFixed(2), grandTotal: net.toFixed(2), amountPaid: net.toFixed(2),
      notes: `E-commerce order ${order.orderId}`, preparedBy: actorId ?? 'system', createdBy: actorId, lines: { create: salesLines },
    } });
    await this.stock.post(tx, posts.map((x) => ({ ...x, documentId: doc.id })));
    return { id: doc.id, costLines };
  }

  // ─────────────── Returns ───────────────

  /** The associate logs a parcel that came back (by order ID or tracking number); the Warehouse In-Charge receives it. */
  async createReturn(p: Platform, input: { ref: string; reason?: string; notes?: string; lines?: { productId: string; qty: number }[] }, user: SessionUser) {
    const ref = input.ref.trim();
    const order = await this.prisma.db.ecomOrder.findFirst({ where: { platform: p, OR: [{ orderId: ref }, { trackingNo: ref }] }, include: { lines: true } });
    if (!order) throw new NotFoundException(`No ${PLATFORM_INFO[p].name} order with order ID or tracking number "${ref}"`);
    if (!['SHIPPED', 'SETTLED'].includes(order.status)) throw new BadRequestException(`Order ${order.orderId} is ${order.status.toLowerCase()}; only shipped or paid orders can come back`);
    if (await this.prisma.db.ecomReturn.findFirst({ where: { ecomOrderId: order.id, status: 'PENDING' } })) throw new BadRequestException('A return for this order is already waiting for the Warehouse');
    const names = new Map((await this.prisma.db.product.findMany({ where: { id: { in: order.lines.map((l) => l.productId) } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
    const lines: ReturnLine[] = (input.lines?.length ? input.lines : order.lines.map((l) => ({ productId: l.productId, qty: l.qty }))).map((l) => {
      const ol = order.lines.find((x) => x.productId === l.productId);
      if (!ol || l.qty <= 0 || l.qty > ol.qty) throw new BadRequestException('Returned quantity must be within the order');
      return { productId: l.productId, name: names.get(l.productId), qty: l.qty };
    });
    const pull = order.pullOutId ? await this.prisma.db.transferDoc.findUnique({ where: { id: order.pullOutId }, select: { fromLocationId: true } }) : null;
    const row = await this.prisma.db.$transaction(async (tx) => {
      const controlNo = await this.seq.form(tx, 'ER', (await this.platformLocation(p, tx)).id);
      return tx.ecomReturn.create({ data: { controlNo, platform: p, ecomOrderId: order.id, reason: input.reason ?? (order.status === 'SHIPPED' ? 'FAILED_DELIVERY' : 'BUYER_RETURN'), notes: input.notes, lines: lines as unknown as Prisma.InputJsonValue, createdBy: user.id } });
    });
    if (pull) await this.notify.toLocation(pull.fromLocationId, { type: 'ECOM_RETURN', title: `${PLATFORM_INFO[p].name} parcel coming back: order ${order.orderId} (${row.controlNo})`, body: 'Receive it in E-commerce → Returns and mark each item good or damaged', link: '/ecommerce?tab=returns' });
    await this.audit.log({ action: 'CREATE', entityType: 'EcomReturn', entityId: row.id, after: row });
    return row;
  }
  async returns(q: { platform?: Platform; status?: string }) {
    const rows = await this.prisma.db.ecomReturn.findMany({ where: { platform: q.platform, status: q.status }, orderBy: { createdAt: 'desc' }, take: 200 });
    const orders = await this.prisma.db.ecomOrder.findMany({ where: { id: { in: rows.map((r) => r.ecomOrderId) } }, select: { id: true, orderId: true, trackingNo: true, status: true } });
    return rows.map((r) => ({ ...r, platformName: PLATFORM_INFO[r.platform as Platform]?.name, order: orders.find((o) => o.id === r.ecomOrderId) ?? null }));
  }
  /**
   * The In-Charge receives a returned parcel: good items go back to Warehouse stock; damaged items also come in and a write-off goes to the
   * Head Auditor. Not yet paid → the items simply leave the holding place; already paid → a sales return, and the cost goes back to inventory.
   */
  async receiveReturn(id: string, input: { lines: { productId: string; goodQty: number; damagedQty: number }[] }, user: SessionUser) {
    const r = await this.prisma.db.ecomReturn.findUniqueOrThrow({ where: { id } });
    if (r.status !== 'PENDING') throw new BadRequestException('Already received');
    const order = await this.prisma.db.ecomOrder.findUniqueOrThrow({ where: { id: r.ecomOrderId }, include: { lines: true } });
    const pull = order.pullOutId ? await this.prisma.db.transferDoc.findUnique({ where: { id: order.pullOutId }, select: { fromLocationId: true } }) : null;
    const whId = pull?.fromLocationId ?? (await this.defaultWarehouse()).id;
    if (user.locationScoped && !user.locationIds.includes(whId)) throw new ForbiddenException('Only the Warehouse that sent the items receives them back');
    const p = r.platform as Platform;
    const lines = (r.lines as unknown as ReturnLine[]).map((l) => {
      const got = input.lines.find((x) => x.productId === l.productId) ?? { goodQty: 0, damagedQty: 0 };
      if (got.goodQty < 0 || got.damagedQty < 0 || !Number.isInteger(got.goodQty) || !Number.isInteger(got.damagedQty) || got.goodQty + got.damagedQty > l.qty) throw new BadRequestException(`Good + damaged for ${l.name ?? 'an item'} must be whole numbers up to ${l.qty}`);
      return { ...l, goodQty: got.goodQty, damagedQty: got.damagedQty };
    });
    const loc = await this.platformLocation(p);
    const damagedBatches: { productId: string; batchId: string; qty: number }[] = [];
    await this.prisma.db.$transaction(async (tx) => {
      const posts: Parameters<StockService['post']>[1] = [];
      const costBack: { accountingClass: string; amount: Decimal }[] = [];
      for (const l of lines) {
        const qty = l.goodQty! + l.damagedQty!; if (!qty) continue;
        let picks: { batchId: string; qty: number; unitCost: Prisma.Decimal }[];
        if (order.status === 'SHIPPED') {
          picks = await this.stock.pickFefo(tx, loc.id, l.productId, qty, { allowExpired: true });
          for (const pk of picks) posts.push({ locationId: loc.id, productId: l.productId, batchId: pk.batchId, qtyDelta: -pk.qty, movementType: 'RETURN_TO_WAREHOUSE', documentType: 'EcomReturn', documentId: r.id, unitCost: pk.unitCost, createdBy: user.id });
        } else {
          // paid order: the batches that were sold come back
          const sold = order.salesDocId ? await tx.salesLine.findMany({ where: { docId: order.salesDocId, productId: l.productId }, include: { product: { select: { category: { select: { accountingClass: true } } } } } }) : [];
          if (!sold.length) throw new BadRequestException('The sale of this order was not found');
          picks = []; let left = qty;
          for (const s of sold) { if (left <= 0) break; const take = Math.min(left, s.qty); picks.push({ batchId: s.batchId, qty: take, unitCost: s.unitCost }); left -= take; costBack.push({ accountingClass: s.product.category.accountingClass, amount: D(s.unitCost).mul(take) }); }
        }
        for (const pk of picks) posts.push({ locationId: whId, productId: l.productId, batchId: pk.batchId, qtyDelta: pk.qty, movementType: order.status === 'SHIPPED' ? 'RETURN_TO_WAREHOUSE' : 'SALE_RETURN', documentType: 'EcomReturn', documentId: r.id, unitCost: pk.unitCost, createdBy: user.id });
        let dmg = l.damagedQty!;
        for (const pk of picks) { if (dmg <= 0) break; const take = Math.min(dmg, pk.qty); damagedBatches.push({ productId: l.productId, batchId: pk.batchId, qty: take }); dmg -= take; }
      }
      await this.stock.post(tx, posts);
      const allBack = lines.every((l) => l.goodQty! + l.damagedQty! >= (order.lines.find((x) => x.productId === l.productId)?.qty ?? 0)) && order.lines.every((ol) => lines.some((l) => l.productId === ol.productId));
      await tx.ecomReturn.update({ where: { id }, data: { status: 'RECEIVED', receivedBy: user.id, receivedAt: new Date(), lines: lines as unknown as Prisma.InputJsonValue } });
      if (allBack || order.status === 'SHIPPED') await tx.ecomOrder.update({ where: { id: order.id }, data: { status: allBack ? 'RETURNED' : order.status, returnedAt: new Date() } });
      if (costBack.length) await this.posting.post(tx, { type: 'EcomReturn', id: r.id, date: todayManila(), createdBy: user.id }, (res) => {
        const ls: Line[] = [];
        for (const c of costBack) { ls.push({ accountId: res.branch(inventoryTemplateFor(c.accountingClass), whId), debit: round2(c.amount), credit: D(0) }); ls.push({ accountId: res.branch(directCostTemplateFor(c.accountingClass), whId), debit: D(0), credit: round2(c.amount) }); }
        const e: Entry = { rule: 'ECOM', book: 'GASTOS_DC', lines: consolidate(ls), remarks: `${PLATFORM_INFO[p].name} return ${r.controlNo} (order ${order.orderId})` }; assertBalanced(e.lines); return [e];
      });
    });
    let writeoffId: string | null = null;
    if (damagedBatches.length) {
      const wo = await this.transfers.createWriteoff({ locationId: whId, notes: `Damaged items from ${PLATFORM_INFO[p].name} return ${r.controlNo} (order ${order.orderId})`, chargeTo: 'COMPANY', lines: damagedBatches.map((d) => ({ ...d, reason: 'DAMAGED' as const })) }, user);
      writeoffId = wo.id;
      await this.prisma.db.ecomReturn.update({ where: { id }, data: { writeoffId } });
    }
    if (r.createdBy) await this.notify.toUsers([r.createdBy], { type: 'ECOM_RETURN_RECEIVED', title: `Return ${r.controlNo} (order ${order.orderId}) received by the Warehouse`, link: '/ecommerce' });
    await this.audit.log({ action: 'RECEIVE', entityType: 'EcomReturn', entityId: id, after: { lines, writeoffId } });
    return { ok: true, writeoffId };
  }

  // ─────────────── Ads ───────────────

  async ads(p: Platform) {
    const rows = await this.prisma.db.ecomAdSpend.findMany({ where: { platform: p }, orderBy: [{ month: 'desc' }, { createdAt: 'desc' }], take: 200 });
    const accts = await this.prisma.db.account.findMany({ where: { id: { in: rows.map((r) => r.paidFromAccountId).filter((x): x is string => !!x) } }, select: { id: true, title: true } });
    return rows.map((r) => ({ ...r, paidFrom: r.paidFromAccountId ? accts.find((a) => a.id === r.paidFromAccountId)?.title ?? '' : `${PLATFORM_INFO[p].name} balance (deducted from sales)` }));
  }
  /** Bank / card / wallet accounts the ads can be paid from. */
  paymentAccounts() { return this.prisma.db.account.findMany({ where: { active: true, isPaymentAccount: true, branchTagId: null }, select: { id: true, code: true, title: true }, orderBy: { title: 'asc' } }); }
  async addAds(p: Platform, input: { month: string; amount: number; paidFromAccountId?: string | null; reference?: string; notes?: string; sourceFile?: string }, user: SessionUser) {
    if (!/^\d{4}-\d{2}$/.test(input.month)) throw new BadRequestException('Month must be YYYY-MM');
    if (!(input.amount > 0)) throw new BadRequestException('Amount must be more than zero');
    const row = await this.prisma.db.$transaction(async (tx) => {
      const acct = await this.ensureAccounts(tx, p, user.id);
      const credit = input.paidFromAccountId || acct.cash;
      const row = await tx.ecomAdSpend.create({ data: { platform: p, month: input.month, amount: D(input.amount).toFixed(2), paidFromAccountId: input.paidFromAccountId || null, reference: input.reference, notes: input.notes, sourceFile: input.sourceFile, createdBy: user.id } });
      const [y, m] = input.month.split('-').map(Number);
      const lastDay = toDateOnly(dateStr(new Date(Date.UTC(y, m, 0))));
      const date = lastDay < todayManila() ? lastDay : todayManila();
      await this.posting.post(tx, { type: 'EcomAdSpend', id: row.id, date, name: PLATFORM_INFO[p].ads, createdBy: user.id }, () => {
        const e: Entry = { rule: 'ECOM', book: 'GASTOS_OPEX', lines: [{ accountId: acct.ads, debit: round2(input.amount), credit: D(0) }, { accountId: credit, debit: D(0), credit: round2(input.amount) }], remarks: `${PLATFORM_INFO[p].ads} ${input.month}${input.reference ? ` (${input.reference})` : ''}` };
        return [e];
      });
      return row;
    });
    await this.audit.log({ action: 'CREATE', entityType: 'EcomAdSpend', entityId: row.id, after: row });
    return row;
  }
  async uploadAds(p: Platform, file: { buffer: Buffer; originalname: string }, user: SessionUser, paidFromAccountId?: string | null, fallbackMonth?: string) {
    const month = fallbackMonth && /^\d{4}-\d{2}$/.test(fallbackMonth) ? fallbackMonth : dateStr(todayManila()).slice(0, 7);
    const parsed = parseAds(await readSheets(file.buffer, file.originalname), month);
    if (!parsed.months.length) throw new BadRequestException(parsed.errors.join(' ') || 'No amounts found in the file');
    const rows = [];
    for (const m of parsed.months) rows.push(await this.addAds(p, { month: m.month, amount: m.amount, paidFromAccountId, reference: file.originalname, sourceFile: file.originalname }, user));
    return { months: parsed.months, created: rows.length };
  }

  // ─────────────── Report ───────────────

  /**
   * E-commerce profit report: TikTok | Shopee | Lazada | All, for the period. Sales and fees come from posted payouts, ads from the ads
   * entries of the months in the period. Cost of goods and the contribution after cost only for people allowed to see cost.
   */
  async report(user: SessionUser, q: { from: string; to: string }) {
    const from = toDateOnly(q.from); const to = toDateOnly(q.to);
    if (daysBetween(from, to) < 0) throw new BadRequestException('The start date is after the end date');
    const canCost = user.permissions.has('cost.view');
    const overdueDays = (await this.settings.get<number>('ecom.overdue_days')) ?? 30;
    const setts = await this.prisma.db.ecomSettlement.findMany({ where: { status: 'POSTED', docDate: { gte: from, lte: to } } });
    const ads = await this.prisma.db.ecomAdSpend.findMany({ where: { month: { gte: q.from.slice(0, 7), lte: q.to.slice(0, 7) } } });
    const cols = [];
    for (const p of [...PLATFORMS, 'ALL' as const]) {
      const mine = setts.filter((s) => p === 'ALL' || s.platform === p);
      const s = (k: keyof (typeof setts)[number]) => mine.reduce((t, x) => t + Number(x[k] as Prisma.Decimal), 0);
      const gross = s('grossSales'), disc = s('sellerDiscounts'), net = gross - disc;
      const commission = s('commission'), txn = s('transactionFee'), ship = s('shippingFee'), aff = s('affiliateFee'), other = s('otherFees') - s('adjustments');
      const fees = commission + txn + ship + aff + other;
      const refunds = s('refunds'), wht = s('withholdingTax'), payout = s('payout'), cogs = s('costOfSales');
      const ad = ads.filter((a) => p === 'ALL' || a.platform === p).reduce((t, a) => t + Number(a.amount), 0);
      const where = p === 'ALL' ? {} : { platform: p };
      const [shipped, settled, returned, overdue] = await Promise.all([
        this.prisma.db.ecomOrder.count({ where: { ...where, shippedAt: { gte: from, lte: new Date(to.getTime() + 86400000) } } }),
        this.prisma.db.ecomOrder.count({ where: { ...where, settledAt: { gte: from, lte: new Date(to.getTime() + 86400000) } } }),
        this.prisma.db.ecomOrder.count({ where: { ...where, returnedAt: { gte: from, lte: new Date(to.getTime() + 86400000) } } }),
        this.prisma.db.ecomOrder.count({ where: { ...where, status: 'SHIPPED', shippedAt: { lt: new Date(Date.now() - overdueDays * 86400000) } } }),
      ]);
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const afterFees = net - refunds - fees - ad;
      cols.push({
        platform: p, name: p === 'ALL' ? 'All platforms' : PLATFORM_INFO[p].name,
        grossSales: r2(gross), sellerDiscounts: r2(disc), netSales: r2(net), refunds: r2(refunds), commission: r2(commission), transactionFee: r2(txn), shippingFee: r2(ship), affiliateFee: r2(aff), otherFees: r2(other), totalFees: r2(fees),
        ads: r2(ad), afterFeesAndAds: r2(afterFees), withholdingTax: r2(wht), payout: r2(payout),
        costOfSales: canCost ? r2(cogs) : undefined, contribution: canCost ? r2(afterFees - cogs) : undefined,
        feesPct: net ? r2((fees / net) * 100) : null, roas: ad ? r2(net / ad) : null,
        ordersShipped: shipped, ordersPaid: settled, ordersReturned: returned, overdueNow: overdue, returnRatePct: shipped ? r2((returned / shipped) * 100) : null,
      });
    }
    return { from: q.from, to: q.to, canCost, overdueDays, columns: cols };
  }

  async template(kind: 'orders' | 'settlement' | 'ads') {
    const cols = [...TEMPLATES[kind]];
    const sample: Record<string, unknown[][]> = {
      orders: [['578123456789', 'PH2412345678', 'SKU-0001', 'Whey Protein 5 lbs', 1]],
      settlement: [['578123456789', 1000, 50, 76, 21.28, 40, 0, 0, 0, 5, 807.72]],
      ads: [[`${dateStr(todayManila())}`, 1500, 'Campaign name']],
    };
    return this.xlsx.template(cols, sample[kind]);
  }
}
