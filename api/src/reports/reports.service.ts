import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { XlsxService, type Col } from './xlsx.service';
import { PdfService } from './pdf.service';
import { AuditService } from '../common/audit.service';
import { StockService } from '../stock/stock.service';
import { FinReportsService, MONTHS } from '../gl/fin-reports.service';
import { buildDailySalesReport, RSale } from './daily-sales-report';
import { toDateOnly, dateStr } from '../common/manila';
import { D, ZERO } from '../common/money';
import type { SessionUser } from '../common/request-context';

export type Out = { buffer: Buffer; contentType: string; fileName: string };
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** §7.8 / §8.5 / §13 reports and exports. Every export is audit-logged (§14). */
@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService, private xlsx: XlsxService, private pdf: PdfService, private audit: AuditService, private stock: StockService, private fin: FinReportsService) {}

  private async logExport(user: SessionUser, report: string, params: unknown) { await this.audit.log({ action: 'EXPORT', entityType: 'Report', entityId: report, after: params, userId: user.id }); }

  async dailySalesData(locationId: string, date: string, user: SessionUser, withMargin = false) {
    if (user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException();
    const loc = await this.prisma.db.location.findUnique({ where: { id: locationId } }); if (!loc) throw new NotFoundException();
    const d = toDateOnly(date);
    const sales = await this.prisma.db.salesDoc.findMany({ where: { locationId, docDate: d, voidedAt: null }, include: { lines: { include: { product: { include: { category: true } } } }, agent: true, rider: true, customer: true }, orderBy: { drSiNo: 'asc' } });
    const expenses = await this.prisma.db.expenseDoc.findMany({ where: { locationId, docDate: d, voidedAt: null }, include: { account: true } });
    const close = await this.prisma.db.dailyClose.findUnique({ where: { locationId_businessDate: { locationId, businessDate: d } } });
    const rs: RSale[] = sales.map((s) => ({ id: s.id, drSiNo: s.drSiNo, channel: s.channel, channelSub: s.channelSub, paymentMode: s.paymentMode, customerName: s.customer?.name ?? s.customerName, agentName: s.agent?.name ?? null, riderName: s.rider?.name ?? null, deliveryFee: s.deliveryFee, riderIncentive: s.riderIncentive, shippingFee: s.shippingFee, shippingExpense: s.shippingExpense, marketplaceCharges: s.marketplaceCharges, productTotal: s.productTotal, grandTotal: s.grandTotal, cardMid: s.cardMid, cardSlipNo: s.cardSlipNo, cardApprovalCode: s.cardApprovalCode, cardBatchNo: s.cardBatchNo, notes: s.notes, lines: s.lines.map((l) => ({ productName: l.product.name, qty: l.qty, unitPrice: l.unitPrice, amount: l.amount, isFreebie: l.isFreebie, accountingClass: l.product.category.accountingClass })) }));
    const rep = buildDailySalesReport({ branch: loc.name, date, sales: rs, expenses: expenses.map((e) => ({ accountTitle: e.account.title, payee: e.payee, amount: e.amount, paidFrom: e.paidFrom })), close: close ? { moneyBreakdown: close.moneyBreakdown as Record<string, number> | null, countedCash: close.countedCash, expectedCash: close.expectedCash, cashVariance: close.cashVariance } : null, preparedBy: user.fullName });
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
    const cols = [{ header: 'Location', key: 'location' }, { header: 'SKU', key: 'sku' }, { header: 'Product', key: 'product', width: 40 }, { header: 'Batch', key: 'batchNo' }, { header: 'Expiry', key: 'expiryDate' }, { header: 'Qty', key: 'qty' }, ...(canCost ? [{ header: 'Unit Cost', key: 'unitCost', numFmt: '#,##0.00' }, { header: 'Value at Cost', key: 'valueAtCost', numFmt: '#,##0.00' }] : [])];
    await this.logExport(user, 'StockOnHand.xlsx', { locationId });
    return { buffer: await this.xlsx.table('Stock on hand', cols, rows.map((r) => ({ location: r.location.name, sku: r.product.sku, product: r.product.name, batchNo: r.batchNo, expiryDate: r.expiryDate, qty: r.qty, unitCost: r.unitCost, valueAtCost: r.valueAtCost })), { title: 'Stock on Hand', totals: canCost ? ['qty', 'valueAtCost'] : ['qty'] }), contentType: XLSX, fileName: 'StockOnHand.xlsx' };
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
    const prodCols: Col[] = [{ header: 'SKU', key: 'sku', width: 12 }, { header: 'Brand', key: 'brand', width: 16 }, { header: 'Item', key: 'name', width: 44 }];
    const flat = (p: (typeof rep.products)[number]) => ({ sku: p.product.sku, brand: p.product.brand ?? '', name: p.product.name });
    const summary = rep.products.map((p) => ({ ...flat(p), ...p, ...(canCost ? { unitCost: p.unitCost } : {}) }));
    const perDay = rep.products.flatMap((p) => p.days.filter((d) => d.receive || d.transferIn || d.returns || d.pullOut || d.sales || d.other || d.adjust).map((d) => ({ ...flat(p), ...d })));
    const sheets = [
      { name: 'Summary', title: head, subtitle, columns: [...prodCols, ...qtyCols, ...costCols, ...(canCost ? [{ header: 'Unit Cost (avg)', key: 'unitCost', numFmt: money }] : [])], rows: summary as Record<string, unknown>[], totals },
      { name: 'Per day', title: `${head} — movements per day`, columns: [{ header: 'Date', key: 'date', width: 12 }, ...prodCols, ...qtyCols, ...costCols], rows: perDay as Record<string, unknown>[], totals },
      ...rep.days.map((day) => ({ name: day, title: `${rep.location.name} — ${day}`, columns: [...prodCols, ...qtyCols, ...costCols], rows: rep.products.map((p) => ({ ...flat(p), ...p.days.find((d) => d.date === day)! })).filter((r) => r.beg || r.end || r.receive || r.transferIn || r.returns || r.pullOut || r.sales || r.other || r.adjust) as Record<string, unknown>[], totals })),
    ];
    await this.logExport(user, 'DailyInventoryReport.xlsx', { locationId, from, to, withCost: canCost });
    return { buffer: await this.xlsx.workbook(sheets), contentType: XLSX, fileName: `DailyInventory_${rep.location.name.replace(/\W+/g, '')}_${from}_${to}.xlsx` };
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
    const f = await this.formData(type, id, user);
    await this.logExport(user, `${type}.${format}`, { id });
    if (format === 'xlsx') return { buffer: await this.xlsx.table(f.title, f.columns.map((c, i) => ({ header: c, key: String(i) })), f.rows.map((r) => Object.fromEntries(r.map((v, i) => [String(i), v]))), { title: `${f.title} — ${f.header.map(([k, v]) => `${k}: ${v}`).join(' | ')}` }), contentType: XLSX, fileName: `${f.title.replace(/\W+/g, '_')}_${id.slice(0, 8)}.xlsx` };
    const r = await this.pdf.render(this.pdf.formHtml(f.title, f.header, f.columns, f.rows, f.footer, f.signatures));
    return { buffer: r.buffer, contentType: r.contentType, fileName: `${f.title.replace(/\W+/g, '_')}_${id.slice(0, 8)}.${r.ext}` };
  }
  private async formData(type: string, id: string, user: SessionUser): Promise<{ title: string; header: [string, unknown][]; columns: string[]; rows: unknown[][]; footer?: [string, unknown][]; signatures?: string[] }> {
    const db = this.prisma.db; const canCost = user.permissions.has('cost.view');
    const scope = (locationId: string) => { if (user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException(); };
    switch (type) {
      case 'pull-out': case 'transfer-in': {
        const t = await db.transferDoc.findUnique({ where: { id }, include: { fromLocation: true, toLocation: true, lines: { include: { product: true, batch: true } } } }); if (!t) throw new NotFoundException(); if (user.locationScoped && !user.locationIds.includes(t.fromLocationId) && !user.locationIds.includes(t.toLocationId)) throw new ForbiddenException();
        return { title: type === 'pull-out' ? 'Pull-Out Form' : 'Transfer-In Form', header: [['Control #', t.controlNo], ['Date', dateStr(t.docDate)], ['From', t.fromLocation.name], ['Trans. To', t.toLocation.name], ['Type', t.transferType], ['Notes', t.notes ?? '']], columns: ['Qty Out', 'Items', 'Batch / Expiry', "Checker's", 'Received Qty', 'Remarks', 'Type'], rows: t.lines.map((l) => [l.qtySent, l.product.name, `${l.batch.batchNo ?? ''} ${l.batch.expiryDate ? dateStr(l.batch.expiryDate) : ''}`, l.checkerRemarks ?? '', l.qtyReceived ?? '', l.discrepancyNote ?? '', t.transferType]), signatures: ['Prepared by', 'Checked by', 'Received by'] };
      }
      case 'dr-sales': {
        const s = await db.salesDoc.findUnique({ where: { id }, include: { location: true, customer: true, lines: { include: { product: true } } } }); if (!s) throw new NotFoundException(); scope(s.locationId);
        return { title: 'Delivery Receipt – Sales', header: [['Control #', s.controlNo], ['DR/SI #', s.drSiNo], ['Date', dateStr(s.docDate)], ['Trans. To', s.location.name], ['Name', s.customer?.name ?? s.customerName ?? ''], ['Mode of Payment', s.paymentMode]], columns: ['Qty', 'Items', 'S. Price/Unit', 'Amount', 'Remarks'], rows: s.lines.map((l) => [l.qty, l.product.name, l.unitPrice, l.amount, l.lineRemarks ?? (l.isFreebie ? 'FREEBIE' : '')]), footer: [['Product total', s.productTotal], ['Delivery fee', s.deliveryFee], ['Shipping fee', s.shippingFee], ['TOTAL', s.grandTotal]] };
      }
      case 'supplier-form': {
        const r = await db.receivingDoc.findUnique({ where: { id }, include: { supplier: true, location: true, lines: { include: { product: true } } } }); if (!r) throw new NotFoundException(); scope(r.locationId);
        return { title: "Supplier's Form (PO / Purchases)", header: [['Control #', r.controlNo], ['Date', dateStr(r.docDate)], ['Supplier', canCost ? `${r.supplier.code} ${r.supplier.name}` : r.supplier.code], ['Supplier Ref', r.supplierRef ?? ''], ['Received at', r.location.name]], columns: ['Qty', 'Free', 'Items', 'Batch', 'Expiry', ...(canCost ? ['Unit Cost', 'Amount'] : []), 'Remarks'], rows: r.lines.map((l) => [l.qty, l.freeQty, l.product.name, l.batchNo ?? '', l.expiryDate ? dateStr(l.expiryDate) : '', ...(canCost ? [l.unitCost ?? '', D(l.unitCost ?? 0).mul(l.qty)] : []), l.remarks ?? '']) };
      }
      case 'count': {
        const c = await db.countDoc.findUnique({ where: { id }, include: { location: true, lines: { include: { product: true } } } }); if (!c) throw new NotFoundException(); scope(c.locationId);
        return { title: 'Actual Inventory Count', header: [['Control #', c.controlNo], ['Location', c.location.name], ['Count date', dateStr(c.countDate)]], columns: ['SKU', 'Name', 'System Qty', 'Actual Qty', 'Variance', 'Remarks'], rows: c.lines.map((l) => [l.product.sku, l.product.name, l.systemQty, l.actualQty ?? '', l.variance, l.remarks ?? '']), signatures: ['Counted by', 'Witnessed by', 'Reviewed by'] };
      }
      case 'discrepancy': {
        const c = await db.discrepancyCase.findUnique({ where: { id }, include: { countDoc: { include: { location: true, lines: { include: { product: true } } } } } }); if (!c) throw new NotFoundException(); scope(c.countDoc.locationId);
        return { title: c.status === 'FINALIZED' ? 'Final Discrepancy Report' : 'Discrepancy Report', header: [['Count #', c.countDoc.controlNo], ['Location', c.countDoc.location.name], ['Count date', dateStr(c.countDoc.countDate)], ['Deadline', dateStr(c.deadline)], ['Status', c.status]], columns: ['SKU', 'Name', 'System Qty', 'Actual Qty', 'Variance', 'Remarks'], rows: c.countDoc.lines.filter((l) => l.variance !== 0).map((l) => [l.product.sku, l.product.name, l.systemQty, l.actualQty ?? '', l.variance, l.remarks ?? '']) };
      }
      case 'charge-form': {
        const cf = await db.chargeForm.findUnique({ where: { id }, include: { location: true, lines: { include: { product: true } }, allocations: { include: { employee: true } } } }); if (!cf) throw new NotFoundException();
        return { title: 'Charge Form', header: [['Control #', cf.controlNo], ['Location', cf.location.name], ['Reason', cf.reason ?? 'Inventory discrepancy'], ['Finalized', cf.finalizedByHrAt ? cf.finalizedByHrAt.toISOString().slice(0, 10) : 'No']], columns: ['Product', 'Qty', 'Unit Charge', 'Amount'], rows: [...cf.lines.map((l) => [l.product.name, l.qty, l.unitCharge, l.amount]), ...cf.allocations.map((a) => [`Charged to: ${a.employee.fullName} (${a.employee.employeeNo})`, '', '', a.amount])], footer: [['TOTAL', cf.totalAmount]], signatures: ['HR', 'Employee acknowledgement', 'Approved by'] };
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
