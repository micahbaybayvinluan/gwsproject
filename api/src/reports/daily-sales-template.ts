/**
 * §8.5 Daily Branch Sales Report rendered INTO the owner's own workbook (`templates/daily-sales-report.xlsx`, a copy of
 * `SAles Report Sample.xlsx`). We only write the line-level sheets and the FRONT header/side boxes; every FRONT total is the
 * workbook's own formula, so the export matches the sample cell for cell by construction.
 *
 * Block capacities are those of the sample. When a block overflows, the last row aggregates the remainder
 * ("+N more lines, see RECEIPT TRACKER") so the FRONT totals stay exact.
 */
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DailySalesReport, RSale } from './daily-sales-report';
import { asNum } from './daily-sales-report';

type Col = string;
interface Block { sheet: string; first: number; last: number; dr: Col; item: Col; qty: Col; amount: Col; fee?: Col; total?: Col; remarks?: Col; shipExp?: Col; customer?: Col; mid?: Col; slip?: Col; approval?: Col; batch?: Col; dateCell?: string; branchCell?: string; nameCell?: string }
interface LineRow { dr: string; item: string; qty: number; amount: number; fee: number; total: number; remarks: string; shipExp: number; customer: string; mid: string; slip: string; approval: string; batch: string }

const WI = (first: number, last: number, online: boolean, dateRow: number): Block => online
  ? { sheet: 'WALK IN', first, last, dr: 'G', item: 'H', qty: 'I', amount: 'J', remarks: 'K', dateCell: `H${dateRow}`, branchCell: `H${dateRow + 1}` }
  : { sheet: 'WALK IN', first, last, dr: 'A', item: 'B', qty: 'C', amount: 'D', remarks: 'E', dateCell: `B${dateRow}`, branchCell: `B${dateRow + 1}` };
const DL = (first: number, last: number, online: boolean, hdrRow: number, hasName: boolean): Block => online
  ? { sheet: 'DELIVERY', first, last, dr: 'I', item: 'J', qty: 'K', amount: 'L', fee: 'M', total: 'N', remarks: 'O', dateCell: `O${hdrRow}`, branchCell: `J${hdrRow + 1}`, nameCell: hasName ? `J${hdrRow}` : undefined }
  : { sheet: 'DELIVERY', first, last, dr: 'A', item: 'B', qty: 'C', amount: 'D', fee: 'E', total: 'F', remarks: 'G', dateCell: `G${hdrRow}`, branchCell: `B${hdrRow + 1}`, nameCell: hasName ? `B${hdrRow}` : undefined };
const SH_L = (first: number, last: number, hdrRow: number): Block => ({ sheet: 'SHIPPING', first, last, dr: 'A', item: 'B', qty: 'C', amount: 'D', fee: 'E', total: 'F', shipExp: 'G', dateCell: `B${hdrRow}`, branchCell: `B${hdrRow + 1}` });
const SH_R = (first: number, last: number, hdrRow: number, marketplace: boolean): Block => ({ sheet: 'SHIPPING', first, last, dr: 'I', item: 'J', qty: 'K', amount: 'L', fee: 'M', total: marketplace ? undefined : 'N', shipExp: marketplace ? 'N' : 'O', dateCell: `J${hdrRow}`, branchCell: `J${hdrRow + 1}` });
const CC = (first: number, last: number): Block => ({ sheet: 'CREDIT CARD', first, last, dr: 'A', customer: 'B', item: 'C', qty: 'D', amount: 'E', fee: 'F', mid: 'H', slip: 'I', approval: 'J', batch: 'K' });

export const BLOCKS = {
  walkinCash: WI(6, 29, false, 3), walkinOnline: WI(6, 29, true, 3),
  franchiseCash: WI(38, 54, false, 35), franchiseOnline: WI(38, 54, true, 35),
  dealerCash: WI(63, 82, false, 60), dealerOnline: WI(63, 82, true, 60),
  agentCash: WI(91, 110, false, 88), agentOnline: WI(91, 110, true, 88),
  rider1Cash: DL(6, 28, false, 3, true), rider1Online: DL(6, 28, true, 3, true),
  rider2Cash: DL(36, 58, false, 33, true), rider2Online: DL(36, 58, true, 33, true),
  delFranchiseCash: DL(69, 92, false, 66, false), delFranchiseOnline: DL(69, 92, true, 66, false),
  delDealerCash: DL(101, 125, false, 98, false), delDealerOnline: DL(101, 125, true, 98, false),
  delAgentCash: DL(134, 158, false, 131, false), delAgentOnline: DL(134, 158, true, 131, false),
  shipCourier: SH_L(6, 18, 3), shipMarketplace: SH_R(6, 18, 3, true),
  shipFranchise: SH_L(26, 45, 23), shipDealer: SH_R(26, 45, 23, false), shipAgent: SH_L(54, 73, 51),
  ccWalkin: CC(3, 20), ccAgent: CC(28, 48), ccRider1: CC(53, 73), ccRider2: CC(78, 98), ccRider3: CC(103, 123),
  tracker: { sheet: 'RECEIPT TRACKER', first: 6, last: 52, dr: 'A', item: 'B', qty: 'C', amount: 'D', fee: 'E', total: 'F', remarks: 'G', dateCell: 'G4', branchCell: 'B4' } as Block,
} as const;
type BlockKey = keyof typeof BLOCKS;

export function templatePath(): string | null {
  const candidates = [path.resolve(process.cwd(), 'templates/daily-sales-report.xlsx'), path.resolve(__dirname, '../../templates/daily-sales-report.xlsx'), path.resolve(__dirname, '../../../templates/daily-sales-report.xlsx'), path.resolve(process.cwd(), 'api/templates/daily-sales-report.xlsx')];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/** Decide which sheet/block a sale belongs to (null = receipt tracker only, e.g. AR/PDC). */
export function classifySale(s: RSale, riderIndex: Map<string, number>): BlockKey | null {
  if (s.channelSub === 'CONSIGNMENT') return null;
  const kind = s.channel === 'FRANCHISE' ? 'franchise' : s.channel === 'DEALER' ? 'dealer' : s.channel === 'AGENT' ? 'agent' : 'walkin';
  const rider = s.riderName ? riderIndex.get(s.riderName) ?? 1 : 0;
  const isDelivery = s.channel === 'DELIVERY' || rider > 0;
  if (s.paymentMode === 'AR_PDC') return null;
  if (s.paymentMode === 'CREDIT_CARD') return kind === 'agent' ? 'ccAgent' : isDelivery ? (rider >= 3 ? 'ccRider3' : rider === 2 ? 'ccRider2' : 'ccRider1') : 'ccWalkin';
  const online = s.paymentMode === 'ONLINE';
  if (s.channel === 'SHIPPING_MARKETPLACE') return 'shipMarketplace';
  if (s.channel === 'SHIPPING_COURIER') return s.channelSub === 'FRANCHISE' ? 'shipFranchise' : s.channelSub === 'DEALER' ? 'shipDealer' : s.channelSub === 'AGENT' ? 'shipAgent' : 'shipCourier';
  if (isDelivery) {
    if (kind === 'franchise') return online ? 'delFranchiseOnline' : 'delFranchiseCash';
    if (kind === 'dealer') return online ? 'delDealerOnline' : 'delDealerCash';
    if (kind === 'agent') return online ? 'delAgentOnline' : 'delAgentCash';
    return rider >= 2 ? (online ? 'rider2Online' : 'rider2Cash') : online ? 'rider1Online' : 'rider1Cash';
  }
  if (kind === 'franchise') return online ? 'franchiseOnline' : 'franchiseCash';
  if (kind === 'dealer') return online ? 'dealerOnline' : 'dealerCash';
  if (kind === 'agent') return online ? 'agentOnline' : 'agentCash';
  return online ? 'walkinOnline' : 'walkinCash';
}

function rowsFor(s: RSale, opts: { riderRemark?: string } = {}): LineRow[] {
  const fee = asNum(s.deliveryFee) + asNum(s.shippingFee);
  return s.lines.map((l, i) => ({ dr: i === 0 ? s.drSiNo : '', item: l.productName, qty: l.qty, amount: asNum(l.amount), fee: i === 0 ? fee : 0, total: asNum(l.amount), remarks: [i === 0 ? opts.riderRemark : '', l.isFreebie ? 'FREEBIE' : '', i === 0 ? s.notes ?? '' : ''].filter(Boolean).join(' / '), shipExp: i === 0 ? asNum(s.shippingExpense) + asNum(s.marketplaceCharges) : 0, customer: i === 0 ? (s.customerName ?? s.agentName ?? '') : '', mid: i === 0 ? s.cardMid ?? '' : '', slip: i === 0 ? s.cardSlipNo ?? '' : '', approval: i === 0 ? s.cardApprovalCode ?? '' : '', batch: i === 0 ? s.cardBatchNo ?? '' : '' }));
}
function compact(rows: LineRow[], capacity: number): LineRow[] {
  if (rows.length <= capacity) return rows;
  const head = rows.slice(0, capacity - 1); const rest = rows.slice(capacity - 1);
  const agg: LineRow = { dr: '', item: `+${rest.length} more lines (see RECEIPT TRACKER)`, qty: rest.reduce((n, r) => n + r.qty, 0), amount: rest.reduce((n, r) => n + r.amount, 0), fee: rest.reduce((n, r) => n + r.fee, 0), total: rest.reduce((n, r) => n + r.total, 0), remarks: '', shipExp: rest.reduce((n, r) => n + r.shipExp, 0), customer: '', mid: '', slip: '', approval: '', batch: '' };
  return [...head, agg];
}
function writeBlock(wb: ExcelJS.Workbook, b: Block, rows: LineRow[], header: { date: Date; branch: string; name?: string }) {
  const ws = wb.getWorksheet(b.sheet) ?? wb.worksheets.find((w) => w.name.trim() === b.sheet)!;
  const cols = [b.dr, b.item, b.qty, b.amount, b.fee, b.total, b.remarks, b.shipExp, b.customer, b.mid, b.slip, b.approval, b.batch].filter(Boolean) as string[];
  for (let r = b.first; r <= b.last; r++) for (const c of cols) { const cell = ws.getCell(`${c}${r}`); if (!(cell.value && typeof cell.value === 'object' && 'formula' in (cell.value as object))) cell.value = null; }
  if (b.dateCell) ws.getCell(b.dateCell).value = header.date;
  if (b.branchCell) ws.getCell(b.branchCell).value = header.branch;
  if (b.nameCell) ws.getCell(b.nameCell).value = header.name ?? null;
  const data = compact(rows, b.last - b.first + 1);
  data.forEach((row, i) => {
    const r = b.first + i; const set = (c: Col | undefined, v: unknown) => { if (c && v !== '' && v !== undefined && v !== null) ws.getCell(`${c}${r}`).value = v as ExcelJS.CellValue; };
    set(b.dr, row.dr); set(b.item, row.item); set(b.qty, row.qty); set(b.amount, row.amount); set(b.fee, row.fee || null); set(b.total, row.total); set(b.remarks, row.remarks); set(b.shipExp, row.shipExp || null);
    set(b.customer, row.customer); set(b.mid, row.mid); set(b.slip, row.slip); set(b.approval, row.approval); set(b.batch, row.batch);
  });
}
const clear = (ws: ExcelJS.Worksheet, addrs: string[]) => addrs.forEach((a) => (ws.getCell(a).value = null));
const range = (col: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${col}${from + i}`);

/**
 * ExcelJS drops the workbook's own colour palette when it saves, so cells that use palette slots fall back to Excel's default red, brown and dark grey.
 * The template's palette (pale yellow, gold, soft orange, light grey: owner request 2026-09-30) is put back into the finished file.
 */
export async function restorePalette(templateFile: string, out: Buffer): Promise<Buffer> {
  const src = await JSZip.loadAsync(fs.readFileSync(templateFile)); const colors = /<colors>[\s\S]*?<\/colors>/.exec((await src.file('xl/styles.xml')?.async('string')) ?? '')?.[0];
  if (!colors) return out;
  const dst = await JSZip.loadAsync(out); const f = dst.file('xl/styles.xml'); if (!f) return out;
  let xml = (await f.async('string')).replace(/<colors>[\s\S]*?<\/colors>/, '');
  xml = xml.includes('<extLst') ? xml.replace('<extLst', `${colors}<extLst`) : xml.replace('</styleSheet>', `${colors}</styleSheet>`);
  dst.file('xl/styles.xml', xml);
  return Buffer.from(await dst.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

export async function fillDailySalesTemplate(rep: DailySalesReport, file: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  const date = new Date(`${rep.header.date}T00:00:00`); const branch = rep.header.branch;
  const hdr = { date, branch };
  const riders = [...new Set(rep.sales.filter((s) => s.riderName).map((s) => s.riderName!))];
  const riderIndex = new Map(riders.map((r, i) => [r, i + 1]));
  const byBlock = new Map<BlockKey, LineRow[]>();
  const tracker: LineRow[] = [];
  for (const s of rep.sales) {
    if (s.channelSub === 'CONSIGNMENT') continue;
    const key = classifySale(s, riderIndex);
    const riderRemark = s.riderName && (riderIndex.get(s.riderName) ?? 1) > 2 ? s.riderName : undefined;
    if (key) byBlock.set(key, [...(byBlock.get(key) ?? []), ...rowsFor(s, { riderRemark })]);
    const type = `${s.paymentMode === 'AR_PDC' ? 'AR / PDC' : s.paymentMode === 'CREDIT_CARD' ? 'CREDIT CARD' : s.paymentMode}${s.channel === 'AGENT' ? ' AGENT' : ''}`;
    tracker.push(...rowsFor(s).map((r, i) => ({ ...r, remarks: i === 0 ? type : '' })));
  }
  for (const key of Object.keys(BLOCKS) as BlockKey[]) {
    if (key === 'tracker') continue;
    const b = BLOCKS[key];
    const name = key.startsWith('rider1') || key === 'ccRider1' ? riders[0] : key.startsWith('rider2') || key === 'ccRider2' ? riders[1] : key === 'ccRider3' ? riders[2] : undefined;
    writeBlock(wb, b, byBlock.get(key) ?? [], { ...hdr, name });
  }
  writeBlock(wb, BLOCKS.tracker, tracker, hdr);

  // FRONT: header, rider summary, money breakdown, expenses, freebies, counts, signature
  const f = wb.getWorksheet('FRONT') ?? wb.worksheets.find((w) => w.name.trim() === 'FRONT')!;
  f.getCell('B1').value = branch; f.getCell('B2').value = date; f.getCell('F2').value = new Date();
  clear(f, [...range('H', 3, 8), ...range('L', 3, 8), 'I5', 'J5', 'I6', 'J6', ...range('I', 7, 8), ...range('J', 7, 8), ...range('K', 7, 8), ...range('M', 7, 8)]);
  rep.riders.forEach((r, i) => {
    const row = 3 + i; if (row > 8) return;
    f.getCell(`H${row}`).value = r.rider; f.getCell(`L${row}`).value = asNum(r.incentives) || null;
    if (i >= 2) { f.getCell(`I${row}`).value = asNum(r.productAmount); f.getCell(`J${row}`).value = asNum(r.deliveryFee); if (row >= 7) { f.getCell(`K${row}`).value = { formula: `I${row}+J${row}` }; f.getCell(`M${row}`).value = { formula: `K${row}-L${row}` }; } }
  });
  clear(f, [...range('J', 12, 20), ...range('K', 12, 20)]);
  [1000, 500, 200, 100, 50, 20, 10, 5, 1].forEach((d, i) => { const row = 12 + i; const q = rep.moneyBreakdown?.[String(d)] ?? 0; f.getCell(`J${row}`).value = q || null; f.getCell(`K${row}`).value = { formula: `H${row}*J${row}` }; });
  // expenses: rider/driver → H31:J40, shipping → H46:K55, others major → L13:N23, other → L29:N36
  // rider incentives paid from a sale are already in the rider summary (L3:L8 → D44); they are not repeated in the expense boxes
  const boxExp = rep.expenses.filter((e) => !e.inRiderSummary);
  const riderExp = boxExp.filter((e) => /rider|driver/i.test(e.accountTitle));
  const shipExp = boxExp.filter((e) => /shipping expense/i.test(e.accountTitle));
  const rest = boxExp.filter((e) => !riderExp.includes(e) && !shipExp.includes(e));
  const major = rest.filter((e) => e.group === 'MAJOR'); const other = rest.filter((e) => e.group === 'OTHER');
  clear(f, [...range('L', 13, 23), ...range('M', 13, 23), ...range('N', 13, 23), ...range('L', 29, 36), ...range('M', 29, 36), ...range('N', 29, 36), ...range('H', 31, 40), ...range('I', 31, 40), ...range('J', 31, 40), ...range('H', 46, 55), ...range('I', 46, 55), ...range('J', 46, 55), ...range('K', 46, 55)]);
  const putExp = (rows: typeof rep.expenses, first: number, last: number, nameCol: string, partCol: string | null, amtCol: string) => compactExp(rows, last - first + 1).forEach((e, i) => { f.getCell(`${nameCol}${first + i}`).value = e.accountTitle; if (partCol) f.getCell(`${partCol}${first + i}`).value = e.payee ?? null; f.getCell(`${amtCol}${first + i}`).value = asNum(e.amount); });
  putExp(major, 13, 23, 'L', null, 'N'); putExp(other, 29, 36, 'L', null, 'N'); putExp(riderExp, 31, 40, 'H', 'I', 'J');
  compactExp(shipExp, 10).forEach((e, i) => { const row = 46 + i; f.getCell(`H${row}`).value = e.accountTitle; f.getCell(`I${row}`).value = e.payee ?? null; f.getCell(/marketing/i.test(e.accountTitle) ? `K${row}` : `J${row}`).value = asNum(e.amount); });
  const shippingFromSales = rep.sales.reduce((n, s) => n + asNum(s.shippingExpense), 0);
  if (shippingFromSales) { const row = 46 + Math.min(compactExp(shipExp, 10).length, 9); f.getCell(`H${row}`).value = 'Shipping expense on orders (from sales)'; f.getCell(`J${row}`).value = shippingFromSales; }
  clear(f, [...range('F', 44, 50), ...range('G', 44, 50)]);
  rep.freebies.slice(0, 7).forEach((fb, i) => { f.getCell(`F${44 + i}`).value = fb.item; f.getCell(`G${44 + i}`).value = fb.qty; });
  f.getCell('F10').value = rep.productCounts.apparel; f.getCell('F11').value = rep.productCounts.equipment;
  f.getCell('E63').value = rep.header.preparedBy; f.getCell('F63').value = date;
  fixFrontFormulas(f, rep);
  // where the online and card money went, per bank / GCash / card / platform account
  const pa = wb.addWorksheet('PAYMENT ACCOUNTS');
  pa.columns = [{ header: 'Account', key: 'account', width: 36 }, { header: 'Type', key: 'mode', width: 14 }, { header: 'Sales', key: 'count', width: 8 }, { header: 'Amount', key: 'amount', width: 14, style: { numFmt: '#,##0.00' } }];
  pa.getRow(1).font = { bold: true };
  for (const a of rep.byPaymentAccount) pa.addRow({ account: a.account, mode: a.mode, count: a.count, amount: asNum(a.amount) });
  if (rep.byPaymentAccount.length) { const last = pa.rowCount; pa.addRow({ account: 'TOTAL', count: { formula: `SUM(C2:C${last})` }, amount: { formula: `SUM(D2:D${last})` } }).font = { bold: true }; }
  // replacement payments: the price difference of replacements paid by / refunded to customers on this day, apart from sales
  const rpw = wb.addWorksheet('REPLACEMENT PAYMENTS');
  rpw.columns = [{ header: 'Ticket', key: 'ticket', width: 14 }, { header: 'DR/SI', key: 'dr', width: 12 }, { header: 'Customer', key: 'customer', width: 26 }, { header: 'Item given', key: 'item', width: 30 }, { header: 'How', key: 'how', width: 22 }, { header: 'Account', key: 'account', width: 28 }, { header: 'Amount (− = refunded)', key: 'amount', width: 20, style: { numFmt: '#,##0.00' } }];
  rpw.getRow(1).font = { bold: true };
  for (const x of rep.replacements.rows) rpw.addRow({ ticket: x.ticketNo, dr: x.drSiNo ?? '', customer: x.customer ?? '', item: x.item ?? '', how: `${x.direction === 'IN' ? 'paid' : 'refunded'} · ${x.mode.toLowerCase().replace('_', ' ')}`, account: x.account ?? '', amount: asNum(x.signed) });
  rpw.addRow({}); const rl = rpw.rowCount;
  for (const [label, v] of [['Replacement cash (joins the cash deposit)', rep.replacements.cash], ['Replacement online', rep.replacements.online], ['Replacement card', rep.replacements.card], ['Total replacement payments', rep.replacements.total]] as const) rpw.addRow({ item: label, amount: asNum(v) }).font = { bold: true };
  void rl;
  rpw.addRow({ item: 'Total cash deposit incl. replacement cash', amount: asNum(rep.totalCashDeposit) }).font = { bold: true };
  return restorePalette(file, Buffer.from(await wb.xlsx.writeBuffer()));
}
function compactExp<T extends { accountTitle: string; payee: string | null; amount: unknown }>(rows: T[], cap: number): T[] {
  if (rows.length <= cap) return rows;
  const head = rows.slice(0, cap - 1); const rest = rows.slice(cap - 1);
  return [...head, { ...rest[0], accountTitle: `+${rest.length} more expenses`, payee: null, amount: rest.reduce((n, r) => n + asNum(r.amount as never), 0) } as T];
}

/**
 * The sample FRONT sheet left some sales out of its totals (owner request 2026-09-27: every item reflected and balanced).
 * These formulas make every sale count exactly once, so CASH SUBTOTAL + TOTAL ONLINE, CC & SHIPPING = all sales of the day
 * except AR/PDC, and the product counts include card sales:
 *  - agent cash (C9) is part of the cash subtotal; cash delivery fees of franchise/dealer deliveries are counted;
 *  - rider 2's online deliveries and every delivery / shipping fee paid online or by card are counted with their sale;
 *  - Shopee/Lazada sales are counted at their amount plus fee; card products and card transactions are shown.
 */
export function fixFrontFormulas(f: ExcelJS.Worksheet, rep: DailySalesReport) {
  const set = (addr: string, formula: string) => { f.getCell(addr).value = { formula } as ExcelJS.CellFormulaValue; };
  const CC = "'CREDIT CARD'", WI = "'WALK IN'";
  set('C10', 'DELIVERY!E29+DELIVERY!E59+DELIVERY!E93+DELIVERY!E126+DELIVERY!E159');
  set('C11', 'C5+C6+C7+C8+C9+C10');
  set('C13', `${CC}!E21+${CC}!F21`);
  set('C14', `${CC}!E74+${CC}!F74+${CC}!E99+${CC}!F99+${CC}!E124+${CC}!F124`);
  set('C15', `${CC}!E49+${CC}!F49`);
  set('C20', 'DELIVERY!L29+DELIVERY!M29+DELIVERY!L59+DELIVERY!M59');
  set('C21', 'DELIVERY!L93+DELIVERY!M93');
  set('C22', 'DELIVERY!L126+DELIVERY!M126');
  set('C23', 'DELIVERY!L159+DELIVERY!M159');
  set('C24', 'SHIPPING!D19+SHIPPING!E19');
  set('C25', 'SHIPPING!D46+SHIPPING!E46');
  set('C26', 'SHIPPING!L46+SHIPPING!M46');
  set('C27', 'SHIPPING!D74+SHIPPING!E74');
  set('C28', 'SHIPPING!L19+SHIPPING!M19');
  // number of products, card sales included
  set('F5', `${WI}!C30+${WI}!I30+${CC}!D21`);
  set('F6', `DELIVERY!C29+DELIVERY!K29+DELIVERY!C59+DELIVERY!K59+${CC}!D74+${CC}!D99+${CC}!D124`);
  set('F12', `${WI}!C111+${WI}!I111+DELIVERY!C159+DELIVERY!K159+SHIPPING!C74+${CC}!D49`);
  // fees box: each fee once
  set('F16', 'DELIVERY!M29+DELIVERY!M59'); f.getCell('E16').value = 'Delivery Fee (Online)';
  set('F17', `${CC}!F21+${CC}!F49+${CC}!F74+${CC}!F99+${CC}!F124`); f.getCell('E17').value = 'Delivery Fee (Credit Card)';
  set('F18', 'DELIVERY!M93'); f.getCell('E18').value = 'Franchise delivery fee (Online)';
  set('F19', 'DELIVERY!M126'); f.getCell('E19').value = 'Prothin Dealer delivery fee (Online)';
  set('F20', 'SHIPPING!E19+SHIPPING!M19+SHIPPING!E46+SHIPPING!M46+SHIPPING!E74'); f.getCell('E20').value = 'Shipping Fee';
  set('F21', 'DELIVERY!M159'); f.getCell('E21').value = 'Agent delivery fee (Online)';
  // card transactions and products
  f.getCell('E13').value = 'Card transactions:'; f.getCell('F13').value = rep.creditCard.transactions;
  f.getCell('E14').value = 'Card products:'; set('F14', `${CC}!D21+${CC}!D49+${CC}!D74+${CC}!D99+${CC}!D124`);
}
