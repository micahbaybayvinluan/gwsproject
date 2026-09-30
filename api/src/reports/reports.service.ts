import { batchLabel } from '../stock/flavors';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { XlsxService, type Col } from './xlsx.service';
import { KIND_LABEL } from '../charges/charges.service';
import { CHECKLIST } from '../inspections/checklist';
import { PayrollService } from '../payroll/payroll.service';
import { AccountsService } from '../gl/accounts.service';
import { directCostTemplateFor } from '../gl/account-templates';
import { PdfService } from './pdf.service';
import { AuditService } from '../common/audit.service';
import { StockService } from '../stock/stock.service';
import { hasMovement } from '../stock/daily-inventory';
import { inSystem, sortCountLines } from '../counts/counts.service';
import { FinReportsService, MONTHS } from '../gl/fin-reports.service';
import { buildDailySalesReport, RSale } from './daily-sales-report';
import { toDateOnly, dateStr } from '../common/manila';
import { D, ZERO } from '../common/money';
import type { SessionUser } from '../common/request-context';

export type Out = { buffer: Buffer; contentType: string; fileName: string };
const r2 = (n: number) => Math.round(n * 100) / 100;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** §7.8 / §8.5 / §13 reports and exports. Every export is audit-logged (§14). */
@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService, private xlsx: XlsxService, private pdf: PdfService, private audit: AuditService, private stock: StockService, private fin: FinReportsService, private payroll: PayrollService, private accounts: AccountsService) {}

  private async logExport(user: SessionUser, report: string, params: unknown) { await this.audit.log({ action: 'EXPORT', entityType: 'Report', entityId: report, after: params, userId: user.id }); }

  async dailySalesData(locationId: string, date: string, user: SessionUser, withMargin = false) {
    if (user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException();
    const loc = await this.prisma.db.location.findUnique({ where: { id: locationId } }); if (!loc) throw new NotFoundException();
    const d = toDateOnly(date);
    const sales = await this.prisma.db.salesDoc.findMany({ where: { locationId, docDate: d, voidedAt: null }, include: { lines: { include: { product: { include: { category: true } } } }, agent: true, rider: true, customer: true }, orderBy: { drSiNo: 'asc' } });
    const expenses = await this.prisma.db.expenseDoc.findMany({ where: { locationId, docDate: d, voidedAt: null }, include: { account: { include: { template: { select: { key: true } } } } } });
    // rider incentives paid from a sale's cash belong to that rider's line in the rider summary (not again in the expense boxes)
    const riderIncentiveOf = new Map(expenses.filter((e) => e.account.template?.key === 'RIDER_INCENTIVE').map((e) => [e.id, e.amount]));
    const saleIncentiveIds = new Set(sales.map((s) => s.incentiveExpenseId).filter(Boolean) as string[]);
    const close = await this.prisma.db.dailyClose.findUnique({ where: { locationId_businessDate: { locationId, businessDate: d } } });
    const acctTitles = new Map((await this.prisma.db.account.findMany({ where: { id: { in: sales.map((s) => s.paymentAccountId).filter(Boolean) as string[] } }, select: { id: true, title: true } })).map((a) => [a.id, a.title]));
    const rs: RSale[] = sales.map((s) => ({ id: s.id, paymentAccount: s.paymentAccountId ? acctTitles.get(s.paymentAccountId) ?? null : null, drSiNo: s.drSiNo, channel: s.channel, channelSub: s.channelSub, paymentMode: s.paymentMode, customerName: s.customer?.name ?? s.customerName, agentName: s.agent?.name ?? null, riderName: s.rider?.name ?? null, deliveryFee: s.deliveryFee, riderIncentive: s.riderIncentive.plus((s.incentiveExpenseId && riderIncentiveOf.get(s.incentiveExpenseId)) || 0), shippingFee: s.shippingFee, shippingExpense: s.shippingExpense, marketplaceCharges: s.marketplaceCharges, productTotal: s.productTotal, grandTotal: s.grandTotal, cardMid: s.cardMid, cardSlipNo: s.cardSlipNo, cardApprovalCode: s.cardApprovalCode, cardBatchNo: s.cardBatchNo, notes: s.notes, lines: s.lines.map((l) => ({ productName: l.product.name, qty: l.qty, unitPrice: l.unitPrice, amount: l.amount, isFreebie: l.isFreebie, accountingClass: l.product.category.accountingClass })) }));
    // cash-fund expenses are listed on the fund's replenishment voucher; the replenishment itself comes out of today's cash (owner request 2026-09-26)
    const fundRep = await this.prisma.db.cashFundTxn.findMany({ where: { locationId, businessDate: toDateOnly(date), kind: 'REPLENISH' } });
    const rep = buildDailySalesReport({ branch: loc.name, date, sales: rs, expenses: [...expenses.filter((e) => e.paidFrom !== 'PETTY_CASH').map((e) => ({ accountTitle: e.account.title, payee: e.payee, amount: e.amount, paidFrom: e.paidFrom, inRiderSummary: saleIncentiveIds.has(e.id) && riderIncentiveOf.has(e.id) })), ...fundRep.map((t) => ({ accountTitle: 'Cash Fund Replenishment', payee: t.controlNo, amount: t.amount, paidFrom: 'CASH_DRAWER' }))], close: close ? { moneyBreakdown: close.moneyBreakdown as Record<string, number> | null, countedCash: close.countedCash, expectedCash: close.expectedCash, cashVariance: close.cashVariance } : null, preparedBy: user.fullName });
    if (!withMargin) return rep;
    if (!user.permissions.has('cost.view')) throw new ForbiddenException('Audit summary requires cost.view');
    const cost = sales.flatMap((s) => s.lines).reduce((t, l) => t.plus(l.unitCost.mul(l.qty)), ZERO);
    const revenue = sales.reduce((t, s) => t.plus(s.productTotal), ZERO);
    return { ...rep, audit: { costOfSales: cost, grossProfit: revenue.minus(cost), grossMarginPct: revenue.isZero() ? 0 : revenue.minus(cost).div(revenue).mul(100).toDecimalPlaces(1).toNumber() } };
  }
  async dailySalesXlsx(locationId: string, date: string, user: SessionUser): Promise<Out> { const rep = await this.dailySalesData(locationId, date, user); await this.logExport(user, 'DailyBranchSalesReport.xlsx', { locationId, date }); return { buffer: await this.xlsx.dailySalesReport(rep), contentType: XLSX, fileName: `DailySalesReport_${rep.header.branch}_${date}.xlsx` }; }
  async dailySalesPdf(locationId: string, date: string, user: SessionUser): Promise<Out> { const rep = await this.dailySalesData(locationId, date, user); await this.logExport(user, 'DailyBranchSalesReport.pdf', { locationId, date }); const r = await this.pdf.render(this.pdf.dailySalesReportHtml(rep)); return { buffer: r.buffer, contentType: r.contentType, fileName: `DailySalesReport_${rep.header.branch}_${date}.${r.ext}` }; }

  async stockOnHandXlsx(user: SessionUser, locationId?: string): Promise<Out> {
    const rows = await this.stock.stockOnHand(user, locationId);
    const canCost = user.permissions.has('cost.view');
    const cols = [{ header: 'Location', key: 'location' }, { header: 'SKU', key: 'sku' }, { header: 'Product', key: 'product', width: 40 }, { header: 'Flavor', key: 'flavor' }, { header: 'Batch', key: 'batchNo' }, { header: 'Expiry', key: 'expiryDate' }, { header: 'Qty', key: 'qty' }, ...(canCost ? [{ header: 'Unit Cost', key: 'unitCost', numFmt: '#,##0.00' }, { header: 'Value at Cost', key: 'valueAtCost', numFmt: '#,##0.00' }] : [])];
    await this.logExport(user, 'StockOnHand.xlsx', { locationId });
    return { buffer: await this.xlsx.table('Stock on hand', cols, rows.map((r) => ({ location: r.location.name, sku: r.product.sku, product: r.product.name, flavor: r.flavor ?? '', batchNo: r.batchNo, expiryDate: r.expiryDate, qty: r.qty, unitCost: r.unitCost, valueAtCost: r.valueAtCost })), { title: 'Stock on Hand', totals: canCost ? ['qty', 'valueAtCost'] : ['qty'] }), contentType: XLSX, fileName: 'StockOnHand.xlsx' };
  }
  async dailyMovementXlsx(user: SessionUser, locationId: string, year: number, month: number): Promise<Out> {
    if (user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException();
    const data = await this.stock.dailyMovement(locationId, year, month);
    const cols = [{ header: 'SKU', key: 'sku' }, { header: 'Item', key: 'name', width: 40 }, { header: 'Beg', key: 'beg' }];
    const days = data[0]?.days.length ?? 0;
    for (let d = 1; d <= days; d++) for (const k of ['IN-P', 'IN-T', 'OUT-P', 'OUT-S', 'Bal', 'Act', 'Var', 'Loss', 'End']) cols.push({ header: `${d} ${k}`, key: `d${d}_${k}`, width: 7 } as never);
    cols.push({ header: 'End', key: 'end' });
    const rows = data.map((p) => { const o: Record<string, unknown> = { sku: p.product.sku, name: p.product.name, beg: p.beg, end: p.end }; for (const d of p.days) { o[`d${d.day}_IN-P`] = d.inP; o[`d${d.day}_IN-T`] = d.inT; o[`d${d.day}_OUT-P`] = d.outP; o[`d${d.day}_OUT-S`] = d.outS; o[`d${d.day}_Bal`] = d.bal; o[`d${d.day}_Act`] = d.act ?? ''; o[`d${d.day}_Var`] = d.var ?? ''; o[`d${d.day}_Loss`] = d.loss; o[`d${d.day}_End`] = d.end; } return o; });
    await this.logExport(user, 'DailyInventoryMovement.xlsx', { locationId, year, month });
    return { buffer: await this.xlsx.table('DAILY INVTY COUNT', cols, rows, { title: `Daily Inventory Movement ${year}-${String(month).padStart(2, '0')}` }), contentType: XLSX, fileName: `DailyInventory_${year}-${month}.xlsx` };
  }
  /** Daily Inventory Report xlsx: sheet 1 = period summary per product, sheet 2 = per-day detail. Cost columns only for cost.view. */
  async dailyInventoryXlsx(user: SessionUser, locationId: string, from: string, to: string): Promise<Out> {
    const rep = await this.stock.dailyInventory(locationId, from, to);
    const canCost = user.permissions.has('cost.view');
    const money = '#,##0.00;(#,##0.00);-';
    const qtyCols: Col[] = [{ header: 'Beg', key: 'beg', width: 8 }, { header: 'Receive', key: 'receive', width: 9 }, { header: 'Transfer In', key: 'transferIn', width: 11 }, { header: 'Returns', key: 'returns', width: 9 }, { header: 'Pull Out', key: 'pullOut', width: 9 }, { header: 'Sales', key: 'sales', width: 8 }, { header: 'Other Out', key: 'other', width: 10 }, { header: 'Adj', key: 'adjust', width: 7 }, { header: 'End', key: 'end', width: 8 }];
    const costCols: Col[] = canCost ? [{ header: 'Beg Value', key: 'begCost', numFmt: money }, { header: 'Transfer In Cost', key: 'transferInCost', numFmt: money }, { header: 'Pull Out Cost', key: 'pullOutCost', numFmt: money }, { header: 'Cost of Sales', key: 'salesCost', numFmt: money }, { header: 'End Value', key: 'endCost', numFmt: money }] : [];
    const totals = [...qtyCols.map((c) => c.key), ...costCols.map((c) => c.key)];
    const head = `Daily Inventory Report — ${rep.location.name} — ${from} to ${to}${canCost ? ' (with costing)' : ''}`;
    const subtitle = [`Prepared by: ${user.fullName}`, `Generated: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`];
    const prodCols: Col[] = [{ header: 'SKU', key: 'sku', width: 12 }, { header: 'Brand', key: 'brand', width: 16 }, { header: 'Item', key: 'name', width: 44 }, { header: 'Movement', key: 'movement', width: 12 }];
    const flat = (p: (typeof rep.products)[number], moved = p.moved) => ({ sku: p.product.sku, brand: p.product.brand ?? '', name: p.product.name, movement: moved ? 'With movement' : 'No movement' });
    // rep.products already lists items with movement first, then items without
    const summary = rep.products.map((p) => ({ ...p, ...flat(p), ...(canCost ? { unitCost: p.unitCost } : {}) }));
    const perDay = rep.products.flatMap((p) => p.days.filter((d) => hasMovement(d)).map((d) => ({ ...d, ...flat(p, true) })));
    const sheets = [
      { name: 'Summary', title: head, subtitle, columns: [...prodCols, ...qtyCols, ...costCols, ...(canCost ? [{ header: 'Unit Cost (avg)', key: 'unitCost', numFmt: money }] : [])], rows: summary as Record<string, unknown>[], totals },
      { name: 'Per day', title: `${head} — movements per day`, columns: [{ header: 'Date', key: 'date', width: 12 }, ...prodCols, ...qtyCols, ...costCols], rows: perDay as Record<string, unknown>[], totals },
      ...rep.days.map((day) => ({ name: day, title: `${rep.location.name} — ${day}`, columns: [...prodCols, ...qtyCols, ...costCols], rows: rep.products.map((p) => { const d = p.days.find((x) => x.date === day)!; return { ...d, ...flat(p, hasMovement(d)), moved: hasMovement(d) }; }).filter((r) => r.moved || r.beg || r.end).sort((x, y) => Number(y.moved) - Number(x.moved)) as Record<string, unknown>[], totals })),
    ];
    await this.logExport(user, 'DailyInventoryReport.xlsx', { locationId, from, to, withCost: canCost });
    return { buffer: await this.xlsx.workbook(sheets), contentType: XLSX, fileName: `DailyInventory_${rep.location.name.replace(/\W+/g, '')}_${from}_${to}.xlsx` };
  }
  /**
   * Customer contact list (owner request 2026-09-26): every customer with a name, contact number or email captured on sales —
   * registered customers (dealers, franchises, agents) and walk-in / online buyers — with purchases, total and last purchase.
   * Branch users get their own branch; everyone else all branches or the chosen one.
   */
  async customerContacts(user: SessionUser, q: { locationId?: string; from?: string; to?: string }) {
    if (q.locationId && user.locationScoped && !user.locationIds.includes(q.locationId)) throw new ForbiddenException();
    const sales = await this.prisma.db.salesDoc.findMany({
      where: { voidedAt: null, locationId: q.locationId ? q.locationId : user.locationScoped ? { in: user.locationIds } : undefined, docDate: q.from || q.to ? { gte: q.from ? toDateOnly(q.from) : undefined, lte: q.to ? toDateOnly(q.to) : undefined } : undefined, OR: [{ customerId: { not: null } }, { customerName: { not: null } }, { customerPhone: { not: null } }, { customerEmail: { not: null } }] },
      select: { docDate: true, grandTotal: true, channel: true, customerName: true, customerPhone: true, customerEmail: true, customer: { select: { id: true, code: true, name: true, type: true, contact: true, phone: true, email: true } }, location: { select: { name: true } }, lines: { select: { qty: true, isFreebie: true, product: { select: { name: true } } } } },
      orderBy: { docDate: 'asc' },
    });
    const map = new Map<string, { name: string; type: string; phone: string; email: string; branches: Set<string>; purchases: number; total: number; first: string; last: string; channels: Set<string>; items: Map<string, number> }>();
    for (const s of sales) {
      const name = s.customer?.name ?? s.customerName ?? '';
      const phone = s.customerPhone ?? s.customer?.phone ?? s.customer?.contact ?? '';
      const email = (s.customerEmail ?? s.customer?.email ?? '').toLowerCase();
      const key = s.customer?.id ?? (email || phone.replace(/\D/g, '') || name.trim().toLowerCase());
      if (!key) continue;
      const cur = map.get(key) ?? { name, type: s.customer?.type ?? 'WALK-IN / ONLINE', phone, email, branches: new Set<string>(), purchases: 0, total: 0, first: dateStr(s.docDate), last: dateStr(s.docDate), channels: new Set<string>(), items: new Map<string, number>() };
      cur.name = cur.name || name; cur.phone = phone || cur.phone; cur.email = email || cur.email;
      cur.branches.add(s.location.name); cur.channels.add(s.channel.replace(/_/g, ' ').toLowerCase()); cur.purchases++; cur.total += Number(s.grandTotal); cur.last = dateStr(s.docDate);
      for (const l of s.lines) if (!l.isFreebie) cur.items.set(l.product.name, (cur.items.get(l.product.name) ?? 0) + l.qty);
      map.set(key, cur);
    }
    return [...map.values()].map((c) => ({ name: c.name, type: c.type, contactNumber: c.phone, email: c.email, branches: [...c.branches].join(', '), channels: [...c.channels].join(', '), itemsOrdered: [...c.items.entries()].sort((a, b) => b[1] - a[1]).map(([n, q]) => `${q}× ${n}`).join(', '), purchases: c.purchases, totalPurchases: Math.round(c.total * 100) / 100, firstPurchase: c.first, lastPurchase: c.last })).sort((a, b) => b.totalPurchases - a.totalPurchases);
  }
  async customerContactsXlsx(user: SessionUser, q: { locationId?: string; from?: string; to?: string }): Promise<Out> {
    const rows = await this.customerContacts(user, q);
    await this.logExport(user, 'CustomerContacts.xlsx', q);
    return { buffer: await this.xlsx.table('Customers', [{ header: 'Customer', key: 'name', width: 30 }, { header: 'Type', key: 'type', width: 16 }, { header: 'Contact number', key: 'contactNumber', width: 18 }, { header: 'Email', key: 'email', width: 28 }, { header: 'Items ordered', key: 'itemsOrdered', width: 50 }, { header: 'Branch(es)', key: 'branches', width: 24 }, { header: 'Channels', key: 'channels', width: 22 }, { header: 'Purchases', key: 'purchases', width: 10 }, { header: 'Total purchases', key: 'totalPurchases', numFmt: '#,##0.00' }, { header: 'First purchase', key: 'firstPurchase', width: 13 }, { header: 'Last purchase', key: 'lastPurchase', width: 13 }], rows, { title: `Customer contact list${q.from || q.to ? ` ${q.from ?? ''} to ${q.to ?? ''}` : ''}`, totals: ['purchases', 'totalPurchases'] }), contentType: XLSX, fileName: 'CustomerContacts.xlsx' };
  }
  /**
   * Direct cost generated from sales (owner request 2026-09-26): per branch and product category, the batch cost of everything sold in
   * the month, mapped to the workbook's "Direct Cost" accounts — the same amounts rule R5 posts automatically with every sale.
   * Accounting uses it instead of keying direct cost by hand; `posted` shows what is already in the ledger.
   */
  async directCostFromSales(year: number, month: number) {
    const from = new Date(Date.UTC(year, month - 1, 1)); const to = new Date(Date.UTC(year, month, 0));
    const lines = await this.prisma.db.salesLine.findMany({ where: { doc: { voidedAt: null, docDate: { gte: from, lte: to } } }, select: { qty: true, unitCost: true, amount: true, product: { select: { category: { select: { accountingClass: true } } } }, doc: { select: { locationId: true, location: { select: { name: true } } } } } });
    const r = await this.accounts.resolver();
    const map = new Map<string, { locationId: string; branch: string; accountingClass: string; accountId: string | null; sales: number; directCost: number }>();
    for (const l of lines) {
      const cls = l.product.category.accountingClass; const key = `${l.doc.locationId}|${cls}`;
      let accountId: string | null = null; try { accountId = r.branch(directCostTemplateFor(cls), l.doc.locationId); } catch { accountId = null; }
      const cur = map.get(key) ?? { locationId: l.doc.locationId, branch: l.doc.location.name, accountingClass: cls, accountId, sales: 0, directCost: 0 };
      cur.sales += Number(l.amount); cur.directCost += Number(l.unitCost) * l.qty; map.set(key, cur);
    }
    const accts = await this.prisma.db.account.findMany({ where: { id: { in: [...map.values()].map((x) => x.accountId).filter((x): x is string => !!x) } }, select: { id: true, code: true, title: true } });
    const posted = await this.prisma.db.journalLine.groupBy({ by: ['accountId'], where: { accountId: { in: accts.map((a) => a.id) }, voucher: { voidedAt: null, date: { gte: from, lte: to }, sourceDocumentType: 'SalesDoc' } }, _sum: { debit: true, credit: true } });
    const rows = [...map.values()].sort((a, b) => a.branch.localeCompare(b.branch) || a.accountingClass.localeCompare(b.accountingClass)).map((x) => { const a = accts.find((y) => y.id === x.accountId); const p = posted.find((y) => y.accountId === x.accountId); return { branch: x.branch, category: x.accountingClass, accountCode: a?.code ?? '', account: a?.title ?? '(direct cost account not set up for this branch)', sales: Math.round(x.sales * 100) / 100, directCost: Math.round(x.directCost * 100) / 100, postedInLedger: p ? Number(p._sum.debit ?? 0) - Number(p._sum.credit ?? 0) : 0 }; });
    return { year, month, rows, totals: { sales: rows.reduce((t, x) => t + x.sales, 0), directCost: rows.reduce((t, x) => t + x.directCost, 0), postedInLedger: rows.reduce((t, x) => t + x.postedInLedger, 0) } };
  }
  async directCostFromSalesXlsx(year: number, month: number, user: SessionUser): Promise<Out> {
    const d = await this.directCostFromSales(year, month);
    await this.logExport(user, 'DirectCostFromSales.xlsx', { year, month });
    const money = '#,##0.00;(#,##0.00);-';
    return { buffer: await this.xlsx.table('Direct cost', [{ header: 'Branch', key: 'branch', width: 20 }, { header: 'Category', key: 'category', width: 14 }, { header: 'Code', key: 'accountCode', width: 8 }, { header: 'Direct cost account', key: 'account', width: 40 }, { header: 'Sales', key: 'sales', numFmt: money }, { header: 'Direct cost (from sales)', key: 'directCost', numFmt: money }, { header: 'Posted in ledger', key: 'postedInLedger', numFmt: money }], d.rows, { title: `Direct cost generated from sales ${year}-${String(month).padStart(2, '0')}`, totals: ['sales', 'directCost', 'postedInLedger'] }), contentType: XLSX, fileName: `DirectCostFromSales_${year}-${month}.xlsx` };
  }
  /**
   * Inventory cost movements for Accounting (owner request 2026-09-26): per day or per month, per branch (or all), the inventory value
   * at batch cost — beginning, receiving, transfer-in, customer returns, pull-out, direct cost of sales, freebies/tasting,
   * adjustments & write-offs, ending. Straight from the stock ledger, so it matches what R1/R5/R6/R9 post.
   */
  async inventoryCost(q: { from: string; to: string; groupBy: 'day' | 'month'; locationId?: string }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(q.from) || !/^\d{4}-\d{2}-\d{2}$/.test(q.to) || q.from > q.to) throw new BadRequestException('from/to must be YYYY-MM-DD and from ≤ to');
    const from = toDateOnly(q.from), to = toDateOnly(q.to);
    const locs = await this.prisma.db.location.findMany({ where: { type: { not: 'VIRTUAL' }, id: q.locationId || undefined }, select: { id: true, name: true } });
    const ids = locs.map((l) => l.id);
    const unit = q.groupBy === 'month' ? 'month' : 'day';
    const beg = await this.prisma.db.$queryRaw<{ location_id: string; value: unknown }[]>`SELECT location_id, COALESCE(SUM(qty_delta*unit_cost),0) AS value FROM stock_ledger WHERE business_date < ${from}::date AND location_id = ANY(${ids}) GROUP BY location_id`;
    const mv = await this.prisma.db.$queryRaw<{ period: Date; location_id: string; movement_type: string; value: unknown; qty: bigint }[]>`SELECT date_trunc(${unit}, business_date)::date AS period, location_id, movement_type::text AS movement_type, COALESCE(SUM(qty_delta*unit_cost),0) AS value, COALESCE(SUM(qty_delta),0)::bigint AS qty FROM stock_ledger WHERE business_date BETWEEN ${from}::date AND ${to}::date AND location_id = ANY(${ids}) GROUP BY 1,2,3 ORDER BY 1`;
    const bucket = (t: string): Bucket => (t === 'RECEIVE' ? 'receiving' : ['TRANSFER_IN', 'CONSIGN_RETURN', 'BUNDLE_BUILD'].includes(t) ? 'transferIn' : t === 'SALE_RETURN' ? 'returns' : ['TRANSFER_OUT', 'RETURN_TO_WAREHOUSE', 'RETURN_TO_SUPPLIER', 'CONSIGN_OUT', 'BUNDLE_BREAK'].includes(t) ? 'pullOut' : ['SALE', 'CONSIGN_SALE'].includes(t) ? 'directCostOfSales' : ['FREEBIE_ISSUE', 'TASTING'].includes(t) ? 'freebiesTasting' : 'adjustments');
    type Bucket = 'receiving' | 'transferIn' | 'returns' | 'pullOut' | 'directCostOfSales' | 'freebiesTasting' | 'adjustments';
    const periods = [...new Set(mv.map((m) => dateStr(m.period)))].sort();
    const rows: Record<string, string | number>[] = [];
    for (const l of locs) {
      let value = Number(beg.find((b) => b.location_id === l.id)?.value ?? 0);
      const own = mv.filter((m) => m.location_id === l.id);
      if (!own.length && !value) continue;
      for (const p of periods) {
        const b: Record<Bucket, number> = { receiving: 0, transferIn: 0, returns: 0, pullOut: 0, directCostOfSales: 0, freebiesTasting: 0, adjustments: 0 };
        for (const m of own.filter((x) => dateStr(x.period) === p)) { const k = bucket(m.movement_type); b[k] += k === 'adjustments' ? Number(m.value) : Math.abs(Number(m.value)); }
        const begin = value;
        value = begin + b.receiving + b.transferIn + b.returns - b.pullOut - b.directCostOfSales - b.freebiesTasting + b.adjustments;
        rows.push({ period: unit === 'month' ? p.slice(0, 7) : p, branch: l.name, beginning: r2(begin), ...Object.fromEntries(Object.entries(b).map(([k, v]) => [k, r2(v)])), ending: r2(value) });
      }
    }
    const keys = ['receiving', 'transferIn', 'returns', 'pullOut', 'directCostOfSales', 'freebiesTasting', 'adjustments'] as const;
    return { from: q.from, to: q.to, groupBy: unit, rows, totals: Object.fromEntries(keys.map((k) => [k, r2(rows.reduce((t, x) => t + Number((x as Record<string, unknown>)[k]), 0))])) };
  }
  async inventoryCostXlsx(q: { from: string; to: string; groupBy: 'day' | 'month'; locationId?: string }, user: SessionUser): Promise<Out> {
    const d = await this.inventoryCost(q);
    await this.logExport(user, 'InventoryCostMovements.xlsx', q);
    const money = '#,##0.00;(#,##0.00);-';
    const cols: Col[] = [{ header: d.groupBy === 'month' ? 'Month' : 'Date', key: 'period', width: 12 }, { header: 'Branch', key: 'branch', width: 20 }, { header: 'Beginning value', key: 'beginning', numFmt: money }, { header: 'Receiving', key: 'receiving', numFmt: money }, { header: 'Transfer-in', key: 'transferIn', numFmt: money }, { header: 'Customer returns', key: 'returns', numFmt: money }, { header: 'Pull-out', key: 'pullOut', numFmt: money }, { header: 'Direct cost of sales', key: 'directCostOfSales', numFmt: money }, { header: 'Freebies / tasting', key: 'freebiesTasting', numFmt: money }, { header: 'Adjustments / write-offs', key: 'adjustments', numFmt: money }, { header: 'Ending value', key: 'ending', numFmt: money }];
    return { buffer: await this.xlsx.table('Inventory cost', cols, d.rows as Record<string, unknown>[], { title: `Inventory cost movements ${q.from} to ${q.to} (per ${d.groupBy})`, totals: ['receiving', 'transferIn', 'returns', 'pullOut', 'directCostOfSales', 'freebiesTasting', 'adjustments'] }), contentType: XLSX, fileName: `InventoryCost_${d.groupBy}_${q.from}_${q.to}.xlsx` };
  }
  /** Generic list export with current filters (any JSON rows). */
  async genericXlsx(user: SessionUser, name: string, rows: Record<string, unknown>[]): Promise<Out> {
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => typeof rows[0]?.[k] !== 'object' || rows[0]?.[k] === null || (rows[0]?.[k] as { toNumber?: unknown })?.toNumber);
    await this.logExport(user, `${name}.xlsx`, { rows: rows.length });
    return { buffer: await this.xlsx.table(name, keys.map((k) => ({ header: k, key: k })), rows, { title: name }), contentType: XLSX, fileName: `${name}.xlsx` };
  }
  csv(rows: Record<string, unknown>[]): string { if (!rows.length) return ''; const keys = Object.keys(rows[0]); const esc = (v: unknown) => { const s = v == null ? '' : typeof v === 'object' && 'toFixed' in (v as object) ? (v as { toString(): string }).toString() : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; return [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n'); }

  // ── Paper forms (§13) ──
  async form(type: string, id: string, user: SessionUser, format: 'pdf' | 'xlsx'): Promise<Out> {
    const f = await this.withPeople(await this.formData(type, id, user), id);
    await this.logExport(user, `${type}.${format}`, { id });
    if (format === 'xlsx') return { buffer: await this.xlsx.table(f.title, f.columns.map((c, i) => ({ header: c, key: String(i) })), f.rows.map((r) => Object.fromEntries(r.map((v, i) => [String(i), v]))), { title: `${f.title} — ${f.header.map(([k, v]) => `${k}: ${v}`).join(' | ')}` }), contentType: XLSX, fileName: `${f.title.replace(/\W+/g, '_')}_${id.slice(0, 8)}.xlsx` };
    const r = await this.pdf.render(this.pdf.formHtml(f.title, f.header, f.columns, f.rows, f.footer, f.signatures, f.watermark));
    return { buffer: r.buffer, contentType: r.contentType, fileName: `${f.title.replace(/\W+/g, '_')}_${id.slice(0, 8)}.${r.ext}` };
  }
  /**
   * Draft / pending forms print with a watermark so a draft can be checked on paper before submission; every form names the people
   * responsible (prepared / approved / received by) from the accounts that did it.
   */
  private async withPeople<F extends { status?: string; docType?: string; preparedBy?: string | null; receivedBy?: string | null; title: string; header: [string, unknown][]; signatures?: string[] }>(f: F, id: string): Promise<F & { watermark?: string }> {
    if (!f.docType) return f;
    const approvals = await this.prisma.db.approvalRequest.findMany({ where: { documentType: f.docType, documentId: id, status: { in: ['APPROVED', 'AUTO_APPROVED'] }, type: { not: 'WAREHOUSE_EDIT' } }, include: { decisions: { where: { decision: 'APPROVE' }, include: { user: { select: { fullName: true } } } } }, orderBy: { decidedAt: 'desc' } });
    const ids = [f.preparedBy, f.receivedBy].filter((x): x is string => !!x);
    const users = await this.prisma.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
    const nameOf = (uid?: string | null) => users.find((u) => u.id === uid)?.fullName ?? '';
    const approvedBy = approvals.flatMap((a) => (a.status === 'AUTO_APPROVED' ? ['auto-approved'] : a.decisions.map((d) => d.user.fullName))).join(', ');
    const status = f.status ?? '';
    const watermark = status === 'DRAFT' ? 'DRAFT — not yet submitted' : ['SUBMITTED', 'PENDING'].includes(status) ? 'FOR APPROVAL — not yet approved' : status === 'VOIDED' ? 'VOIDED' : status === 'REJECTED' ? 'REJECTED' : undefined;
    const header: [string, unknown][] = [...f.header, ['Status', status], ['Prepared by', nameOf(f.preparedBy)], ...(approvedBy ? [['Approved by', approvedBy] as [string, unknown]] : []), ...(f.receivedBy ? [['Received by', nameOf(f.receivedBy)] as [string, unknown]] : [])];
    const signatures = (f.signatures ?? ['Prepared by', 'Checked by', 'Received by']).map((sig) => (/^prepared/i.test(sig) && f.preparedBy ? `${sig}: ${nameOf(f.preparedBy)}` : /^received/i.test(sig) && f.receivedBy ? `${sig}: ${nameOf(f.receivedBy)}` : sig));
    return { ...f, title: watermark ? `${f.title} (${watermark})` : f.title, header, signatures, watermark };
  }
  private async myEmployeeId(user: SessionUser) { return (await this.prisma.db.employee.findUnique({ where: { userId: user.id }, select: { id: true } }))?.id ?? null; }
  private async formData(type: string, id: string, user: SessionUser): Promise<{ status?: string; docType?: string; preparedBy?: string | null; receivedBy?: string | null; title: string; header: [string, unknown][]; columns: string[]; rows: unknown[][]; footer?: [string, unknown][]; signatures?: string[] }> {
    const db = this.prisma.db; const canCost = user.permissions.has('cost.view');
    const scope = (locationId: string) => { if (user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException(); };
    switch (type) {
      case 'pull-out': case 'transfer-in': {
        const t = await db.transferDoc.findUnique({ where: { id }, include: { fromLocation: true, toLocation: true, lines: { include: { product: true, batch: true } } } }); if (!t) throw new NotFoundException(); if (user.locationScoped && !user.locationIds.includes(t.fromLocationId) && !user.locationIds.includes(t.toLocationId)) throw new ForbiddenException();
        // the sending side drafts and prints the Pull-Out; the receiving side gets the Transfer-In copy once the transfer is submitted
        const sender = !user.locationScoped || user.locationIds.includes(t.fromLocationId) || t.createdBy === user.id;
        if (!sender && (t.status === 'DRAFT' || type === 'pull-out')) throw new ForbiddenException(t.status === 'DRAFT' ? 'This transfer has not been sent yet' : 'The Pull-Out form is printed by the sending location; print the Transfer-In copy');
        return { status: t.status, docType: 'TransferDoc', preparedBy: t.preparedBy ?? t.createdBy, receivedBy: t.receivedBy, title: type === 'pull-out' ? 'Pull-Out Form' : 'Transfer-In Form', header: [['Control #', type === 'transfer-in' ? t.transferInNo ?? t.controlNo : t.controlNo], [type === 'transfer-in' ? 'Pull-Out #' : 'Transfer-In #', type === 'transfer-in' ? t.controlNo : t.transferInNo ?? '—'], ['Date', dateStr(t.docDate)], ['From', t.fromLocation.name], ['Trans. To', t.toLocation.name], ['Type', t.transferType], ['Notes', t.notes ?? '']], columns: ['Qty Out', 'Items', 'Batch / Expiry', "Checker's", 'Received Qty', 'Remarks', 'Type'], rows: t.lines.map((l) => [l.qtySent, l.product.name, batchLabel(l.batch), l.checkerRemarks ?? '', l.qtyReceived ?? '', l.discrepancyNote ?? '', t.transferType]), signatures: ['Prepared by', 'Checked by', 'Received by'] };
      }
      case 'dr-sales': {
        const s = await db.salesDoc.findUnique({ where: { id }, include: { location: true, customer: true, lines: { include: { product: true, batch: { select: { batchNo: true, expiryDate: true, flavor: true } } } } } }); if (!s) throw new NotFoundException(); scope(s.locationId);
        return { status: s.status, docType: 'SalesDoc', preparedBy: s.createdBy, title: 'Delivery Receipt – Sales', header: [['Control #', s.controlNo], ['DR/SI #', s.drSiNo], ['Date', dateStr(s.docDate)], ['Trans. To', s.location.name], ['Name', s.customer?.name ?? s.customerName ?? ''], ['Contact no. / email', [s.customerPhone, s.customerEmail].filter(Boolean).join(' / ')], ['Mode of Payment', s.paymentMode]], columns: ['Qty', 'Items', 'Batch / expiry', 'S. Price/Unit', 'Amount', 'Remarks'], rows: s.lines.map((l) => [l.qty, l.product.name, batchLabel(l.batch), l.unitPrice, l.amount, l.lineRemarks ?? (l.isFreebie ? 'FREEBIE' : '')]), footer: [['Product total', s.productTotal], ['Delivery fee', s.deliveryFee], ['Shipping fee', s.shippingFee], ['TOTAL', s.grandTotal]] };
      }
      case 'supplier-form': {
        const r = await db.receivingDoc.findUnique({ where: { id }, include: { supplier: true, location: true, lines: { include: { product: true } } } }); if (!r) throw new NotFoundException(); scope(r.locationId);
        return { status: r.status, docType: 'ReceivingDoc', preparedBy: r.preparedBy ?? r.createdBy, title: "Supplier's Form (PO / Purchases)", header: [['Control #', r.controlNo], ['Date', dateStr(r.docDate)], ['Supplier', canCost ? `${r.supplier.code} ${r.supplier.name}` : r.supplier.code], ['Supplier Ref', r.supplierRef ?? ''], ['Received at', r.location.name]], columns: ['Qty', 'Free', 'Items', 'Batch', 'Expiry', ...(canCost ? ['Unit Cost', 'Amount'] : []), 'Remarks'], rows: r.lines.map((l) => [l.qty, l.freeQty, l.product.name, l.batchNo ?? '', l.expiryDate ? dateStr(l.expiryDate) : '', ...(canCost ? [l.unitCost ?? '', D(l.unitCost ?? 0).mul(l.qty)] : []), l.remarks ?? '']) };
      }
      case 'count': {
        const c = await db.countDoc.findUnique({ where: { id }, include: { location: true, lines: { include: { product: true }, orderBy: { product: { name: 'asc' } } } } }); if (!c) throw new NotFoundException(); scope(c.locationId);
        const exp = await this.stock.expiriesAt(c.locationId, c.lines.map((l) => l.productId));
        const moves = await this.stock.dayMovements(c.locationId, c.countDate);
        return { status: c.status, docType: 'CountDoc', preparedBy: c.createdBy, title: c.countType === 'WEEKLY' ? 'Weekly Inventory Count Sheet' : 'Actual Inventory Count', header: [['Control #', c.controlNo], ['Location', c.location.name], ['Count date', dateStr(c.countDate)], ['Type', c.countType === 'WEEKLY' ? 'Weekly count (branch staff)' : 'Audit count'], ['Order', 'Items with a system quantity first, then items not in the system']], columns: ['SKU', 'Item', 'System', 'Expiries on hand (qty)', 'Beginning (start of day)', '+ Received', '+ Transfer in', '+ Returns', '− Sales', '− Transfer out', '± Other', 'Expected', 'Actual count', 'Variance', 'Remarks'], rows: sortCountLines(c.lines).map((l) => { const m = moves.get(l.productId) ?? { received: 0, transferIn: 0, returns: 0, sales: 0, transferOut: 0, other: 0 }; return [l.product.sku, l.product.name, inSystem(l) ? 'In system' : 'Not in system', (exp.get(l.productId) ?? []).map((e) => `${e.expiry} ×${e.qty}`).join(', '), l.beginQty, m.received || '', m.transferIn || '', m.returns || '', m.sales || '', m.transferOut || '', m.other || '', l.systemQty, l.actualQty ?? '', c.status === 'DRAFT' ? '' : l.variance, l.remarks ?? '']; }), signatures: ['Counted by', 'Witnessed by', 'Reviewed by'] };
      }
      case 'discrepancy': {
        const c = await db.discrepancyCase.findUnique({ where: { id }, include: { countDoc: { include: { location: true, lines: { include: { product: true } } } } } }); if (!c) throw new NotFoundException(); scope(c.countDoc.locationId);
        return { title: c.status === 'FINALIZED' ? 'Final Discrepancy Report' : 'Discrepancy Report', header: [['Case #', c.caseNo ?? '—'], ['Count #', c.countDoc.controlNo], ['Location', c.countDoc.location.name], ['Count date', dateStr(c.countDoc.countDate)], ['Deadline', dateStr(c.deadline)], ['Status', c.status], ...(c.resolutionNote ? [['Resolution', c.resolutionNote] as [string, unknown]] : [])], columns: ['SKU', 'Name', 'Expected', 'Actual Qty', 'Variance', 'Remarks'], rows: c.countDoc.lines.filter((l) => l.variance !== 0).map((l) => [l.product.sku, l.product.name, l.systemQty, l.actualQty ?? '', l.variance, l.remarks ?? '']) };
      }
      case 'charge-form': {
        const cf = await db.chargeForm.findUnique({ where: { id }, include: { location: true, lines: { include: { product: true } }, allocations: { include: { employee: true } } } }); if (!cf) throw new NotFoundException();
        const mine = await this.myEmployeeId(user);
        const hr = ['charge_form.finalize', 'payroll.view.detail', 'charge.assign', 'discrepancy.resolve'].some((k) => user.permissions.has(k));
        if (!hr && !cf.allocations.some((a) => a.employeeId === mine)) throw new ForbiddenException('Charge forms are visible only to HR, the Head Auditor and the people charged');
        const allocs = hr ? cf.allocations : cf.allocations.filter((a) => a.employeeId === mine);
        return { title: `Charge Form — ${KIND_LABEL[cf.kind]}`, header: [['Control #', cf.controlNo], ['Location', cf.location.name], ['Reason', cf.reason ?? KIND_LABEL[cf.kind]], ['Created', dateStr(cf.createdAt)], ['Finalized by HR', cf.finalizedByHrAt ? dateStr(cf.finalizedByHrAt) : 'Not yet']], columns: ['Item / description', 'Qty', 'Unit charge', 'Amount'], rows: [...cf.lines.map((l) => [l.product ? `${l.product.name}${l.description ? ` (${l.description})` : ''}` : l.description ?? '', l.qty, l.unitCharge, l.amount]), ...allocs.map((a) => [`Charged to: ${a.employee.fullName} (${a.employee.employeeNo})${a.acknowledgedAt ? ` — acknowledged ${a.acknowledgedAt.toISOString().slice(0, 16).replace('T', ' ')}` : ' — not yet acknowledged'}`, '', '', a.amount])], footer: [['TOTAL', cf.totalAmount]], signatures: ['Prepared by (HR)', 'Employee acknowledgement', 'Approved by'] };
      }
      case 'deduction-authorization': {
        const a = await db.chargeFormAllocation.findUnique({ where: { id }, include: { employee: true, chargeForm: { include: { location: true } } } }); if (!a) throw new NotFoundException();
        const mine = await this.myEmployeeId(user);
        if (!['charge_form.finalize', 'payroll.view.detail'].some((k) => user.permissions.has(k)) && a.employeeId !== mine) throw new ForbiddenException();
        const sched = (a.chargeForm.payrollDeductionSchedule as { employeeId: string; periods: number; perPeriod: number }[] | null)?.find((x) => x.employeeId === a.employeeId);
        return { title: 'Salary Deduction Authorization', header: [['Employee', `${a.employee.fullName} (${a.employee.employeeNo})`], ['Charge form', `${a.chargeForm.controlNo} — ${KIND_LABEL[a.chargeForm.kind]}`], ['Branch', a.chargeForm.location.name], ['Amount charged', a.amount], ['Deduction schedule', sched ? `${sched.periods} payroll period(s) of ₱${sched.perPeriod.toFixed(2)}` : 'Next payroll'], ['Deducted to date', a.deductedToDate], ['Acknowledged in the system', a.acknowledgedAt ? a.acknowledgedAt.toISOString().slice(0, 16).replace('T', ' ') : 'Not yet']], columns: ['Statement'], rows: [[`I, ${a.employee.fullName}, authorize Get Wheysted Supplements to deduct the amount above from my salary for charge form ${a.chargeForm.controlNo}.`]], signatures: ['Employee signature over printed name', 'HR'] };
      }
      case 'payslip': {
        const l = await db.payrollLine.findUnique({ where: { id }, include: { employee: { include: { location: true } }, run: true } }); if (!l) throw new NotFoundException();
        if (!user.permissions.has('payroll.view.detail') && l.employeeId !== (await this.myEmployeeId(user))) throw new ForbiddenException();
        const gross = D(l.basic).plus(l.overtime).plus(l.incentives);
        return { title: 'Payslip', header: [['Employee', `${l.employee.fullName} (${l.employee.employeeNo})`], ['Branch', l.employee.location?.name ?? 'Office'], ['Period', `${dateStr(l.run.periodFrom)} to ${dateStr(l.run.periodTo)}`], ['SSS / PhilHealth / Pag-IBIG no.', [l.employee.sssNo, l.employee.phicNo, l.employee.hdmfNo].map((x) => x ?? '—').join(' / ')]], columns: ['Earnings / deductions', 'Amount'], rows: [['Basic pay', l.basic], ['Overtime', l.overtime], ['Incentives', l.incentives], ['GROSS PAY', gross], ['SSS (employee share)', D(l.sssEe).neg()], ['PhilHealth (employee share)', D(l.phicEe).neg()], ['Pag-IBIG (employee share)', D(l.hdmfEe).neg()], ['Loans / cash advances', D(l.loans).neg()], ['Charges (inventory / cash shortage / others)', D(l.chargeDeductions).neg()], ['Other deductions', D(l.otherDeductions).neg()]], footer: [['NET PAY', l.netPay], ['Employer share (not deducted): SSS / PhilHealth / Pag-IBIG', `${l.sssEr} / ${l.phicEr} / ${l.hdmfEr}`]], signatures: ['Received by (employee)', 'Prepared by (HR)'] };
      }
      case 'employee-ledger': {
        const e = await db.employee.findUnique({ where: { id }, include: { location: true, chargeAllocations: { include: { chargeForm: true } }, loans: true, payrollLines: { include: { run: true }, where: { run: { status: { in: ['FINALIZED', 'CLOSED'] } } }, orderBy: { run: { periodTo: 'asc' } } } } }); if (!e) throw new NotFoundException();
        if (!['employee.manage', 'payroll.view.detail'].some((k) => user.permissions.has(k)) && e.id !== (await this.myEmployeeId(user))) throw new ForbiddenException();
        const rows: unknown[][] = [];
        for (const a of e.chargeAllocations) rows.push([dateStr(a.chargeForm.createdAt), `Charge ${a.chargeForm.controlNo} — ${KIND_LABEL[a.chargeForm.kind]}`, a.amount, '', D(a.amount).minus(a.deductedToDate)]);
        for (const l of e.loans) rows.push([dateStr(l.createdAt), `${l.kind.replace(/_/g, ' ')} (₱${l.perPeriod}/period)`, l.principal, '', l.balance]);
        for (const p of e.payrollLines) if (D(p.chargeDeductions).gt(0) || D(p.loans).gt(0)) rows.push([dateStr(p.run.periodTo), `Payroll deduction ${dateStr(p.run.periodFrom)}–${dateStr(p.run.periodTo)}`, '', D(p.chargeDeductions).plus(p.loans), '']);
        rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
        const open = e.chargeAllocations.reduce((t, a) => t.plus(a.amount).minus(a.deductedToDate), ZERO).plus(e.loans.reduce((t, l) => t.plus(l.balance), ZERO));
        return { title: 'Employee Ledger (charges, loans, advances)', header: [['Employee', `${e.fullName} (${e.employeeNo})`], ['Branch', e.location?.name ?? 'Office'], ['Position', e.position ?? '']], columns: ['Date', 'Particulars', 'Charged / borrowed', 'Deducted', 'Balance'], rows, footer: [['OUTSTANDING BALANCE', open]], signatures: ['Employee', 'HR'] };
      }
      case 'contributions': {
        if (!user.permissions.has('payroll.view.detail')) throw new ForbiddenException('The contributions register lists names; ask HR or the Accounting Head');
        const [y, m] = id.split('-').map(Number);
        const reg = await this.payroll.contributionsRegister(y, m, user);
        return { title: `Government Contributions Register ${id}`, header: reg.agencies.map((a) => [`${a.label}`, `EE ₱${a.employeeShare.toFixed(2)} + ER ₱${a.employerShare.toFixed(2)} = ₱${a.total.toFixed(2)}${a.remitted ? ` — remitted ${dateStr(a.remitted.paidAt)} ref ${a.remitted.referenceNo}` : ' — payable'}`] as [string, unknown]), columns: ['Employee', 'SSS no.', 'SSS EE', 'SSS ER', 'PhilHealth no.', 'PHIC EE', 'PHIC ER', 'Pag-IBIG no.', 'HDMF EE', 'HDMF ER'], rows: (reg.rows ?? []).map((r) => [`${r.name} (${r.employeeNo})`, r.sssNo ?? '', r.sssEe, r.sssEr, r.phicNo ?? '', r.phicEe, r.phicEr, r.hdmfNo ?? '', r.hdmfEe, r.hdmfEr]), signatures: ['Prepared by (HR)', 'Checked by (Accounting Head)'] };
      }
      case 'inspection': {
        const r = await db.storeInspection.findUnique({ where: { id }, include: { location: true } }); if (!r) throw new NotFoundException();
        const mine = await this.myEmployeeId(user);
        if (!['inspection.view', 'inspection.review'].some((k) => user.permissions.has(k)) && r.inspectorId !== user.id && r.staffOnDutyEmployeeId !== mine) throw new ForbiddenException();
        const people = await db.user.findMany({ where: { id: { in: [r.inspectorId, r.staffAcknowledgedBy, r.hrReviewedBy].filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
        const staff = r.staffOnDutyEmployeeId ? await db.employee.findUnique({ where: { id: r.staffOnDutyEmployeeId }, select: { fullName: true } }) : null;
        const nm = (x: string | null) => people.find((p) => p.id === x)?.fullName ?? '';
        const answers = r.items as unknown as { key: string; status: string | null; date?: string | null; amount?: number | null; reason?: string | null }[];
        const rows: unknown[][] = []; let section = '';
        for (const c of CHECKLIST) {
          if (c.section !== section) { section = c.section; rows.push([section, '', '', '', '', '']); }
          const a = answers.find((x) => x.key === c.key);
          const extra = [a?.date ? `Date updated: ${a.date}` : '', a?.amount != null ? `Amount: ₱${Number(a.amount).toFixed(2)}${r.cashFundSystem != null && c.key === 'cash_fund' ? ` (system ₱${r.cashFundSystem})` : ''}` : '', a?.reason ? `Reason: ${a.reason}` : ''].filter(Boolean).join(' · ');
          rows.push([c.no, `${c.group ? `${c.group}: ` : ''}${c.label}`, a?.status === 'COMPLIED' ? '✔' : '', a?.status === 'NO' ? '✔' : '', a?.status === 'NA' ? 'N/A' : '', extra]);
        }
        return { status: r.status === 'DRAFT' ? 'DRAFT' : 'POSTED', title: 'Store Inspection Report', header: [['Control #', r.controlNo], ['Date', dateStr(r.inspectionDate)], ['Name of inspector', nm(r.inspectorId)], ['Branch', r.location.name], ['Name of staff on duty', staff?.fullName ?? r.staffOnDutyName ?? ''], ['Comments', r.comments ?? ''], ['Staff acknowledged', r.staffAcknowledgedAt ? `${nm(r.staffAcknowledgedBy)} ${r.staffAcknowledgedAt.toISOString().slice(0, 16).replace('T', ' ')}` : 'Not yet'], ['HR review', r.hrReviewedAt ? `${nm(r.hrReviewedBy)} ${dateStr(r.hrReviewedAt)}${r.hrNotes ? ` — ${r.hrNotes}` : ''}` : 'Not yet']], columns: ['No.', 'Item', 'Complied', 'No', 'N/A', 'Details'], rows, signatures: [`Staff: ${staff?.fullName ?? r.staffOnDutyName ?? ''} (signature over printed name)`, `Inspector: ${nm(r.inspectorId)}`] };
      }
      case 'fund-replenishment': {
        const t = await db.cashFundTxn.findUnique({ where: { id }, include: { fund: { include: { location: true } } } }); if (!t || t.kind !== 'REPLENISH') throw new NotFoundException(); scope(t.locationId);
        if (!['cashfund.view.all', 'cashfund.use', 'cashfund.manage', 'cashfund.check'].some((k) => user.permissions.has(k))) throw new ForbiddenException();
        const prev = await db.cashFundTxn.findFirst({ where: { fundId: t.fundId, kind: 'REPLENISH', createdAt: { lt: t.createdAt } }, orderBy: { createdAt: 'desc' } });
        const spent = await db.cashFundTxn.findMany({ where: { fundId: t.fundId, kind: { in: ['EXPENSE', 'EXPENSE_VOID'] }, createdAt: { gt: prev?.createdAt ?? new Date(0), lte: t.createdAt } }, orderBy: { createdAt: 'asc' } });
        const docs = await db.expenseDoc.findMany({ where: { locationId: t.locationId, id: { in: spent.map((x) => x.expenseDocId).filter((x): x is string => !!x) } }, include: { account: true } });
        return { title: 'Cash Fund Replenishment Voucher', header: [['Voucher #', t.controlNo ?? t.id.slice(0, 8)], ['Branch', t.fund.location.name], ['Date', dateStr(t.businessDate)], ['Fund amount (imprest)', t.fund.imprestAmount], ['Replenished from cash sales', t.amount]], columns: ['Date', 'Expense #', 'Account', 'Payee / notes', 'Amount'], rows: spent.map((x) => { const d = docs.find((e) => e.id === x.expenseDocId); return [dateStr(x.businessDate), d?.controlNo ?? '', d?.account.title ?? '', d?.payee ?? x.notes ?? '', D(x.amount).neg()]; }), footer: [['TOTAL SPENT FROM FUND', spent.reduce((a, x) => a.minus(x.amount), ZERO)], ['REPLENISHED', t.amount]], signatures: ['Prepared by', 'Checked by', 'Approved by'] };
      }
      case 'agent-incentive': {
        // incentive release form (owner request 2026-09-30): HR prints it for the agent to sign; Accounting tags the payment
        const e = await db.agentIncentive.findUnique({ where: { id } }); if (!e) throw new NotFoundException();
        if (!user.permissions.has('incentive.view') && e.agentUserId !== user.id) throw new ForbiddenException();
        const acct = e.releaseAccountId ? await db.account.findUnique({ where: { id: e.releaseAccountId }, select: { title: true } }) : null;
        const peso = (v: unknown) => Number(v).toLocaleString('en-PH', { minimumFractionDigits: 2 });
        return { status: e.status === 'PENDING' ? 'PENDING' : e.status, preparedBy: e.preparedBy, title: 'Agent Incentive Release Form',
          header: [['Form #', e.formNo ?? '(given on approval)'], ['Agent', e.agentName], ['Month', e.month], ['Branches', e.branches.join(', ')], ['Approved', e.approvedAt ? dateStr(e.approvedAt) : 'Not yet']],
          columns: ['Description', 'Amount (₱)'],
          rows: [[`Total sales, ${e.month} (${e.transactions} DR/SI, all branches)`, peso(e.totalSales)], ['Collected so far', peso(e.collected)], [e.ratePct != null ? `Incentive at ${Number(e.ratePct)}% of sales` : 'Incentive (amount set by the Sales Manager)', peso(e.amount)]],
          footer: [['Incentive to release', peso(e.amount)], ['Released', e.releasedAt ? `${(e.releaseMode ?? '').replace('_', ' ').toLowerCase()}${acct ? ` · ${acct.title}` : ''}${e.releaseReference ? ` · ref ${e.releaseReference}` : ''} · ${e.releaseDate ? dateStr(e.releaseDate) : ''}` : 'Not yet']],
          signatures: ['Prepared by (Sales Manager)', 'Checked by (Accounting)', 'Approved by (Owner)', 'Released by (HR)', 'Received by (Agent)'] };
      }
      case 'credit-note': {
        const p = await db.payment.findUnique({ where: { id }, include: { customer: true, allocations: { include: { salesDoc: true } } } }); if (!p) throw new NotFoundException();
        return { title: 'Credit Note', header: [['Credit Note #', p.creditNoteNo], ['Date', dateStr(p.businessDate)], ['Customer', p.customer?.name ?? ''], ['Mode', p.paymentMode]], columns: ['DR/SI #', 'Invoice total', 'Applied'], rows: p.allocations.map((a) => [a.salesDoc.drSiNo, a.salesDoc.grandTotal, a.amount]), footer: [['Amount received', p.amount], ['Discount', p.discount]] };
      }
      case 'voucher': {
        const v = await db.journalVoucher.findUnique({ where: { id }, include: { lines: { include: { account: true }, orderBy: { lineNo: 'asc' } } } }); if (!v) throw new NotFoundException(); if (!user.permissions.has('gl.view')) throw new ForbiddenException();
        return { title: 'Journal Voucher', header: [['Voucher No', v.voucherNo], ['Date', dateStr(v.date)], ['Books', v.book], ['Reference', v.reference ?? ''], ['Remarks', v.remarks ?? ''], ['Name', v.name ?? '']], columns: ['Code', 'Account Title', 'Debit', 'Credit'], rows: v.lines.map((l) => [l.account.code, l.account.title, l.debit, l.credit]), footer: [['Total Debit', v.lines.reduce((s, l) => s.plus(l.debit), ZERO)], ['Total Credit', v.lines.reduce((s, l) => s.plus(l.credit), ZERO)]], signatures: ['Prepared by', 'Checked by', 'Approved by'] };
      }
      default: throw new NotFoundException(`Unknown form ${type}`);
    }
  }

  // ── Financial exports (layouts: Beg, Jan…Dec, Total) ──
  async trialBalanceXlsx(year: number, user: SessionUser): Promise<Out> { const tb = await this.fin.trialBalance(year); await this.logExport(user, 'TrialBalance.xlsx', { year }); return { buffer: await this.xlsx.matrix(`Trial Balance ${year}`, tb.rows.map((r) => ({ code: r.code, title: r.title, beg: r.beg, months: r.months })), { withBeg: true }), contentType: XLSX, fileName: `TrialBalance_${year}.xlsx` }; }
  async incomeStatementXlsx(year: number, user: SessionUser): Promise<Out> {
    const is = await this.fin.incomeStatement(year);
    const rows = [...is.sections.revenues.map((r) => ({ code: r.code, title: r.title, months: r.months, section: 'REVENUES' })), ...is.sections.directCost.map((r) => ({ code: r.code, title: r.title, months: r.months, section: 'DIRECT COST' })), ...is.sections.operatingExpenses.map((r) => ({ code: r.code, title: r.title, months: r.months, section: 'OPERATING EXPENSES' })), ...is.sections.otherIncome.map((r) => ({ code: r.code, title: r.title, months: r.months, section: 'OTHER INCOME' })), { title: 'GROSS PROFIT', months: is.totals.grossProfit.months, section: 'SUMMARY' }, { title: 'NET INCOME', months: is.totals.netIncome.months, section: 'SUMMARY' }];
    await this.logExport(user, 'IncomeStatement.xlsx', { year });
    return { buffer: await this.xlsx.matrix(`Income Statement ${year}`, rows, { sections: true }), contentType: XLSX, fileName: `IncomeStatement_${year}.xlsx` };
  }
  async balanceSheetXlsx(year: number, user: SessionUser): Promise<Out> {
    const bs = await this.fin.balanceSheet(year);
    const rows = [...bs.sections.assets.map((r) => ({ code: r.code, title: r.title, beg: r.beg, months: r.asOf, section: 'ASSETS' })), ...bs.sections.accumulatedDepreciation.map((r) => ({ code: r.code, title: r.title, beg: r.beg.neg(), months: r.asOf.map((x) => x.neg()), section: 'ASSETS' })), ...bs.sections.liabilities.map((r) => ({ code: r.code, title: r.title, beg: r.beg, months: r.asOf, section: 'LIABILITIES' })), ...bs.sections.equity.map((r) => ({ code: r.code, title: r.title, beg: r.beg, months: r.asOf, section: 'EQUITY' })), { title: 'Net Income to date', beg: ZERO, months: bs.totals.netIncomeToDate.slice(1), section: 'EQUITY' }, { title: 'Should be 0', beg: bs.totals.shouldBeZero[0], months: bs.totals.shouldBeZero.slice(1), section: 'CHECK' }];
    await this.logExport(user, 'BalanceSheet.xlsx', { year });
    return { buffer: await this.xlsx.matrix(`Balance Sheet ${year}`, rows, { withBeg: true, sections: true }), contentType: XLSX, fileName: `BalanceSheet_${year}.xlsx` };
  }
  async niPerBranchXlsx(year: number, user: SessionUser): Promise<Out> {
    const ni = await this.fin.netIncomePerBranch(year);
    const cols = [{ header: 'Line', key: 'line', width: 28 }, ...ni.columns.map((c) => ({ header: c.name, key: c.id, numFmt: '#,##0.00' })), { header: 'Total', key: 'total', numFmt: '#,##0.00' }];
    const line = (label: string, k: keyof (typeof ni.columns)[number], tot: unknown) => ({ line: label, ...Object.fromEntries(ni.columns.map((c) => [c.id, c[k]])), total: tot });
    const rows = [line('Revenues', 'revenues', ni.total.revenues), line('Direct Cost', 'directCost', ni.total.directCost), line('Direct Cost – Conso', 'directCostConso', ni.total.directCostConso), line('Gross Profit', 'grossProfit', ni.total.grossProfit), line('OPEX / branch', 'opex', ni.total.opex), line('OPEX Conso', 'opexConso', ni.total.opexConso), line('Net Income', 'netIncome', ni.total.netIncome)];
    await this.logExport(user, 'NIperBranch.xlsx', { year });
    return { buffer: await this.xlsx.table('SUMMARY', cols, rows, { title: `Net Income per Branch ${year}` }), contentType: XLSX, fileName: `NIperBranch_${year}.xlsx` };
  }
  async cashFlowXlsx(year: number, user: SessionUser): Promise<Out> {
    const cf = await this.fin.cashFlow(year);
    const keys = ['netIncome', 'depreciation', 'arChange', 'inventoryChange', 'advancesChange', 'liabilitiesChange', 'operating', 'investing', 'financing', 'netChange', 'cashChange', 'check'] as const;
    const rows = keys.map((k) => ({ title: k, months: cf.months.map((m) => m[k]) }));
    await this.logExport(user, 'CashFlow.xlsx', { year });
    return { buffer: await this.xlsx.matrix(`Cash Flow ${year}`, rows), contentType: XLSX, fileName: `CashFlow_${year}.xlsx` };
  }
  async scheduleXlsx(year: number, kind: 'SALES' | 'DIRECT_COST' | 'OPEX' | 'ASSETS', user: SessionUser): Promise<Out> {
    const s = await this.fin.schedule(year, kind);
    const rows = [...s.rows.map((r) => ({ code: r.code, title: r.title, months: r.months, section: r.branchName ?? 'Main/Conso' })), ...s.perBranch.map((b) => ({ title: `${b.branch} — MoM %`, months: b.momPct.map((x) => x ?? 0), section: 'MONTH-OVER-MONTH %' }))];
    await this.logExport(user, `${kind}_Schedule.xlsx`, { year });
    return { buffer: await this.xlsx.matrix(`${kind} ${year}`, rows, { sections: true }), contentType: XLSX, fileName: `${kind}_${year}.xlsx` };
  }
  months() { return MONTHS; }
}
