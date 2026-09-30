import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../common/settings.service';
import { MasterService } from '../master/master.service';
import { addMonths, todayManila, dateStr, daysBetween } from '../common/manila';
import { D, ZERO } from '../common/money';
import type { SessionUser } from '../common/request-context';

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
  /** Stock ageing by batch. */
  async stockAgeing(user: SessionUser, locationId?: string) {
    const rows = await this.prisma.db.stockBalance.findMany({ where: { qty: { gt: 0 }, locationId: locationId ?? (user.locationScoped ? { in: user.locationIds } : { not: '' }) }, include: { batch: true, product: { select: { sku: true, name: true } }, location: { select: { name: true } } } });
    return rows.map((r) => ({ location: r.location.name, product: r.product, batchNo: r.batch.batchNo, receivedAt: r.batch.createdAt, ageDays: daysBetween(r.batch.createdAt, new Date()), expiryDate: r.batch.expiryDate, qty: r.qty, unitCost: r.batch.unitCost, valueAtCost: r.batch.unitCost.mul(r.qty) }));
  }
}
