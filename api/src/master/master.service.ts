import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import type { SessionUser } from '../common/request-context';
import { D } from '../common/money';
import { dateStr, todayManila, toDateOnly } from '../common/manila';
import { MasterDataApprovals } from '../approvals/master-data.service';
import { PriceUpdatesService } from '../notifications/price-updates.service';
import { SettingsService } from '../common/settings.service';

/** Supplier DTO: `name` is emitted as `supplierName` so the redaction interceptor can strip it (§16). */
export function supplierDto<T extends { name: string }>(s: T) {
  const { name, ...rest } = s;
  return { ...rest, supplierName: name };
}

@Injectable()
export class MasterService {
  constructor(private prisma: PrismaService, private audit: AuditService, md: MasterDataApprovals, private priceUpdates: PriceUpdatesService, private settings: SettingsService) {
    // what the Owner's approval creates (owner request 2026-09-26: new master data needs the Owner)
    md.registerKind('Location', { label: 'Branch / location', apply: (p, by) => this.createLocation(p as never, by) });
    md.registerKind('Supplier', { label: 'Supplier', apply: (p, by) => this.createSupplier(p as never, by) });
    md.registerKind('Category', { label: 'Product category', apply: (p) => this.createCategory(p as never) });
    md.registerKind('Product', { label: 'Product', apply: (p, by) => this.createProduct(p as never, by), link: (id) => `/products/${id}` });
    md.registerKind('Customer', { label: 'Customer', apply: (p, by) => this.createCustomer(p as never, by) });
    md.registerKind('Agent', { label: 'Agent', apply: (p) => this.createAgent(p as never) });
    md.registerKind('Rider', { label: 'Rider', apply: (p) => this.createRider(p as never) });
  }

  // ── Locations ──
  async listLocations(user: SessionUser, includeInactive = false) {
    const where: Prisma.LocationWhereInput = includeInactive ? {} : { active: true };
    if (user.locationScoped) {
      // location-scoped roles see own locations + the warehouse (availability only, §5.4 ASSUMPTION 1) + virtual customer-return locations.
      // Warehouse staff ship to every branch, franchise and consignee, so they get the full list (names only; stock stays scoped).
      const ownWarehouse = await this.prisma.db.location.count({ where: { id: { in: user.locationIds }, type: 'WAREHOUSE' } });
      if (!ownWarehouse) where.OR = [{ id: { in: user.locationIds } }, { type: 'WAREHOUSE' }, { type: 'VIRTUAL' }];
    }
    return this.prisma.db.location.findMany({ where, orderBy: [{ type: 'asc' }, { name: 'asc' }] });
  }
  async createLocation(data: Prisma.LocationUncheckedCreateInput, actorId: string) {
    const loc = await this.prisma.db.location.create({ data: { ...data, createdBy: actorId } });
    await this.audit.log({ action: 'CREATE', entityType: 'Location', entityId: loc.id, after: loc });
    return loc;
  }
  async updateLocation(id: string, data: Prisma.LocationUncheckedUpdateInput, actorId: string) {
    const before = await this.prisma.db.location.findUniqueOrThrow({ where: { id } });
    const after = await this.prisma.db.location.update({ where: { id }, data: { ...data, updatedBy: actorId } });
    await this.audit.log({ action: 'UPDATE', entityType: 'Location', entityId: id, before, after });
    return after;
  }

  // ── Suppliers (code visible to all; name redacted) ──
  async listSuppliers() { return (await this.prisma.db.supplier.findMany({ orderBy: { code: 'asc' } })).map(supplierDto); }
  async createSupplier(data: { name: string; contact?: string; termsDays?: number; isConsignor?: boolean }, actorId: string) {
    const s = await this.prisma.db.supplier.create({ data: { ...data, code: await this.nextCode('supplier', 'SUP-', 3), createdBy: actorId } });
    await this.audit.log({ action: 'CREATE', entityType: 'Supplier', entityId: s.id, after: s });
    return supplierDto(s);
  }
  async updateSupplier(id: string, data: Prisma.SupplierUncheckedUpdateInput, actorId: string) {
    const before = await this.prisma.db.supplier.findUniqueOrThrow({ where: { id } });
    const after = await this.prisma.db.supplier.update({ where: { id }, data: { ...data, updatedBy: actorId } });
    await this.audit.log({ action: 'UPDATE', entityType: 'Supplier', entityId: id, before, after });
    return supplierDto(after);
  }

  // ── Categories ──
  listCategories() { return this.prisma.db.category.findMany({ orderBy: { name: 'asc' } }); }
  createCategory(data: Prisma.CategoryCreateInput) { return this.prisma.db.category.create({ data }); }

  // ── Products ──
  async listProducts(user: SessionUser, q: { search?: string; categoryId?: string; includeInactive?: boolean; take?: number; inStockAt?: string; includeExpired?: boolean }) {
    const where: Prisma.ProductWhereInput = {};
    // New Sale / Transfers (owner request 2026-09-30): only what the branch actually has; 0 on hand is not offered
    let onHand: Map<string, number> | null = null;
    if (q.inStockAt) {
      const today = todayManila();
      const bal = await this.prisma.db.stockBalance.groupBy({ by: ['productId'], where: { locationId: q.inStockAt, qty: { gt: 0 }, ...(q.includeExpired ? {} : { batch: { OR: [{ expiryDate: null }, { expiryDate: { gte: today } }] } }) }, _sum: { qty: true } });
      onHand = new Map(bal.map((b) => [b.productId, b._sum.qty ?? 0]));
      const bundles = await this.prisma.db.bundleComponent.findMany({ select: { bundleProductId: true, componentProductId: true, qty: true } });
      const byBundle = new Map<string, { componentProductId: string; qty: number }[]>();
      for (const c of bundles) byBundle.set(c.bundleProductId, [...(byBundle.get(c.bundleProductId) ?? []), c]);
      for (const [bundleId, comps] of byBundle) {
        const can = Math.min(...comps.map((c) => Math.floor((onHand!.get(c.componentProductId) ?? 0) / c.qty)));
        if (can > 0) onHand.set(bundleId, can);
      }
      where.id = { in: [...onHand.keys()] };
    }
    if (!q.includeInactive) where.active = true;
    if (q.categoryId) where.categoryId = q.categoryId;
    if (user.roleKey.startsWith('FRANCHISE')) where.franchiseVisible = true;
    if (q.search) where.OR = [{ name: { contains: q.search, mode: 'insensitive' } }, { sku: { contains: q.search, mode: 'insensitive' } }, { barcode: q.search }];
    const products = await this.prisma.db.product.findMany({ where, include: { category: true, supplier: { select: { id: true, code: true, name: true } } }, orderBy: { name: 'asc' }, take: q.take ?? 500 });
    const ids = products.map((p) => p.id);
    const prices = await this.currentPrices(ids);
    const costs = user.permissions.has('cost.view') ? await this.currentCosts(ids) : new Map<string, string>();
    return products.map((p) => ({ ...p, tierPrices: prices.get(p.id) ?? {}, cost: costs.get(p.id) ?? null, ...(onHand ? { onHand: onHand.get(p.id) ?? 0 } : {}) }));
  }
  async getProduct(id: string, user: SessionUser) {
    const p = await this.prisma.db.product.findUnique({ where: { id }, include: { category: true, supplier: { select: { id: true, code: true, name: true } }, bundleComponents: { include: { component: { select: { id: true, sku: true, name: true } } } } } });
    if (!p) throw new NotFoundException();
    if (user.roleKey.startsWith('FRANCHISE') && !p.franchiseVisible) throw new ForbiddenException();
    const prices = await this.prisma.db.priceList.findMany({ where: { productId: id }, orderBy: [{ tier: 'asc' }, { effectiveFrom: 'desc' }] });
    const costs = await this.prisma.db.productCost.findMany({ where: { productId: id }, orderBy: { effectiveFrom: 'desc' } });
    return { ...p, tierPrices: (await this.currentPrices([id])).get(id) ?? {}, priceHistory: prices.map((r) => ({ tier: r.tier, price: r.price, effectiveFrom: dateStr(r.effectiveFrom), approvedBy: r.approvedBy })), costHistory: costs.map((c) => ({ cost: c.cost, effectiveFrom: dateStr(c.effectiveFrom), approvedBy: c.approvedBy })), cost: costs[0]?.cost ?? null };
  }
  async createProduct(data: { sku?: string; barcode?: string; name: string; categoryId: string; brand?: string; unit?: string; supplierId?: string; trackExpiry?: boolean; isBundle?: boolean; franchiseVisible?: boolean; components?: { componentProductId: string; qty: number }[]; prices?: Record<string, number>; cost?: number }, actorId: string) {
    const sku = data.sku ?? (await this.nextSku());
    const { components, prices, cost, ...rest } = data;
    const p = await this.prisma.db.$transaction(async (tx) => {
      const prod = await tx.product.create({ data: { ...rest, sku, createdBy: actorId, bundleComponents: components ? { create: components } : undefined } });
      const today = todayManila();
      for (const [tier, price] of Object.entries(prices ?? {})) await tx.priceList.create({ data: { productId: prod.id, tier, effectiveFrom: today, price: D(price).toFixed(2), createdBy: actorId, approvedBy: actorId } });
      if (cost != null) await tx.productCost.create({ data: { productId: prod.id, effectiveFrom: today, cost: D(cost).toFixed(2), createdBy: actorId, approvedBy: actorId } });
      return prod;
    });
    await this.audit.log({ action: 'CREATE', entityType: 'Product', entityId: p.id, after: p });
    await this.priceUpdates.announce([...Object.entries(prices ?? {}).map(([tier, v]) => ({ productId: p.id, productName: p.name, tier, newValue: v })), ...(cost != null ? [{ productId: p.id, productName: p.name, tier: null, newValue: cost }] : [])], { source: 'NEW_PRODUCT', link: `/products/${p.id}` });
    return p;
  }
  async updateProduct(id: string, data: Prisma.ProductUncheckedUpdateInput, actorId: string) {
    const before = await this.prisma.db.product.findUniqueOrThrow({ where: { id } });
    const after = await this.prisma.db.product.update({ where: { id }, data: { ...data, updatedBy: actorId } });
    await this.audit.log({ action: 'UPDATE', entityType: 'Product', entityId: id, before, after });
    return after;
  }
  async nextSku(): Promise<string> {
    const last = await this.prisma.db.product.findFirst({ where: { sku: { startsWith: 'GWS-' } }, orderBy: { sku: 'desc' }, select: { sku: true } });
    const n = last ? parseInt(last.sku.slice(4), 10) + 1 : 1;
    return `GWS-${String(n).padStart(6, '0')}`;
  }

  // ── Pricing ──
  /**
   * Credit-card price from the SRP (owner memo 2026-09-21): GROSS_UP recovers the card fee from the price (SRP ÷ (1 − 4%), so ₱1,250 → ₱1,302.08);
   * ADD is SRP + 4%. Kept to the centavo, never rounded to the peso. A price typed for CC on a product wins.
   */
  static ccFromSrp(srp: Prisma.Decimal.Value, pct: number, method: string): Prisma.Decimal {
    const r = D(srp);
    return (method === 'ADD' ? r.mul(D(1).plus(D(pct).div(100))) : r.div(D(1).minus(D(pct).div(100)))).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }
  private async ccSettings() { return { pct: Number(await this.settings.get<number>('pricing.cc_markup_pct')), method: String(await this.settings.get<string>('pricing.cc_method')) }; }

  /** Price in effect = latest effective_from <= date (§4.2). */
  async priceFor(productId: string, tier: string, date: Date = todayManila(), tx: Tx | null = null): Promise<Prisma.Decimal | null> {
    const db = (tx ?? this.prisma.db);
    const row = await db.priceList.findFirst({ where: { productId, tier, effectiveFrom: { lte: date } }, orderBy: { effectiveFrom: 'desc' } });
    if (row) return row.price;
    if (tier === 'AGENT') return this.priceFor(productId, 'DEALER', date, tx); // §18.9 agent defaults to dealer price
    if (tier === 'LAZADA') return this.priceFor(productId, 'SHOPEE', date, tx); // Lazada follows Shopee until it has its own list
    if (tier === 'CC') { const srp = await this.priceFor(productId, 'RETAIL', date, tx); if (!srp) return null; const c = await this.ccSettings(); return MasterService.ccFromSrp(srp, c.pct, c.method); }
    return null;
  }
  async costFor(productId: string, date: Date = todayManila(), tx: Tx | null = null): Promise<Prisma.Decimal | null> {
    const db = (tx ?? this.prisma.db);
    const row = await db.productCost.findFirst({ where: { productId, effectiveFrom: { lte: date } }, orderBy: { effectiveFrom: 'desc' } });
    return row?.cost ?? null;
  }
  async currentPrices(productIds: string[], date: Date = todayManila()): Promise<Map<string, Record<string, string>>> {
    if (!productIds.length) return new Map();
    const rows = await this.prisma.db.$queryRaw<{ product_id: string; tier: string; price: Prisma.Decimal }[]>`
      SELECT DISTINCT ON (product_id, tier) product_id, tier, price FROM price_lists
      WHERE product_id IN (${Prisma.join(productIds)}) AND effective_from <= ${date}::date
      ORDER BY product_id, tier, effective_from DESC`;
    const map = new Map<string, Record<string, string>>();
    for (const r of rows) { const m = map.get(r.product_id) ?? {}; m[r.tier] = r.price.toString(); map.set(r.product_id, m); }
    const cc = await this.ccSettings();
    for (const [, m] of map) {
      if (m.AGENT == null && m.DEALER != null) m.AGENT = m.DEALER;
      if (m.LAZADA == null && m.SHOPEE != null) m.LAZADA = m.SHOPEE;
      if (m.CC == null && m.RETAIL != null) m.CC = MasterService.ccFromSrp(m.RETAIL, cc.pct, cc.method).toFixed(2);
    }
    return map;
  }
  async currentCosts(productIds: string[], date: Date = todayManila()): Promise<Map<string, string>> {
    if (!productIds.length) return new Map();
    const rows = await this.prisma.db.$queryRaw<{ product_id: string; cost: Prisma.Decimal }[]>`
      SELECT DISTINCT ON (product_id) product_id, cost FROM product_costs
      WHERE product_id IN (${Prisma.join(productIds)}) AND effective_from <= ${date}::date
      ORDER BY product_id, effective_from DESC`;
    return new Map(rows.map((r) => [r.product_id, r.cost.toString()]));
  }
  listTiers() { return this.prisma.db.priceTier.findMany({ orderBy: { sortOrder: 'asc' } }); }
  async addTier(key: string, name: string) {
    if (!/^[A-Z_0-9]+$/.test(key)) throw new BadRequestException('Tier key must be UPPER_SNAKE');
    const n = await this.prisma.db.priceTier.count();
    return this.prisma.db.priceTier.create({ data: { key, name, sortOrder: n + 1 } });
  }

  // ── Min stock ──
  listMinStock(locationId?: string) { return this.prisma.db.minStockLevel.findMany({ where: locationId ? { locationId } : { locationId: { not: '' } }, include: { product: { select: { sku: true, name: true } }, location: { select: { code: true, name: true } } } }); }
  async setMinStock(rows: { productId: string; locationId: string; minQty: number }[], actorId: string) {
    await this.prisma.db.$transaction(rows.map((r) => this.prisma.db.minStockLevel.upsert({ where: { productId_locationId: { productId: r.productId, locationId: r.locationId } }, create: { ...r, updatedBy: actorId }, update: { minQty: r.minQty, updatedBy: actorId } })));
    await this.audit.log({ action: 'UPDATE', entityType: 'MinStockLevel', after: rows });
    return { count: rows.length };
  }

  // ── Customers / agents / riders ──
  listCustomers(type?: string) { return this.prisma.db.customer.findMany({ where: type ? { type: type as never, active: true } : { active: true }, orderBy: { name: 'asc' } }); }
  async createCustomer(data: { name: string; type: 'DEALER' | 'FRANCHISE' | 'AGENT' | 'CONSIGNEE' | 'CUSTOMER'; locationId?: string; agentId?: string; contact?: string }, actorId: string) {
    return this.prisma.db.customer.create({ data: { ...data, code: await this.nextCode('customer', 'CUS-', 4), createdBy: actorId } });
  }
  listAgents(user: SessionUser) { return this.prisma.db.agent.findMany({ where: user.locationScoped ? { locationId: { in: user.locationIds }, active: true } : { active: true }, include: { location: { select: { code: true, name: true } } }, orderBy: { name: 'asc' } }); }
  createAgent(data: { name: string; locationId: string; onPayroll?: boolean; defaultTier?: string }) { return this.prisma.db.agent.create({ data }); }
  listRiders(user: SessionUser, locationId?: string) { return this.prisma.db.rider.findMany({ where: { active: true, locationId: locationId ?? (user.locationScoped ? { in: user.locationIds } : undefined) }, orderBy: { name: 'asc' } }); }
  createRider(data: { name: string; locationId: string }) { return this.prisma.db.rider.create({ data }); }

  /**
   * Delete master data (owner request 2026-09-26, Owner only). An item never used in any transaction is removed; one that was
   * used is archived (inactive) so past documents and reports stay correct.
   */
  async remove(kind: 'product' | 'supplier' | 'customer' | 'agent' | 'rider' | 'category' | 'location', id: string, actorId: string) {
    const db = this.prisma.db;
    const before = await (db[kind] as unknown as { findUnique: (a: object) => Promise<Record<string, unknown> | null> }).findUnique({ where: { id } });
    if (!before) throw new NotFoundException();
    try {
      await db.$transaction(async (tx) => {
        if (kind === 'product') {
          // a product's own setup rows go with it; anything transactional blocks the delete
          await tx.priceList.deleteMany({ where: { productId: id } });
          await tx.productCost.deleteMany({ where: { productId: id } });
          await tx.minStockLevel.deleteMany({ where: { productId: id } });
          await tx.bundleComponent.deleteMany({ where: { bundleProductId: id } });
        }
        await (tx[kind] as unknown as { delete: (a: object) => Promise<unknown> }).delete({ where: { id } });
      });
      await this.audit.log({ action: 'DELETE', entityType: kind, entityId: id, before, userId: actorId });
      return { deleted: true, archived: false, message: 'Deleted.' };
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || !['P2003', 'P2014'].includes(e.code)) throw e;
      if (kind === 'category') throw new BadRequestException('This category still has products; move them to another category first');
      await (db[kind] as unknown as { update: (a: object) => Promise<unknown> }).update({ where: { id }, data: { active: false } });
      await this.audit.log({ action: 'ARCHIVE', entityType: kind, entityId: id, before, after: { active: false }, userId: actorId });
      return { deleted: false, archived: true, message: 'It is used in past transactions, so it was archived (hidden from new entries) instead of deleted.' };
    }
  }

  /** Next free code after the highest number used (a count breaks once codes are imported or skipped). */
  private async nextCode(model: 'supplier' | 'customer', prefix: string, width: number) {
    const rows = await (this.prisma.db[model] as unknown as { findMany: (a: object) => Promise<{ code: string }[]> }).findMany({ where: { code: { startsWith: prefix } }, select: { code: true } });
    const max = rows.reduce((m, r) => Math.max(m, Number(r.code.slice(prefix.length)) || 0), 0);
    return `${prefix}${String(max + 1).padStart(width, '0')}`;
  }
  parseDate(s?: string) { return s ? toDateOnly(s) : todayManila(); }
}
