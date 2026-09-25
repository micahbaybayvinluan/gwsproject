import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { DailySalesReport, asNum } from './daily-sales-report';
import { loadWorkbook } from '../imports/workbook-readers';
import { fillDailySalesTemplate, templatePath } from './daily-sales-template';

/** exceljs renderers. Totals use formulas (not values) as the source workbooks do. */
@Injectable()
export class XlsxService {
  /** Generic list export: columns + rows → buffer. */
  async table(sheetName: string, columns: { header: string; key: string; width?: number; numFmt?: string }[], rows: Record<string, unknown>[], opts: { title?: string; totals?: string[] } = {}): Promise<Buffer> {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(sheetName.slice(0, 31));
    let r = 1;
    if (opts.title) { ws.getCell(r, 1).value = opts.title; ws.getCell(r, 1).font = { bold: true, size: 14 }; r += 2; }
    ws.getRow(r).values = columns.map((c) => c.header); ws.getRow(r).font = { bold: true };
    columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width ?? 18; if (c.numFmt) ws.getColumn(i + 1).numFmt = c.numFmt; });
    const first = r + 1;
    for (const row of rows) { r++; ws.getRow(r).values = columns.map((c) => norm(row[c.key])); }
    if (opts.totals?.length && rows.length) { r++; ws.getCell(r, 1).value = 'TOTAL'; ws.getRow(r).font = { bold: true }; for (const k of opts.totals) { const i = columns.findIndex((c) => c.key === k) + 1; if (i > 0) { const col = ws.getColumn(i).letter; ws.getCell(r, i).value = { formula: `SUM(${col}${first}:${col}${r - 1})` }; } } }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** §8.5 Daily Branch Sales Report. Uses the owner's sample workbook as the template when present (exact layout); otherwise the generated layout below. */
  async dailySalesReport(rep: DailySalesReport): Promise<Buffer> {
    const tpl = templatePath();
    if (tpl) return fillDailySalesTemplate(rep, tpl);
    return this.dailySalesReportGenerated(rep);
  }
  async dailySalesReportGenerated(rep: DailySalesReport): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const f = wb.addWorksheet('FRONT'); f.getColumn(1).width = 34; f.getColumn(2).width = 16; f.getColumn(4).width = 30; f.getColumn(5).width = 16; f.getColumn(6).width = 14; f.getColumn(7).width = 14;
    const money = '#,##0.00;(#,##0.00);-';
    let r = 1;
    const put = (row: number, col: number, v: unknown, bold = false) => { const c = f.getCell(row, col); c.value = v as ExcelJS.CellValue; if (bold) c.font = { bold: true }; if (typeof v === 'number') c.numFmt = money; return c; };
    put(r, 1, 'DAILY BRANCH SALES REPORT', true); r++;
    put(r, 1, 'Branch:'); put(r, 2, rep.header.branch); put(r, 4, 'Date:'); put(r, 5, rep.header.date); r++;
    put(r, 1, 'System date:'); put(r, 2, rep.header.systemDate.slice(0, 19).replace('T', ' ')); r += 2;
    // Sales breakdown (Cash)
    put(r, 1, 'SALES BREAKDOWN (CASH)', true); r++;
    const cashStart = r;
    for (const [label, v] of [['Walk-in', rep.cash.walkIn], ['Delivery', rep.cash.delivery], ['Franchise', rep.cash.franchise], ['Prothin Dealer', rep.cash.dealer], ['Agent (Cash)', rep.cash.agent], ['Delivery Fee', rep.cash.deliveryFee]] as const) { put(r, 1, label); put(r, 2, asNum(v)); r++; }
    put(r, 1, 'Subtotal', true); f.getCell(r, 2).value = { formula: `SUM(B${cashStart}:B${r - 1})` }; f.getCell(r, 2).numFmt = money; const cashSubRow = r; r += 2;
    put(r, 1, 'CREDIT CARD', true); r++; const ccStart = r;
    for (const [label, v] of [['Walk-in (CC)', rep.creditCard.walkIn], ['Delivery (CC)', rep.creditCard.delivery], ['Agent (CC)', rep.creditCard.agent], ['Other (CC)', rep.creditCard.other]] as const) { put(r, 1, label); put(r, 2, asNum(v)); r++; }
    put(r, 1, 'Total Credit Card', true); f.getCell(r, 2).value = { formula: `SUM(B${ccStart}:B${r - 1})` }; f.getCell(r, 2).numFmt = money; r += 2;
    put(r, 1, 'WALK-IN (ONLINE)', true); r++; const olStart = r;
    for (const [label, v] of [['Walk-in (Online)', rep.onlineWalkIn.walkIn], ['Franchise (Online)', rep.onlineWalkIn.franchise], ['Prothin Dealer (Online)', rep.onlineWalkIn.dealer], ['Agent (Online)', rep.onlineWalkIn.agent], ['Delivery (Online)', rep.onlineDelivery.delivery], ['Delivery Fee (Online)', rep.onlineDelivery.deliveryFee]] as const) { put(r, 1, label); put(r, 2, asNum(v)); r++; }
    put(r, 1, 'SHIPPING', true); r++;
    for (const [label, v] of [['Shipping (LBC/Lalamove)', rep.shipping.courier], ['Shipping – Franchise', rep.shipping.franchise], ['Shipping – Dealer', rep.shipping.dealer], ['Shipping – Agent', rep.shipping.agent], ['Shipping (Shopee/Lazada)', rep.shipping.marketplace], ['Shipping Fee', rep.shipping.shippingFee]] as const) { put(r, 1, label); put(r, 2, asNum(v)); r++; }
    put(r, 1, 'Total Online / CC / Shipping', true); f.getCell(r, 2).value = { formula: `SUM(B${olStart}:B${r - 1})+B${ccStart + 4}` }; f.getCell(r, 2).numFmt = money; const olTotRow = r; r += 2;
    put(r, 1, 'AR / PDC (credit)', true); put(r, 2, asNum(rep.ar)); r += 2;
    put(r, 1, 'TOTALS BY CHANNEL (cash + CC + online)', true); put(r, 2, 'Amount', true); put(r, 3, '# Products', true); r++;
    for (const c of rep.channelTotals) { put(r, 1, c.channel.replace(/_/g, ' ')); put(r, 2, asNum(c.amount)); put(r, 3, c.products); r++; }
    put(r, 1, 'Apparels'); put(r, 3, rep.productCounts.apparel); r++; put(r, 1, 'Equipment'); put(r, 3, rep.productCounts.equipment); r++; put(r, 1, 'Agent'); put(r, 3, rep.productCounts.agent); r += 2;
    put(r, 1, 'DELIVERY / SHIPPING FEE', true); r++; put(r, 1, 'Delivery Fee'); put(r, 2, asNum(rep.feesBox.deliveryFee)); r++; put(r, 1, 'Shipping Fee'); put(r, 2, asNum(rep.feesBox.shippingFee)); r += 2;
    // Right column: rider summary, money breakdown, expenses
    let rr = 5;
    put(rr, 4, 'RIDER DELIVERY SUMMARY', true); rr++; ['Rider', 'Product Amt', 'Del Fee', 'Subtotal', 'Incentives', 'Total', 'Remarks'].forEach((h, i) => put(rr, 4 + i, h, true)); rr++;
    for (const x of rep.riders) { put(rr, 4, x.rider); put(rr, 5, asNum(x.productAmount)); put(rr, 6, asNum(x.deliveryFee)); put(rr, 7, asNum(x.subtotal)); put(rr, 8, asNum(x.incentives)); put(rr, 9, asNum(x.total)); put(rr, 10, x.remarks); rr++; }
    rr++; put(rr, 4, 'MONEY BREAKDOWN', true); rr++;
    const mbStart = rr;
    for (const d of [1000, 500, 200, 100, 50, 20, 10, 5, 1]) { put(rr, 4, d); put(rr, 5, rep.moneyBreakdown?.[String(d)] ?? 0); f.getCell(rr, 6).value = { formula: `D${rr}*E${rr}` }; f.getCell(rr, 6).numFmt = money; rr++; }
    put(rr, 4, 'Total counted', true); f.getCell(rr, 6).value = { formula: `SUM(F${mbStart}:F${rr - 1})` }; f.getCell(rr, 6).numFmt = money; rr++;
    if (rep.cashCount) { put(rr, 4, 'Expected cash'); put(rr, 6, asNum(rep.cashCount.expected)); rr++; put(rr, 4, 'Variance'); put(rr, 6, asNum(rep.cashCount.variance)); rr++; }
    rr++; put(rr, 4, 'EXPENSES', true); put(rr, 5, 'Major', true); put(rr, 6, 'Other', true); rr++; const exStart = rr;
    for (const e of rep.expenses) { put(rr, 4, `${e.accountTitle}${e.payee ? ` – ${e.payee}` : ''}`); put(rr, e.group === 'MAJOR' ? 5 : 6, asNum(e.amount)); rr++; }
    put(rr, 4, 'Total expenses', true); f.getCell(rr, 5).value = { formula: `SUM(E${exStart}:E${rr - 1})` }; f.getCell(rr, 6).value = { formula: `SUM(F${exStart}:F${rr - 1})` }; f.getCell(rr, 5).numFmt = money; f.getCell(rr, 6).numFmt = money; const exTotRow = rr; rr++;
    put(rr, 4, 'Rider/Driver expense'); put(rr, 5, asNum(rep.expenseTotals.riderExpense)); rr++;
    put(rr, 4, 'Shipping expense – Orders'); put(rr, 5, asNum(rep.expenseTotals.shippingExpense.orders)); rr++; put(rr, 4, 'Shipping expense – Marketing'); put(rr, 5, asNum(rep.expenseTotals.shippingExpense.marketing)); rr += 2;
    put(rr, 4, 'FREEBIES', true); rr++; for (const fb of rep.freebies) { put(rr, 4, fb.item); put(rr, 5, fb.qty); rr++; } rr++;
    put(rr, 4, 'SUMMARY FOR BANK DEPOSIT', true); rr++;
    put(rr, 4, 'Cash'); f.getCell(rr, 5).value = { formula: `B${cashSubRow}` }; f.getCell(rr, 5).numFmt = money; rr++;
    put(rr, 4, 'Less: Cash expenses'); put(rr, 5, asNum(rep.bankDeposit.expenses)); rr++;
    put(rr, 4, 'Total cash deposit', true); f.getCell(rr, 5).value = { formula: `E${rr - 2}-E${rr - 1}` }; f.getCell(rr, 5).numFmt = money; rr += 2;
    put(rr, 4, 'Overall sales', true); f.getCell(rr, 5).value = { formula: `B${cashSubRow}+B${olTotRow}+${asNum(rep.ar)}` }; f.getCell(rr, 5).numFmt = money; rr++;
    put(rr, 4, 'Total products'); put(rr, 5, rep.totalProducts); rr += 2;
    put(rr, 4, 'Prepared by:'); put(rr, 5, rep.header.preparedBy); put(rr, 6, rep.header.date);
    void exTotRow;
    const lineSheet = (name: string, rows: { drSiNo: string; items: string; qty: number; amount: unknown; fee: unknown; total: unknown; remarks: string }[]) => {
      const ws = wb.addWorksheet(name); ws.columns = [{ header: 'DR#/SI#', key: 'drSiNo', width: 14 }, { header: 'Items', key: 'items', width: 50 }, { header: 'Qty', key: 'qty', width: 8 }, { header: 'Amount', key: 'amount', width: 14 }, { header: name === 'SHIPPING' ? 'SF' : 'Del Fee', key: 'fee', width: 12 }, { header: 'Total', key: 'total', width: 14 }, { header: 'Remarks / Transaction type', key: 'remarks', width: 30 }];
      ws.getRow(1).font = { bold: true }; for (const x of rows) ws.addRow({ ...x, amount: asNum(x.amount as never), fee: asNum(x.fee as never), total: asNum(x.total as never) });
      const n = rows.length + 1; if (rows.length) { const t = ws.addRow({ drSiNo: 'TOTAL' }); t.font = { bold: true }; for (const col of ['C', 'D', 'E', 'F']) ws.getCell(`${col}${n + 1}`).value = { formula: `SUM(${col}2:${col}${n})` }; }
      ['D', 'E', 'F'].forEach((c) => (ws.getColumn(c).numFmt = money));
    };
    lineSheet('WALK IN', rep.sheets.walkIn); lineSheet('DELIVERY', rep.sheets.delivery); lineSheet('SHIPPING', rep.sheets.shipping);
    const cc = wb.addWorksheet('CREDIT CARD'); cc.columns = [{ header: 'DR#/SI#', key: 'drSiNo', width: 14 }, { header: 'Customer', key: 'customer', width: 24 }, { header: 'Items', key: 'items', width: 40 }, { header: 'Amount', key: 'amount', width: 14 }, { header: 'MID', key: 'mid', width: 14 }, { header: 'Slip #', key: 'slip', width: 12 }, { header: 'Approval', key: 'approval', width: 12 }, { header: 'Batch', key: 'batch', width: 12 }]; cc.getRow(1).font = { bold: true };
    for (const x of rep.sheets.creditCard) cc.addRow({ ...x, amount: asNum(x.amount as never) });
    const rt = wb.addWorksheet('RECEIPT TRACKER'); rt.columns = [{ header: 'DR#/SI#', key: 'drSiNo', width: 14 }, { header: 'Customer', key: 'customer', width: 24 }, { header: 'Channel', key: 'channel', width: 20 }, { header: 'Payment', key: 'paymentMode', width: 14 }, { header: 'Amount', key: 'amount', width: 14 }]; rt.getRow(1).font = { bold: true };
    for (const x of rep.sheets.receiptTracker) rt.addRow({ ...x, amount: asNum(x.amount as never) });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** Monthly matrix (Beg, Jan..Dec, Total) used by TB / IS / schedules, with SUM formulas for totals. */
  async matrix(title: string, rows: { code?: string; title: string; beg?: unknown; months: unknown[]; section?: string }[], opts: { withBeg?: boolean; sections?: boolean } = {}): Promise<Buffer> {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(title.slice(0, 31));
    const heads = ['Code', 'Account Title', ...(opts.withBeg ? ['Beg. Bal'] : []), 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Total'];
    ws.getCell(1, 1).value = title; ws.getCell(1, 1).font = { bold: true, size: 14 };
    ws.getRow(3).values = heads; ws.getRow(3).font = { bold: true }; ws.getColumn(2).width = 44; for (let i = 3; i <= heads.length; i++) { ws.getColumn(i).width = 13; ws.getColumn(i).numFmt = '#,##0.00;(#,##0.00);-'; }
    let r = 4; let section: string | undefined; let secStart = r;
    const firstMonthCol = opts.withBeg ? 4 : 3; const lastMonthCol = firstMonthCol + 11; const totalCol = lastMonthCol + 1;
    const L = (c: number) => ws.getColumn(c).letter;
    for (const row of rows) {
      if (opts.sections && row.section !== section) { if (section !== undefined) { ws.getCell(r, 2).value = `Total ${section}`; ws.getRow(r).font = { bold: true }; for (let c = firstMonthCol - (opts.withBeg ? 1 : 0); c <= totalCol; c++) ws.getCell(r, c).value = { formula: `SUM(${L(c)}${secStart}:${L(c)}${r - 1})` }; r += 2; } section = row.section; ws.getCell(r, 1).value = section; ws.getRow(r).font = { bold: true }; r++; secStart = r; }
      ws.getCell(r, 1).value = row.code ?? ''; ws.getCell(r, 2).value = row.title;
      if (opts.withBeg) ws.getCell(r, 3).value = asNum(row.beg as never);
      row.months.forEach((m, i) => (ws.getCell(r, firstMonthCol + i).value = asNum(m as never)));
      ws.getCell(r, totalCol).value = { formula: `SUM(${L(firstMonthCol)}${r}:${L(lastMonthCol)}${r})` };
      r++;
    }
    if (opts.sections && section !== undefined) { ws.getCell(r, 2).value = `Total ${section}`; ws.getRow(r).font = { bold: true }; for (let c = firstMonthCol - (opts.withBeg ? 1 : 0); c <= totalCol; c++) ws.getCell(r, c).value = { formula: `SUM(${L(c)}${secStart}:${L(c)}${r - 1})` }; }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** Read first sheet into row objects keyed by header. */
  async read(buf: Buffer, sheetName?: string): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
    const wb = await loadWorkbook(buf);
    const ws = sheetName ? wb.getWorksheet(sheetName) : wb.worksheets[0];
    if (!ws) throw new Error(`Sheet ${sheetName ?? '(first)'} not found`);
    const headers = (ws.getRow(1).values as unknown[]).slice(1).map((h) => String(h ?? '').trim());
    const rows: Record<string, unknown>[] = [];
    ws.eachRow((row, i) => { if (i === 1) return; const vals = row.values as unknown[]; const o: Record<string, unknown> = {}; headers.forEach((h, j) => { let v = vals[j + 1]; if (v && typeof v === 'object' && 'result' in (v as object)) v = (v as { result: unknown }).result; if (v && typeof v === 'object' && 'richText' in (v as object)) v = (v as { richText: { text: string }[] }).richText.map((t) => t.text).join(''); o[h] = v; }); if (Object.values(o).some((v) => v !== undefined && v !== null && v !== '')) rows.push(o); });
    return { headers, rows };
  }
  /** Raw cell grid (for the workbook-specific product / COA importers). */
  async grid(buf: Buffer, sheetName: string): Promise<unknown[][]> {
    const wb = await loadWorkbook(buf);
    const ws = wb.getWorksheet(sheetName) ?? wb.worksheets.find((w) => w.name.toLowerCase().includes(sheetName.toLowerCase()));
    if (!ws) throw new Error(`Sheet ${sheetName} not found; available: ${wb.worksheets.map((w) => w.name).join(', ')}`);
    const out: unknown[][] = [];
    ws.eachRow({ includeEmpty: false }, (row, i) => { out[i] = (row.values as unknown[]).map((v) => (v && typeof v === 'object' && 'result' in (v as object) ? (v as { result: unknown }).result : v && typeof v === 'object' && 'richText' in (v as object) ? (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('') : v)); });
    return out;
  }
  async template(columns: string[], sample?: unknown[][]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Template'); ws.addRow(columns); ws.getRow(1).font = { bold: true }; columns.forEach((_, i) => (ws.getColumn(i + 1).width = 20)); for (const s of sample ?? []) ws.addRow(s);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
function norm(v: unknown): ExcelJS.CellValue { if (v == null) return ''; if (typeof v === 'object' && 'toNumber' in (v as object)) return (v as { toNumber(): number }).toNumber(); if (v instanceof Date) return v; if (typeof v === 'object') return JSON.stringify(v); return v as ExcelJS.CellValue; }
