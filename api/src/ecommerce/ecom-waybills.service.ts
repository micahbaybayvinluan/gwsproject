import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { SettingsService } from '../common/settings.service';
import { MasterService } from '../master/master.service';
import { XlsxService } from '../reports/xlsx.service';
import type { SessionUser } from '../common/request-context';
import { dateStr, todayManila, toDateOnly } from '../common/manila';
import { readWaybills } from './ecom-waybills';
import { PLATFORMS, PLATFORM_INFO, type Platform } from './ecom-files';

const c2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export interface FeeRates { commissionPct: number; transactionPct: number; affiliatePct: number; shippingPerOrder: number }
export interface WaybillRow { id: string; platform: string; platformName: string; orderId: string; trackingNo: string | null; qty: number; weightG: number | null; rtsDate: string | null; uploaded: string; sourceFile: string | null; product: { id: string; sku: string; name: string } | null; guessed: boolean; unitSrp: number | null; priceFrom: string | null; srp: number | null; commission: number | null; transactionFee: number | null; affiliateFee: number | null; shippingFee: number | null; fees: number | null; income: number | null }
const ZERO_RATES: FeeRates = { commissionPct: 0, transactionPct: 0, affiliatePct: 0, shippingPerOrder: 0 };
const rateKey = (p: string) => `ecom.waybill_rates.${p}`;

/**
 * Waybill report (owner request 2026-09-30): the E-comm Associate, Head Auditor or Owner uploads the shipping labels (PDF, one label per page).
 * Each label gives the order, tracking number, quantity and weight. The product is chosen once per label (and remembered for the same platform and weight),
 * then the report shows the SRP on that platform's price list, the platform fees at the platform's rates, and the order income. Amounts keep their centavos.
 */
@Injectable()
export class EcomWaybillsService {
  constructor(private prisma: PrismaService, private audit: AuditService, private settings: SettingsService, private master: MasterService, private xlsx: XlsxService) {}

  async upload(files: { buffer: Buffer; originalname: string }[], user: SessionUser) {
    if (!files.length) throw new BadRequestException('Choose the waybill PDF files');
    let added = 0, duplicates = 0, guessed = 0; const unreadable: { file: string; pages: number[] }[] = []; const failed: string[] = [];
    for (const f of files) {
      let res: Awaited<ReturnType<typeof readWaybills>>;
      try { res = await readWaybills(f.buffer); } catch { failed.push(f.originalname); continue; }
      if (res.unreadable.length) unreadable.push({ file: f.originalname, pages: res.unreadable });
      for (const w of res.waybills) {
        if (await this.prisma.db.ecomWaybill.findUnique({ where: { platform_orderId: { platform: w.platform, orderId: w.orderId } } })) { duplicates++; continue; }
        const hint = w.weightG != null ? await this.prisma.db.ecomWaybillHint.findUnique({ where: { platform_weightG: { platform: w.platform, weightG: w.weightG } } }) : null;
        await this.prisma.db.ecomWaybill.create({ data: { platform: w.platform, orderId: w.orderId, trackingNo: w.trackingNo, qty: w.qty, weightG: w.weightG, rtsDate: w.rtsDate ? toDateOnly(w.rtsDate) : null, productId: hint?.productId ?? null, guessed: !!hint, sourceFile: f.originalname, uploadedBy: user.id } });
        added++; if (hint) guessed++;
      }
    }
    await this.audit.log({ action: 'ECOM_WAYBILL_UPLOAD', entityType: 'EcomWaybill', entityId: 'batch', after: { files: files.map((f) => f.originalname), added, duplicates } });
    return { added, duplicates, guessed, unreadable, failed };
  }

  async rates(p: string): Promise<FeeRates> { return { ...ZERO_RATES, ...((await this.settings.get<Partial<FeeRates> | null>(rateKey(p))) ?? {}) }; }
  async setRates(p: string, r: FeeRates, userId: string) {
    if (!PLATFORMS.includes(p as Platform)) throw new BadRequestException('Unknown platform');
    for (const v of [r.commissionPct, r.transactionPct, r.affiliatePct]) if (!(v >= 0 && v < 100)) throw new BadRequestException('A fee rate is a percent from 0 to 100');
    if (!(r.shippingPerOrder >= 0)) throw new BadRequestException('Shipping cannot be negative');
    await this.settings.set(rateKey(p), r, userId);
    await this.audit.log({ action: 'UPDATE', entityType: 'Setting', entityId: rateKey(p), after: r });
    return r;
  }
  /** What the platform actually charged, from its posted payouts: a starting point for the rates. */
  async actualRates(p: string): Promise<(FeeRates & { basedOn: number }) | null> {
    const s = await this.prisma.db.ecomSettlement.findMany({ where: { platform: p, status: 'POSTED' } });
    const net = s.reduce((t, x) => t + Number(x.grossSales) - Number(x.sellerDiscounts), 0); const orders = s.reduce((t, x) => t + x.orders, 0);
    if (net <= 0) return null;
    const sum = (k: 'commission' | 'transactionFee' | 'affiliateFee' | 'shippingFee') => s.reduce((t, x) => t + Number(x[k]), 0);
    return { commissionPct: c2((sum('commission') / net) * 100), transactionPct: c2((sum('transactionFee') / net) * 100), affiliatePct: c2((sum('affiliateFee') / net) * 100), shippingPerOrder: orders ? c2(sum('shippingFee') / orders) : 0, basedOn: orders };
  }

  async list(q: { platform?: string; from?: string; to?: string; onlyOpen?: boolean }) {
    const from = q.from ? toDateOnly(q.from) : undefined; const to = q.to ? new Date(`${q.to}T23:59:59.999Z`) : undefined;
    const rows = await this.prisma.db.ecomWaybill.findMany({ where: { platform: q.platform || undefined, createdAt: from || to ? { gte: from, lte: to } : undefined, productId: q.onlyOpen ? null : undefined }, orderBy: [{ createdAt: 'desc' }, { orderId: 'asc' }], take: 2000 });
    const products = await this.prisma.db.product.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.productId).filter((x): x is string => !!x))] } }, select: { id: true, sku: true, name: true } });
    const rateOf = new Map<string, FeeRates>(); const today = todayManila();
    const out: WaybillRow[] = [];
    for (const r of rows) {
      if (!rateOf.has(r.platform)) rateOf.set(r.platform, await this.rates(r.platform));
      const rt = rateOf.get(r.platform)!; const prod = products.find((p) => p.id === r.productId) ?? null;
      let unit: number | null = null; let from2: string | null = null;
      if (prod) {
        const own = r.platform !== 'UNKNOWN' ? await this.master.priceFor(prod.id, r.platform, today) : null;
        if (own) { unit = Number(own); from2 = r.platform; } else { const retail = await this.master.priceFor(prod.id, 'RETAIL', today); if (retail) { unit = Number(retail); from2 = 'RETAIL'; } }
      }
      const srp = unit != null ? c2(unit * r.qty) : null;
      const commission = srp != null ? c2((srp * rt.commissionPct) / 100) : null, transaction = srp != null ? c2((srp * rt.transactionPct) / 100) : null, affiliate = srp != null ? c2((srp * rt.affiliatePct) / 100) : null;
      const shipping = srp != null ? c2(rt.shippingPerOrder) : null;
      const fees = srp != null ? c2(commission! + transaction! + affiliate! + shipping!) : null;
      out.push({ id: r.id, platform: r.platform, platformName: r.platform === 'UNKNOWN' ? 'Unknown' : PLATFORM_INFO[r.platform as Platform].name, orderId: r.orderId, trackingNo: r.trackingNo, qty: r.qty, weightG: r.weightG, rtsDate: r.rtsDate ? dateStr(r.rtsDate) : null, uploaded: dateStr(r.createdAt), sourceFile: r.sourceFile,
        product: prod, guessed: r.guessed, unitSrp: unit, priceFrom: from2, srp, commission, transactionFee: transaction, affiliateFee: affiliate, shippingFee: shipping, fees, income: srp != null ? c2(srp - fees!) : null });
    }
    const priced = out.filter((x) => x.srp != null);
    const sum = (f: (x: (typeof out)[number]) => number | null) => c2(priced.reduce((t, x) => t + (f(x) ?? 0), 0));
    const byPlatform = [...new Set(out.map((x) => x.platform))].map((p) => { const mine = priced.filter((x) => x.platform === p); const s = (f: (x: (typeof out)[number]) => number | null) => c2(mine.reduce((t, x) => t + (f(x) ?? 0), 0)); return { platform: p, name: out.find((x) => x.platform === p)!.platformName, waybills: out.filter((x) => x.platform === p).length, priced: mine.length, srp: s((x) => x.srp), fees: s((x) => x.fees), income: s((x) => x.income) }; });
    const rateRows = []; for (const p of PLATFORMS) rateRows.push({ platform: p, name: PLATFORM_INFO[p].name, rates: await this.rates(p), actual: await this.actualRates(p) });
    return { rows: out, totals: { waybills: out.length, priced: priced.length, unassigned: out.length - priced.length, srp: sum((x) => x.srp), commission: sum((x) => x.commission), transactionFee: sum((x) => x.transactionFee), affiliateFee: sum((x) => x.affiliateFee), shippingFee: sum((x) => x.shippingFee), fees: sum((x) => x.fees), income: sum((x) => x.income) }, byPlatform, rates: rateRows };
  }

  async update(id: string, input: { productId?: string | null; qty?: number }) {
    const w = await this.prisma.db.ecomWaybill.findUnique({ where: { id } });
    if (!w) throw new NotFoundException();
    const data: { productId?: string | null; qty?: number; guessed?: boolean } = {};
    if (input.qty != null) { if (!Number.isInteger(input.qty) || input.qty < 1 || input.qty > 999) throw new BadRequestException('Quantity is a whole number from 1'); data.qty = input.qty; }
    if (input.productId !== undefined) {
      if (input.productId) {
        if (!(await this.prisma.db.product.findUnique({ where: { id: input.productId }, select: { id: true } }))) throw new BadRequestException('Product not found');
        if (w.weightG != null && w.platform !== 'UNKNOWN') await this.prisma.db.ecomWaybillHint.upsert({ where: { platform_weightG: { platform: w.platform, weightG: w.weightG } }, create: { platform: w.platform, weightG: w.weightG, productId: input.productId }, update: { productId: input.productId } });
      }
      data.productId = input.productId; data.guessed = false;
    } else if (w.guessed && input.qty != null) data.guessed = false;
    await this.prisma.db.ecomWaybill.update({ where: { id }, data });
    return { ok: true };
  }
  /** One press to confirm every remembered (guessed) product of the current list. */
  async confirmGuessed(ids: string[]) { const r = await this.prisma.db.ecomWaybill.updateMany({ where: { id: { in: ids }, guessed: true }, data: { guessed: false } }); return { confirmed: r.count }; }
  async remove(id: string) { await this.prisma.db.ecomWaybill.delete({ where: { id } }); return { ok: true }; }

  async export(q: { platform?: string; from?: string; to?: string }) {
    const r = await this.list({ ...q });
    const money = '#,##0.00';
    const buffer = await this.xlsx.workbook([
      { name: 'Waybills', title: 'E-commerce waybill report', subtitle: [`Uploaded ${q.from ?? 'start'} to ${q.to ?? 'today'}${q.platform ? ` · ${q.platform}` : ''}`, 'SRP = the platform price list; fees at the platform rates; order income = SRP − fees'],
        columns: [{ header: 'Platform', key: 'platformName', width: 12 }, { header: 'Order ID', key: 'orderId', width: 24 }, { header: 'Tracking', key: 'trackingNo', width: 20 }, { header: 'Product', key: 'product', width: 38 }, { header: 'Qty', key: 'qty', width: 6 }, { header: 'SRP each', key: 'unitSrp', width: 13, numFmt: money }, { header: 'SRP total', key: 'srp', width: 14, numFmt: money }, { header: 'Commission', key: 'commission', width: 13, numFmt: money }, { header: 'Transaction fee', key: 'transactionFee', width: 14, numFmt: money }, { header: 'Affiliate', key: 'affiliateFee', width: 12, numFmt: money }, { header: 'Shipping', key: 'shippingFee', width: 12, numFmt: money }, { header: 'Total fees', key: 'fees', width: 13, numFmt: money }, { header: 'Order income', key: 'income', width: 14, numFmt: money }, { header: 'Uploaded', key: 'uploaded', width: 12 }],
        rows: r.rows.map((x) => ({ ...x, product: x.product ? `${x.product.name}${x.guessed ? ' (to confirm)' : ''}` : '(no product chosen)' })), totals: ['srp', 'commission', 'transactionFee', 'affiliateFee', 'shippingFee', 'fees', 'income'] },
    ]);
    return { buffer, fileName: `Waybill-report-${dateStr(todayManila())}.xlsx` };
  }
}
