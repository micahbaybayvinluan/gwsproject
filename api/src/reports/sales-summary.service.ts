import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { XlsxService } from './xlsx.service';
import { AuditService } from '../common/audit.service';
import { dateStr, toDateOnly, todayManila } from '../common/manila';
import type { SessionUser } from '../common/request-context';

const MODES = ['CASH', 'ONLINE', 'CREDIT_CARD', 'AR_PDC'] as const;
const r2 = (n: number) => Math.round(n * 100) / 100;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Sales Report for any branch (or all) and any period, and the month-to-date / year performance per branch (owner request 2026-09-27).
 * Branch staff only ever get their own branch. Gross profit appears only for people allowed to see cost.
 */
@Injectable()
export class SalesSummaryService {
  constructor(private prisma: PrismaService, private xlsx: XlsxService, private audit: AuditService) {}

  /** Company branches that sell, in a fixed order so each keeps its colour in every chart. */
  private async branches(user: SessionUser) {
    const shops = await this.prisma.db.location.findMany({ where: { isSelling: true, type: { in: ['BRANCH', 'WAREHOUSE'] } }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } });
    // e-commerce: each platform is its own line (TikTok, Shopee, Lazada), after the branches
    const ecom = (await this.prisma.db.location.findMany({ where: { code: { in: ['ECOM-TIKTOK', 'ECOM-SHOPEE', 'ECOM-LAZADA'] } }, select: { id: true, name: true, code: true }, orderBy: { code: 'desc' } }))
      .map((l) => ({ ...l, name: `E-commerce – ${l.name.split(' – ')[0]}` }));
    const all = [...shops, ...ecom];
    return user.locationScoped ? all.filter((b) => user.locationIds.includes(b.id)) : all;
  }

  async summary(user: SessionUser, q: { locationId?: string; from: string; to: string }) {
    if (q.locationId && user.locationScoped && !user.locationIds.includes(q.locationId)) throw new ForbiddenException('You can only see your own branch');
    const branches = await this.branches(user);
    const ids = q.locationId ? [q.locationId] : branches.map((b) => b.id);
    const sales = await this.prisma.db.salesDoc.findMany({ where: { voidedAt: null, locationId: { in: ids }, docDate: { gte: toDateOnly(q.from), lte: toDateOnly(q.to) } }, select: { docDate: true, locationId: true, paymentMode: true, channel: true, grandTotal: true, lines: { select: { qty: true, amount: true, unitCost: true, isFreebie: true, product: { select: { name: true, sku: true } } } } } });
    const canCost = user.permissions.has('cost.view');
    const empty = () => ({ transactions: 0, CASH: 0, ONLINE: 0, CREDIT_CARD: 0, AR_PDC: 0, total: 0 });
    const perDay = new Map<string, ReturnType<typeof empty>>(); const perBranch = new Map<string, { transactions: number; total: number; products: number }>(); const perChannel = new Map<string, number>();
    const products = new Map<string, { name: string; sku: string; qty: number; amount: number }>();
    let total = 0, count = 0, qty = 0, cost = 0;
    for (const s of sales) {
      const amt = Number(s.grandTotal); total += amt; count++;
      const d = perDay.get(dateStr(s.docDate)) ?? empty(); d.transactions++; d[s.paymentMode] += amt; d.total += amt; perDay.set(dateStr(s.docDate), d);
      const b = perBranch.get(s.locationId) ?? { transactions: 0, total: 0, products: 0 }; b.transactions++; b.total += amt;
      perChannel.set(s.channel, (perChannel.get(s.channel) ?? 0) + amt);
      for (const l of s.lines) {
        cost += Number(l.unitCost) * l.qty; if (l.isFreebie) continue;
        qty += l.qty; b.products += l.qty;
        const p = products.get(l.product.sku) ?? { name: l.product.name, sku: l.product.sku, qty: 0, amount: 0 }; p.qty += l.qty; p.amount += Number(l.amount); products.set(l.product.sku, p);
      }
      perBranch.set(s.locationId, b);
    }
    const byMode = Object.fromEntries(MODES.map((m) => [m, r2([...perDay.values()].reduce((t, d) => t + d[m], 0))]));
    const productTotal = sales.reduce((t, s) => t + s.lines.reduce((u, l) => u + Number(l.amount), 0), 0);
    return {
      from: q.from, to: q.to, branch: q.locationId ? branches.find((b) => b.id === q.locationId)?.name ?? '' : 'All branches',
      totals: { sales: r2(total), transactions: count, average: count ? r2(total / count) : 0, products: qty, byMode, ...(canCost ? { costOfSales: r2(cost), grossProfit: r2(productTotal - cost), grossMarginPct: productTotal ? Math.round(((productTotal - cost) / productTotal) * 1000) / 10 : 0 } : {}) },
      perDay: [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({ date, ...Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === 'number' && k !== 'transactions' ? r2(v) : v])) })),
      perBranch: branches.filter((b) => ids.includes(b.id)).map((b) => { const x = perBranch.get(b.id) ?? { transactions: 0, total: 0, products: 0 }; return { id: b.id, name: b.name, transactions: x.transactions, products: x.products, total: r2(x.total), sharePct: total ? Math.round((x.total / total) * 1000) / 10 : 0 }; }).sort((a, b) => b.total - a.total),
      byChannel: [...perChannel.entries()].map(([channel, amount]) => ({ channel, amount: r2(amount) })).sort((a, b) => b.amount - a.amount),
      topProducts: [...products.values()].sort((a, b) => b.amount - a.amount).slice(0, 15).map((p) => ({ ...p, amount: r2(p.amount) })),
    };
  }

  async summaryXlsx(user: SessionUser, q: { locationId?: string; from: string; to: string }) {
    const r = await this.summary(user, q);
    const money = '#,##0.00';
    const title = `Sales Report — ${r.branch} — ${r.from} to ${r.to}`;
    const sheets = [
      { name: 'Summary', title, columns: [{ header: 'Item', key: 'k', width: 28 }, { header: 'Value', key: 'v', width: 18, numFmt: money }], rows: [['Total sales', r.totals.sales], ['Transactions', r.totals.transactions], ['Average per sale', r.totals.average], ['Products sold', r.totals.products], ['Cash', r.totals.byMode.CASH], ['Online (bank / GCash)', r.totals.byMode.ONLINE], ['Credit card', r.totals.byMode.CREDIT_CARD], ['AR / PDC (credit)', r.totals.byMode.AR_PDC], ...('grossProfit' in r.totals ? [['Cost of sales', r.totals.costOfSales], ['Gross profit', r.totals.grossProfit], ['Gross margin %', r.totals.grossMarginPct]] : [])].map(([k, v]) => ({ k, v })) as Record<string, unknown>[] },
      { name: 'Per day', title: `${title} — per day`, columns: [{ header: 'Date', key: 'date', width: 12 }, { header: 'Sales', key: 'transactions', width: 8 }, { header: 'Cash', key: 'CASH', numFmt: money }, { header: 'Online', key: 'ONLINE', numFmt: money }, { header: 'Card', key: 'CREDIT_CARD', numFmt: money }, { header: 'AR / PDC', key: 'AR_PDC', numFmt: money }, { header: 'Total', key: 'total', numFmt: money }], rows: r.perDay as Record<string, unknown>[], totals: ['transactions', 'CASH', 'ONLINE', 'CREDIT_CARD', 'AR_PDC', 'total'] },
      { name: 'Per branch', title: `${title} — per branch`, columns: [{ header: 'Branch', key: 'name', width: 24 }, { header: 'Sales', key: 'transactions' }, { header: 'Products', key: 'products' }, { header: 'Total', key: 'total', numFmt: money }, { header: 'Share %', key: 'sharePct' }], rows: r.perBranch as Record<string, unknown>[], totals: ['transactions', 'products', 'total'] },
      { name: 'Top products', title: `${title} — top products`, columns: [{ header: 'SKU', key: 'sku' }, { header: 'Product', key: 'name', width: 40 }, { header: 'Qty', key: 'qty' }, { header: 'Amount', key: 'amount', numFmt: money }], rows: r.topProducts as Record<string, unknown>[] },
    ];
    await this.audit.log({ action: 'EXPORT', entityType: 'Report', entityId: 'SalesReport.xlsx', after: q, userId: user.id });
    return { buffer: await this.xlsx.workbook(sheets as never), contentType: XLSX, fileName: `SalesReport_${r.branch.replace(/\W+/g, '')}_${r.from}_${r.to}.xlsx` };
  }

  /** Month to date (cumulative per day, per branch) and this year month by month, per branch. */
  async performance(user: SessionUser, q: { year?: number; month?: number }) {
    const today = todayManila(); const year = q.year ?? today.getUTCFullYear(); const month = q.month ?? today.getUTCMonth() + 1;
    const branches = await this.branches(user); const ids = branches.map((b) => b.id);
    const monthStart = new Date(Date.UTC(year, month - 1, 1)); const monthEnd = new Date(Date.UTC(year, month, 0));
    const lastDay = today >= monthStart && today <= monthEnd ? today.getUTCDate() : monthEnd.getUTCDate();
    const daily = await this.prisma.db.salesDoc.groupBy({ by: ['locationId', 'docDate'], where: { voidedAt: null, locationId: { in: ids }, docDate: { gte: monthStart, lte: monthEnd } }, _sum: { grandTotal: true } });
    const days = Array.from({ length: lastDay }, (_, i) => i + 1);
    const cumulative: Record<string, number[]> = {};
    for (const b of branches) { let run = 0; cumulative[b.id] = days.map((d) => { run += daily.filter((x) => x.locationId === b.id && x.docDate.getUTCDate() === d).reduce((t, x) => t + Number(x._sum.grandTotal ?? 0), 0); return r2(run); }); }
    const yearRows = await this.prisma.db.salesDoc.groupBy({ by: ['locationId', 'docDate'], where: { voidedAt: null, locationId: { in: ids }, docDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } }, _sum: { grandTotal: true } });
    const months = Array.from({ length: year === today.getUTCFullYear() ? today.getUTCMonth() + 1 : 12 }, (_, i) => i);
    const byMonth: Record<string, number[]> = {};
    for (const b of branches) byMonth[b.id] = months.map((m) => r2(yearRows.filter((x) => x.locationId === b.id && x.docDate.getUTCMonth() === m).reduce((t, x) => t + Number(x._sum.grandTotal ?? 0), 0)));
    const mtd = branches.map((b) => ({ id: b.id, name: b.name, total: cumulative[b.id][cumulative[b.id].length - 1] ?? 0 }));
    return { year, month, days, branches: branches.map((b) => ({ id: b.id, name: b.name })), cumulative, monthNames: months.map((m) => new Date(Date.UTC(2000, m, 1)).toLocaleString('en', { month: 'short' })), byMonth, monthToDate: { total: r2(mtd.reduce((t, b) => t + b.total, 0)), perBranch: mtd } };
  }
}
