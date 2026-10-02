import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../common/settings.service';
import { MasterService } from '../master/master.service';
import { addMonths, todayManila, dateStr, daysBetween } from '../common/manila';
import { D, ZERO } from '../common/money';
import type { SessionUser } from '../common/request-context';

export interface DaysRow { location: { id: string; name: string }; product: { id: string; sku: string; name: string; brand: string | null }; onHand: number; sold: number; avgPerDay: number; daysLeft: number | null; level: string; runsOutOn: string | null; suggestedQty: number; warehouseAvailable: number; asked: number }

/** §7.5 minimum stock and §7.6 expiry alerts. Runs nightly and (min stock) after ledger posts. */
@Injectable()
export class AlertsService {
  private log = new Logger('Alerts');
  constructor(private prisma: PrismaService, private notify: NotificationsService, private settings: SettingsService, private master: MasterService) {}

  /** Products at or under min per location. */
  async criticalStock(user?: SessionUser, locationId?: string) {
    const mins = await this.prisma.db.minStockLevel.findMany({ where: { locationId: locationId ?? (user?.locationScoped ? { in: user.locationIds } : { not: '' }) }, include: { product: { select: { id: true, sku: true, name: true } }, location: { select: { id: true, code: true, name: true } } } });
    if (!mins.length) return [];
    const balances = await this.prisma.db.stockBalance.groupBy({ by: ['locationId', 'productId'], where: { OR: mins.map((m) => ({ locationId: m.locationId, productId: m.productId })) }, _sum: { qty: true } });
    const wh = await this.prisma.db.location.findFirst({ where: { type: 'WAREHOUSE' } });
    const whAvail = wh ? await this.prisma.db.stockBalance.groupBy({ by: ['productId'], where: { locationId: wh.id, productId: { in: mins.map((m) => m.productId) } }, _sum: { qty: true } }) : [];
    return mins.map((m) => { const onHand = balances.find((b) => b.locationId === m.locationId && b.productId === m.productId)?._sum.qty ?? 0; return { location: m.location, product: m.product, minQty: m.minQty, onHand, shortBy: Math.max(0, m.minQty - onHand), warehouseAvailable: whAvail.find((w) => w.productId === m.productId)?._sum.qty ?? 0 }; }).filter((r) => r.onHand <= r.minQty);
  }
  async runMinStock() {
    const rows = await this.criticalStock();
    let sent = 0;
    for (const r of rows) {
      const refKey = `${r.location.id}:${r.product.id}`;
      const st = await this.prisma.db.alertState.findUnique({ where: { kind_refKey: { kind: 'MIN_STOCK', refKey } } });
      if (st && daysBetween(st.lastSentAt, new Date()) < 1) continue;
      await this.notify.toLocation(r.location.id, { type: 'CRITICAL_STOCK', title: `Critical stock: ${r.product.name} at ${r.location.name} (${r.onHand}/${r.minQty})`, link: `/stock?locationId=${r.location.id}` }, ['ADMIN', 'HEAD_AUDITOR']);
      await this.prisma.db.alertState.upsert({ where: { kind_refKey: { kind: 'MIN_STOCK', refKey } }, create: { kind: 'MIN_STOCK', refKey, lastSentAt: new Date() }, update: { lastSentAt: new Date() } });
      sent++;
    }
    return { critical: rows.length, notified: sent };
  }

  /** Expiring stock buckets: expired / <1 mo / 1–3 mo / 3–6 mo with qty and value (cost redacted by interceptor; SRP value for branch users). */
  async expiring(user?: SessionUser, locationId?: string) {
    const today = todayManila();
    const rows = await this.prisma.db.stockBalance.findMany({ where: { qty: { gt: 0 }, batch: { expiryDate: { not: null, lte: addMonths(today, 6) } }, locationId: locationId ?? (user?.locationScoped ? { in: user.locationIds } : { not: '' }) }, include: { batch: true, product: { select: { id: true, sku: true, name: true } }, location: { select: { id: true, code: true, name: true } } } });
    const prices = await this.master.currentPrices(rows.map((r) => r.productId));
    const bucket = (exp: Date) => (exp < today ? 'EXPIRED' : exp < addMonths(today, 1) ? 'LT_1M' : exp < addMonths(today, 3) ? 'M1_3' : 'M3_6');
    const items = rows.map((r) => ({ location: r.location, product: r.product, batchId: r.batchId, batchNo: r.batch.batchNo, expiryDate: dateStr(r.batch.expiryDate!), bucket: bucket(r.batch.expiryDate!), qty: r.qty, valueAtCost: r.batch.unitCost.mul(r.qty), valueAtSrp: D(prices.get(r.productId)?.RETAIL ?? 0).mul(r.qty) }));
    const summary = ['EXPIRED', 'LT_1M', 'M1_3', 'M3_6'].map((b) => { const xs = items.filter((i) => i.bucket === b); return { bucket: b, qty: xs.reduce((s, i) => s + i.qty, 0), valueAtCost: xs.reduce((s, i) => s.plus(i.valueAtCost), ZERO), valueAtSrp: xs.reduce((s, i) => s.plus(i.valueAtSrp), ZERO) }; });
    return { summary, items };
  }
  /** T-6m first notice, then on the 1st of each month, then daily once expired (§7.6). */
  async runExpiry() {
    const today = todayManila();
    const firstOfMonth = today.getUTCDate() === 1;
    const { items } = await this.expiring();
    const byBatchLoc = new Map<string, typeof items>();
    for (const i of items) { const k = `${i.location.id}:${i.batchId}`; byBatchLoc.set(k, [...(byBatchLoc.get(k) ?? []), i]); }
    let sent = 0;
    for (const [refKey, xs] of byBatchLoc) {
      const i = xs[0];
      const expired = i.bucket === 'EXPIRED';
      const st6 = await this.prisma.db.alertState.findUnique({ where: { kind_refKey: { kind: 'EXPIRY_T6', refKey } } });
      const stM = await this.prisma.db.alertState.findUnique({ where: { kind_refKey: { kind: 'EXPIRY_MONTHLY', refKey } } });
      const stE = await this.prisma.db.alertState.findUnique({ where: { kind_refKey: { kind: 'EXPIRED', refKey } } });
      let kind: string | null = null;
      if (expired && (!stE || daysBetween(stE.lastSentAt, new Date()) >= 1)) kind = 'EXPIRED';
      else if (!expired && !st6) kind = 'EXPIRY_T6';
      else if (!expired && firstOfMonth && (!stM || stM.lastSentAt.getUTCMonth() !== today.getUTCMonth())) kind = 'EXPIRY_MONTHLY';
      if (!kind) continue;
      const title = expired ? `EXPIRED: ${i.product.name} batch ${i.batchNo ?? ''} at ${i.location.name} (${i.qty} on hand)` : `Expiring ${i.expiryDate}: ${i.product.name} batch ${i.batchNo ?? ''} at ${i.location.name} (${i.qty})`;
      await this.notify.toLocation(i.location.id, { type: kind, title, link: `/expiry?locationId=${i.location.id}` }, ['ADMIN', 'HEAD_AUDITOR', 'EXTERNAL_AUDITOR']);
      await this.prisma.db.alertState.upsert({ where: { kind_refKey: { kind, refKey } }, create: { kind, refKey, lastSentAt: new Date() }, update: { lastSentAt: new Date() } });
      sent++;
    }
    return { batches: byBatchLoc.size, notified: sent };
  }
  /** Suggested restock (§7.5). */
  suggestedRestock(user: SessionUser, locationId?: string) { return this.criticalStock(user, locationId); }
  /** Slow-moving report: no sales in N days (§7.8). */
  async slowMoving(user: SessionUser, days = 60, locationId?: string) {
    const since = new Date(Date.now() - days * 86400000);
    const loc = locationId ?? (user.locationScoped ? user.locationIds[0] : undefined);
    const balances = await this.prisma.db.stockBalance.groupBy({ by: ['productId', 'locationId'], where: { qty: { gt: 0 }, locationId: loc ? loc : { not: '' } }, _sum: { qty: true } });
    const sold = await this.prisma.db.stockLedger.groupBy({ by: ['productId', 'locationId'], where: { movementType: 'SALE', postedAt: { gte: since }, locationId: loc ? loc : { not: '' } } });
    const soldSet = new Set(sold.map((s) => `${s.locationId}:${s.productId}`));
    const slow = balances.filter((b) => !soldSet.has(`${b.locationId}:${b.productId}`));
    const products = await this.prisma.db.product.findMany({ where: { id: { in: slow.map((s) => s.productId) } }, select: { id: true, sku: true, name: true } });
    const locations = await this.prisma.db.location.findMany({ where: { id: { in: slow.map((s) => s.locationId) } }, select: { id: true, name: true } });
    return slow.map((s) => ({ product: products.find((p) => p.id === s.productId), location: locations.find((l) => l.id === s.locationId), qty: s._sum.qty ?? 0, days }));
  }

  /**
   * Days of stock left per item (owner request 2026-10-02): on hand ÷ average daily sales over the last `days` days (sales net of returns,
   * plus the warehouse's e-commerce pull-outs). Most critical first: out of stock but selling, then fewest days left; items with stock
   * and no sales last. `combine` adds all the locations together (company-wide). Needs no cost.
   */
  async daysOfStock(user: SessionUser, q: { days?: number; cover?: number; locationId?: string; combine?: boolean }) {
    const days = Math.min(365, Math.max(7, Math.round(q.days ?? 30))); const cover = Math.min(365, Math.max(1, Math.round(q.cover ?? 30)));
    const today = todayManila(); const from = new Date(today.getTime() - (days - 1) * 86400000);
    const locFilter: { type: { in: ('WAREHOUSE' | 'BRANCH' | 'FRANCHISE')[] }; id?: string | { in: string[] } } = { type: { in: ['WAREHOUSE', 'BRANCH', 'FRANCHISE'] } };
    if (q.locationId) locFilter.id = q.locationId; else if (user.locationScoped) locFilter.id = { in: user.locationIds };
    const locations = await this.prisma.db.location.findMany({ where: { ...locFilter, active: true }, select: { id: true, name: true, type: true } });
    const ids = locations.map((l) => l.id);
    const [bal, sold, ecomDocs] = await Promise.all([
      this.prisma.db.stockBalance.groupBy({ by: ['locationId', 'productId'], where: { locationId: { in: ids } }, _sum: { qty: true } }),
      this.prisma.db.stockLedger.groupBy({ by: ['locationId', 'productId'], where: { locationId: { in: ids }, movementType: { in: ['SALE', 'SALE_RETURN'] }, businessDate: { gte: from, lte: today } }, _sum: { qtyDelta: true } }),
      this.prisma.db.transferDoc.findMany({ where: { transferType: 'ECOMMERCE', fromLocationId: { in: ids }, docDate: { gte: from, lte: today } }, select: { id: true } }),
    ]);
    const ecom = ecomDocs.length ? await this.prisma.db.stockLedger.groupBy({ by: ['locationId', 'productId'], where: { locationId: { in: ids }, movementType: 'TRANSFER_OUT', documentType: 'TransferDoc', documentId: { in: ecomDocs.map((d) => d.id) } }, _sum: { qtyDelta: true } }) : [];
    type Acc = { locationId: string; productId: string; onHand: number; sold: number };
    const map = new Map<string, Acc>();
    const key = (l: string, p: string) => (q.combine ? p : `${l}:${p}`);
    const at = (l: string, p: string) => { const k = key(l, p); let a = map.get(k); if (!a) { a = { locationId: q.combine ? '' : l, productId: p, onHand: 0, sold: 0 }; map.set(k, a); } return a; };
    for (const b of bal) at(b.locationId, b.productId).onHand += b._sum.qty ?? 0;
    for (const x of sold) at(x.locationId, x.productId).sold += -(x._sum.qtyDelta ?? 0);
    for (const x of ecom) at(x.locationId, x.productId).sold += -(x._sum.qtyDelta ?? 0);
    const rows = [...map.values()].filter((a) => a.onHand > 0 || a.sold > 0);
    const products = await this.prisma.db.product.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.productId))] }, active: true }, select: { id: true, sku: true, name: true, brand: true } });
    const wh = locations.find((l) => l.type === 'WAREHOUSE') ?? (await this.prisma.db.location.findFirst({ where: { type: 'WAREHOUSE' }, select: { id: true, name: true, type: true } }));
    const whAvail = wh ? await this.prisma.db.stockBalance.groupBy({ by: ['productId'], where: { locationId: wh.id, productId: { in: products.map((p) => p.id) } }, _sum: { qty: true } }) : [];
    // customers who asked for the item and it was not available (counter's lost-sale log, owner request 2026-10-06)
    const askedBy = new Map((await this.prisma.db.lostSale.groupBy({ by: ['productId'], where: { productId: { in: products.map((p) => p.id) }, createdAt: { gte: from } }, _sum: { qty: true } })).map((x) => [x.productId, x._sum.qty ?? 0]));
    const out: DaysRow[] = [];
    for (const r of rows) {
      const p = products.find((x) => x.id === r.productId); if (!p) continue;
      const net = Math.max(0, r.sold); const avg = net / days;
      const daysLeft = avg > 0 ? Math.round((r.onHand / avg) * 10) / 10 : null;
      const level = r.onHand <= 0 && net > 0 ? 'OUT' : daysLeft == null ? 'NO_SALES' : daysLeft <= 7 ? 'CRITICAL' : daysLeft <= 14 ? 'LOW' : daysLeft <= 30 ? 'WATCH' : 'OK';
      const loc = q.combine ? null : locations.find((l) => l.id === r.locationId);
      out.push({ location: loc ? { id: loc.id, name: loc.name } : { id: '', name: 'All locations' }, product: p, onHand: r.onHand, sold: net, avgPerDay: Math.round(avg * 100) / 100, daysLeft, level, runsOutOn: daysLeft != null && r.onHand > 0 ? dateStr(new Date(today.getTime() + Math.floor(daysLeft) * 86400000)) : null, suggestedQty: avg > 0 ? Math.max(0, Math.ceil(avg * cover - r.onHand)) : 0, warehouseAvailable: whAvail.find((w) => w.productId === r.productId)?._sum.qty ?? 0, asked: askedBy.get(r.productId) ?? 0 });
    }
    // most critical first: out of stock but selling, then the fewest days left; no sales last
    const rank = (x: DaysRow) => (x.level === 'OUT' ? -1 : x.daysLeft ?? Number.MAX_SAFE_INTEGER);
    out.sort((a, b) => rank(a) - rank(b) || b.avgPerDay - a.avgPerDay || a.product.name.localeCompare(b.product.name));
    return { days, cover, combine: !!q.combine, rows: out, counts: { OUT: out.filter((x) => x.level === 'OUT').length, CRITICAL: out.filter((x) => x.level === 'CRITICAL').length, LOW: out.filter((x) => x.level === 'LOW').length, WATCH: out.filter((x) => x.level === 'WATCH').length } };
  }
  /** Stock ageing by batch. */
  async stockAgeing(user: SessionUser, locationId?: string) {
    const rows = await this.prisma.db.stockBalance.findMany({ where: { qty: { gt: 0 }, locationId: locationId ?? (user.locationScoped ? { in: user.locationIds } : { not: '' }) }, include: { batch: true, product: { select: { sku: true, name: true } }, location: { select: { name: true } } } });
    return rows.map((r) => ({ location: r.location.name, product: r.product, batchNo: r.batch.batchNo, receivedAt: r.batch.createdAt, ageDays: daysBetween(r.batch.createdAt, new Date()), expiryDate: r.batch.expiryDate, qty: r.qty, unitCost: r.batch.unitCost, valueAtCost: r.batch.unitCost.mul(r.qty) }));
  }
}
