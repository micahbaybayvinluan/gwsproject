import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { MasterService } from '../master/master.service';
import { dateStr, daysBetween, todayManila, toDateOnly } from '../common/manila';
import { PLATFORMS, PLATFORM_INFO, type Platform } from './ecom-files';

const num = (x: Prisma.Decimal.Value | null | undefined) => Number(x ?? 0);
/** Kept to the centavo, never rounded to the peso (owner request 2026-09-30). */
const c2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface AnalysisInput { from: string; to: string; target?: number; /** what-if fee rates (% of net sales) used when the period has no posted payout, or to test a change */ commissionPct?: number; transactionPct?: number; affiliatePct?: number; shippingPerOrder?: number; adPctOfSales?: number }

/**
 * The Owner's e-commerce margin tool (owner request 2026-09-30). From the posted payouts it shows, per platform, every fee and charge and the ads, the contribution
 * after cost of goods, and whether the current platform prices keep the target margin; for each product sold it shows the margin at the platform price and the price
 * that would restore the target margin. Fee rates are the platform's actual ones (fees ÷ net sales in the period); with no payout yet, or to test a change,
 * the Owner can type the rates. Every amount keeps its centavos.
 */
@Injectable()
export class EcomAnalysisService {
  constructor(private prisma: PrismaService, private settings: SettingsService, private master: MasterService) {}

  async targetMargin() { return Number((await this.settings.get<number>('ecom.target_margin_pct')) ?? 20); }
  async setTargetMargin(pct: number, userId: string) { if (!(pct >= 0 && pct < 90)) throw new BadRequestException('Target margin is a percent from 0 to 90'); await this.settings.set('ecom.target_margin_pct', pct, userId); return { pct }; }

  async analyse(q: AnalysisInput) {
    const from = toDateOnly(q.from), to = toDateOnly(q.to);
    if (daysBetween(from, to) < 0) throw new BadRequestException('The start date is after the end date');
    const target = q.target ?? (await this.targetMargin());
    const today = todayManila();
    const setts = await this.prisma.db.ecomSettlement.findMany({ where: { status: 'POSTED', docDate: { gte: from, lte: to } } });
    const ads = await this.prisma.db.ecomAdSpend.findMany({ where: { month: { gte: q.from.slice(0, 7), lte: q.to.slice(0, 7) } } });
    const out = [];
    for (const p of PLATFORMS as readonly Platform[]) {
      const mine = setts.filter((s) => s.platform === p);
      const s = (k: 'grossSales' | 'sellerDiscounts' | 'commission' | 'transactionFee' | 'shippingFee' | 'affiliateFee' | 'otherFees' | 'refunds' | 'withholdingTax' | 'adjustments' | 'payout' | 'costOfSales') => mine.reduce((t, x) => t + num(x[k]), 0);
      const orders = mine.reduce((t, x) => t + x.orders, 0);
      const gross = s('grossSales'), disc = s('sellerDiscounts'), net = gross - disc;
      const real = { commission: s('commission'), transactionFee: s('transactionFee'), shippingFee: s('shippingFee'), affiliateFee: s('affiliateFee'), otherFees: s('otherFees') - s('adjustments') };
      const refunds = s('refunds'), adSpend = ads.filter((a) => a.platform === p).reduce((t, a) => t + num(a.amount), 0), cogs = s('costOfSales');
      const hasData = net > 0;
      // rates: the platform's actual ones, or what the Owner typed
      const pct = (amount: number) => (net > 0 ? (amount / net) * 100 : 0);
      const rates = {
        commissionPct: q.commissionPct ?? c2(pct(real.commission)), transactionPct: q.transactionPct ?? c2(pct(real.transactionFee)), affiliatePct: q.affiliatePct ?? c2(pct(real.affiliateFee)),
        shippingPerOrder: q.shippingPerOrder ?? (orders ? c2(real.shippingFee / orders) : 0), otherPct: c2(pct(real.otherFees)), refundPct: c2(pct(refunds)), adPctOfSales: q.adPctOfSales ?? c2(pct(adSpend)),
      };
      const fees = real.commission + real.transactionFee + real.shippingFee + real.affiliateFee + real.otherFees;
      const afterFeesAndAds = net - refunds - fees - adSpend;
      const contribution = afterFeesAndAds - cogs;
      const marginPct = net > 0 ? c2((contribution / net) * 100) : null;
      // what price change would restore the target: % costs scale with the price, per-order shipping, ads and goods do not
      const variablePct = (real.commission + real.transactionFee + real.affiliateFee + real.otherFees + refunds) / (net || 1);
      const fixed = real.shippingFee + adSpend + cogs;
      let neededPriceChangePct: number | null = null; let impossible = false;
      if (hasData && marginPct != null && marginPct < target) {
        const room = 1 - variablePct - target / 100;
        if (room <= 0) impossible = true; else neededPriceChangePct = c2((fixed / (net * room) - 1) * 100);
      }
      // product by product at today's platform price
      const tier = p;
      const lines = await this.prisma.db.ecomOrderLine.findMany({ where: { order: { platform: p, status: 'SETTLED', settledAt: { gte: from, lte: new Date(to.getTime() + 86400000) } } }, select: { productId: true, qty: true } });
      const units = new Map<string, number>(); for (const l of lines) units.set(l.productId, (units.get(l.productId) ?? 0) + l.qty);
      const totalUnits = [...units.values()].reduce((t, x) => t + x, 0);
      const adPerUnit = totalUnits ? adSpend / totalUnits : 0;
      const feeRate = (rates.commissionPct + rates.transactionPct + rates.affiliatePct + rates.otherPct + rates.refundPct) / 100;
      const products = await this.prisma.db.product.findMany({ where: { id: { in: [...units.keys()] } }, select: { id: true, sku: true, name: true } });
      const rows = [];
      for (const pr of products) {
        const price = num(await this.master.priceFor(pr.id, tier, today)); const cost = num(await this.master.costFor(pr.id, today));
        if (!price) { rows.push({ productId: pr.id, sku: pr.sku, name: pr.name, units: units.get(pr.id) ?? 0, price: null, cost: cost ? c2(cost) : null, note: 'No platform price set' }); continue; }
        const perUnitShip = rates.shippingPerOrder; // one parcel per unit is the cautious reading
        const adUnit = q.adPctOfSales != null ? (price * q.adPctOfSales) / 100 : adPerUnit;
        const feeAmount = price * feeRate;
        const contributionUnit = price - feeAmount - perUnitShip - adUnit - cost;
        const margin = (contributionUnit / price) * 100;
        const denom = 1 - feeRate - target / 100;
        const suggested = denom > 0 ? (cost + perUnitShip + adUnit) / denom : null;
        rows.push({ productId: pr.id, sku: pr.sku, name: pr.name, units: units.get(pr.id) ?? 0, price: c2(price), cost: c2(cost), fees: c2(feeAmount), shipping: c2(perUnitShip), ads: c2(adUnit), contribution: c2(contributionUnit), marginPct: c2(margin), belowTarget: margin < target, suggestedPrice: suggested != null ? c2(suggested) : null, changePct: suggested != null && price ? c2(((suggested - price) / price) * 100) : null });
      }
      rows.sort((a, b) => Number((b as { belowTarget?: boolean }).belowTarget ?? false) - Number((a as { belowTarget?: boolean }).belowTarget ?? false) || ((a as { marginPct?: number }).marginPct ?? 0) - ((b as { marginPct?: number }).marginPct ?? 0));
      out.push({ platform: p, name: PLATFORM_INFO[p].name, hasData, orders, grossSales: c2(gross), sellerDiscounts: c2(disc), netSales: c2(net), refunds: c2(refunds),
        fees: { commission: c2(real.commission), transactionFee: c2(real.transactionFee), shippingFee: c2(real.shippingFee), affiliateFee: c2(real.affiliateFee), otherFees: c2(real.otherFees), total: c2(fees), pctOfNet: c2(pct(fees)) },
        ads: c2(adSpend), roas: adSpend ? c2(net / adSpend) : null, afterFeesAndAds: c2(afterFeesAndAds), costOfSales: c2(cogs), contribution: c2(contribution), marginPct, withholdingTax: c2(s('withholdingTax')), payout: c2(s('payout')),
        rates, targetPct: target, onTarget: marginPct != null ? marginPct >= target : null, neededPriceChangePct, impossible, products: rows });
    }
    return { from: dateStr(from), to: dateStr(to), targetPct: target, platforms: out };
  }
}
