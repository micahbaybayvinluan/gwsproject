import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { SettingsService } from '../common/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MasterService } from '../master/master.service';
import type { SessionUser } from '../common/request-context';
import { D } from '../common/money';
import { todayManila } from '../common/manila';
import { normName, parseEcomMasterlist } from './ecom-masterlist';

export const ECOM_TIERS = ['TIKTOK', 'SHOPEE', 'LAZADA', 'CC'] as const;
type EcomTier = (typeof ECOM_TIERS)[number];

/**
 * The prices online shoppers pay (owner request 2026-09-30): one list per platform, exactly as in the masterlist and edited only by the
 * Admin; and the credit-card price (SRP plus a percentage the Admin sets, 4% to start). Amounts are kept to the centavo, never rounded to the peso.
 */
@Injectable()
export class EcomPricesService {
  constructor(private prisma: PrismaService, private audit: AuditService, private settings: SettingsService, private notify: NotificationsService, private master: MasterService) {}

  async ccMarkup() { return { pct: Number(await this.settings.get<number>('pricing.cc_markup_pct')), method: String(await this.settings.get<string>('pricing.cc_method')) }; }
  async setCcMarkup(pct: number, method: string, user: SessionUser) {
    if (!(pct >= 0 && pct <= 50)) throw new BadRequestException('The credit-card markup must be between 0% and 50%');
    const before = await this.ccMarkup();
    if (!['GROSS_UP', 'ADD'].includes(method)) throw new BadRequestException('Method must be GROSS_UP or ADD');
    await this.settings.set('pricing.cc_markup_pct', pct, user.id); await this.settings.set('pricing.cc_method', method, user.id);
    await this.audit.log({ action: 'UPDATE', entityType: 'Setting', entityId: 'pricing.cc_markup_pct', before, after: { pct, method } });
    await this.notify.toRoles(['HEAD_AUDITOR', 'ACCOUNTING_HEAD', 'SALES_MANAGER'], { type: 'CC_PRICE_CHANGED', title: `Credit-card price is now ${method === 'ADD' ? `SRP + ${pct}%` : `SRP ÷ (1 − ${pct}%)`} (was ${before.pct}%), set by ${user.fullName}`, link: '/ecom-prices' });
    return { pct, method };
  }

  /** Every selling product with its SRP, credit-card price and the platform prices in force today. */
  async list(q?: string) {
    const products = await this.prisma.db.product.findMany({ where: { active: true, isBundle: false, category: { accountingClass: { in: ['SUPPLEMENT', 'APPAREL', 'EQUIPMENT', 'OTHER', 'REPACKED'] } }, ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { sku: { contains: q, mode: 'insensitive' } }] } : {}) }, select: { id: true, sku: true, name: true, brand: true }, orderBy: [{ brand: 'asc' }, { name: 'asc' }] });
    const prices = await this.master.currentPrices(products.map((p) => p.id));
    return products.map((p) => { const m = prices.get(p.id) ?? {}; return { ...p, retail: m.RETAIL ?? null, cc: m.CC ?? null, tiktok: m.TIKTOK ?? null, shopee: m.SHOPEE ?? null, lazada: m.LAZADA ?? null }; });
  }

  /** Set platform prices (today onward); an empty price removes the platform's own price (Lazada then follows Shopee). */
  async set(rows: { productId: string; tier: EcomTier; price: number | null }[], user: SessionUser) {
    const today = todayManila();
    let changed = 0;
    await this.prisma.db.$transaction(async (tx) => {
      for (const r of rows) {
        if (!ECOM_TIERS.includes(r.tier)) throw new BadRequestException(`Unknown price list ${r.tier}`);
        if (r.price != null && !(r.price > 0)) throw new BadRequestException('A price must be more than zero');
        const cur = await this.master.priceFor(r.productId, r.tier, today, tx as never);
        if (r.price == null) {
          const had = await tx.priceList.deleteMany({ where: { productId: r.productId, tier: r.tier, effectiveFrom: today } });
          if (had.count) changed++;
          continue;
        }
        if (cur && cur.equals(D(r.price)) && r.tier !== 'LAZADA' && r.tier !== 'CC') continue;
        await tx.priceList.upsert({ where: { productId_tier_effectiveFrom: { productId: r.productId, tier: r.tier, effectiveFrom: today } }, create: { productId: r.productId, tier: r.tier, effectiveFrom: today, price: D(r.price).toFixed(2), createdBy: user.id, approvedBy: user.id }, update: { price: D(r.price).toFixed(2), createdBy: user.id } });
        changed++;
      }
    });
    await this.audit.log({ action: 'UPDATE', entityType: 'PriceList', entityId: 'ecom', after: { rows: rows.length, changed } });
    if (changed) await this.notify.toRoles(['ECOMM_ASSOCIATE', 'HEAD_AUDITOR', 'ACCOUNTING_HEAD'], { type: 'ECOM_PRICE_CHANGED', title: `${user.fullName} updated ${changed} e-commerce price${changed === 1 ? '' : 's'}`, link: '/ecom-prices' });
    return { changed };
  }

  /** Read the masterlist workbook and set the TikTok and Shopee prices of every product it names; names it cannot find are listed back. */
  async importMasterlist(buf: Buffer, user: SessionUser) {
    const rows = await parseEcomMasterlist(buf);
    const res = await this.apply(rows, user);
    await this.audit.log({ action: 'IMPORT', entityType: 'PriceList', entityId: 'ecom-masterlist', after: { ...res, notFound: res.notFound.length } });
    return res;
  }

  async apply(rows: Awaited<ReturnType<typeof parseEcomMasterlist>>, user: SessionUser | null) {
    const products = await this.prisma.db.product.findMany({ select: { id: true, name: true } });
    const byName = new Map<string, string>(); for (const p of products) if (!byName.has(normName(p.name))) byName.set(normName(p.name), p.id);
    const sets: { productId: string; tier: EcomTier; price: number | null }[] = []; const notFound: string[] = []; let matched = 0;
    for (const r of rows) {
      const id = byName.get(normName(r.name));
      if (!id) { notFound.push(r.name); continue; }
      matched++;
      if (r.tiktok != null) sets.push({ productId: id, tier: 'TIKTOK', price: r.tiktok });
      if (r.shopee != null) sets.push({ productId: id, tier: 'SHOPEE', price: r.shopee });
    }
    if (user) { const { changed } = await this.set(sets, user); return { rows: rows.length, matched, changed, notFound }; }
    // seeding: no signed-in person
    const today = todayManila();
    for (const s of sets) await this.prisma.db.priceList.upsert({ where: { productId_tier_effectiveFrom: { productId: s.productId, tier: s.tier, effectiveFrom: today } }, create: { productId: s.productId, tier: s.tier, effectiveFrom: today, price: D(s.price!).toFixed(2) }, update: { price: D(s.price!).toFixed(2) } });
    return { rows: rows.length, matched, changed: sets.length, notFound };
  }
}
