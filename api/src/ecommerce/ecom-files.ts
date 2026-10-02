/**
 * Readers for the files the E-comm Associate downloads from each platform (owner request 2026-09-28): TikTok Shop, Shopee and Lazada
 * are kept separate, each with its own column names. Pure functions (no Nest / Prisma) so they are unit-tested on their own.
 *
 * Column names are matched loosely (case, spaces and symbols ignored), so both the platforms' own exports and the GWS templates work.
 * Fees are never computed here: the amounts come from the platform's own file, and whatever the file pays that is not explained by the
 * known columns is kept as "other adjustments" so the payout always ties to the money received.
 */
import { loadWorkbook } from '../imports/workbook-readers';

export const PLATFORMS = ['TIKTOK', 'SHOPEE', 'LAZADA'] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_INFO: Record<Platform, { name: string; locationCode: string; locationName: string; cashKey: string; ads: string }> = {
  TIKTOK: { name: 'TikTok Shop', locationCode: 'ECOM-TIKTOK', locationName: 'TikTok – with courier', cashKey: 'TIKTOK_CASH', ads: 'TikTok Ads' },
  SHOPEE: { name: 'Shopee', locationCode: 'ECOM-SHOPEE', locationName: 'Shopee – with courier', cashKey: 'SHOPEE_CASH', ads: 'Shopee Ads' },
  LAZADA: { name: 'Lazada', locationCode: 'ECOM-LAZADA', locationName: 'Lazada – with courier', cashKey: 'LAZADA_CASH', ads: 'Lazada Sponsored Solutions' },
};
export const isPlatform = (p: string): p is Platform => (PLATFORMS as readonly string[]).includes(p);

/** Column label → comparable key: "SKU Reference No." → "skureferenceno". */
export const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const round2 = (n: number) => Math.round(n * 100) / 100;
/** "₱1,234.50", "(12.00)", "-12" → number (blank → 0). */
export function num(v: unknown): number {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim();
  if (!s) return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[^0-9.\-]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
}

/** A small CSV reader (quoted fields, commas / tabs / semicolons, CRLF). */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const firstLine = t.split(/\r?\n/, 1)[0] ?? '';
  const sep = [',', '\t', ';'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const cellText = (v: unknown): string => {
  if (v && typeof v === 'object') {
    if ('result' in (v as object)) return cellText((v as { result: unknown }).result);
    if ('richText' in (v as object)) return (v as { richText: { text: string }[] }).richText.map((x) => x.text).join('');
    if ('text' in (v as object)) return String((v as { text: unknown }).text);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return v == null ? '' : String(v).trim();
};

/** Every sheet of an Excel file (or the one CSV) as rows of text. */
export async function readSheets(buf: Buffer, fileName = ''): Promise<string[][][]> {
  const isZip = buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b;
  if (!isZip || /\.csv$/i.test(fileName)) return [parseCsv(buf.toString('utf8'))];
  const wb = await loadWorkbook(buf);
  return wb.worksheets.map((ws) => {
    const out: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (r) => { const vals = r.values as unknown[]; const row: string[] = []; for (let j = 1; j < vals.length; j++) row.push(cellText(vals[j])); out.push(row); });
    return out;
  });
}

export interface Table { header: string[]; keys: string[]; rows: string[][] }
/** Find the header row (the first row, within the first 15, that has one of `mustHave`), in the first sheet that has one. */
export function findTable(sheets: string[][][], mustHave: string[]): Table | null {
  for (const rows of sheets) {
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const keys = rows[i].map(norm);
      if (mustHave.some((m) => keys.includes(m))) return { header: rows[i], keys, rows: rows.slice(i + 1) };
    }
  }
  return null;
}
/** Index of the first column whose key equals (or, with `prefix`, starts with) one of the aliases, in alias order. */
export function col(keys: string[], aliases: string[], prefix = false): number {
  for (const a of aliases) { const i = keys.findIndex((k) => k === a || (prefix && k.startsWith(a))); if (i >= 0) return i; }
  return -1;
}

// ─────────────── Orders / waybills ───────────────

const ORDER_ID = ['orderid', 'ordernumber', 'orderno', 'ordersn', 'relatedorderid', 'orderadjustmentid'];
const SKU = ['gwssku', 'sellersku', 'skureferenceno', 'skureference', 'parentskureferenceno', 'sku', 'lazadasku', 'skuid'];
const QTY = ['quantity', 'qty', 'skuquantity'];
const TRACKING = ['trackingid', 'trackingnumber', 'trackingcode', 'trackingno', 'waybillno', 'waybillnumber', 'awb', 'awbno'];
const STATUS = ['orderstatus', 'status', 'orderitemstatus'];
const NAME = ['productname', 'itemname', 'name'];
const VARIATION = ['variation', 'variationname', 'skuname', 'option'];

export interface ParsedOrder { orderId: string; trackingNo: string | null; lines: { sku: string; name: string | null; qty: number }[] }
export interface ParsedOrders { orders: ParsedOrder[]; cancelled: string[]; errors: string[] }

/**
 * The platform's order export (TikTok "To ship" export, Shopee order export, Lazada order export) or the GWS template.
 * One row per item; Lazada lists each unit on its own row (no quantity column), so a missing quantity counts as 1.
 */
export function parseOrders(sheets: string[][][]): ParsedOrders {
  const t = findTable(sheets, ORDER_ID);
  if (!t) return { orders: [], cancelled: [], errors: ['No "Order ID" (or Order Number) column found. Upload the platform\'s order export or the GWS orders template.'] };
  const iOrder = col(t.keys, ORDER_ID); const iSku = col(t.keys, SKU); const iQty = col(t.keys, QTY); const iTrack = col(t.keys, TRACKING, true); const iStatus = col(t.keys, STATUS); const iName = col(t.keys, NAME);
  const iVar = col(t.keys, VARIATION); const iSkuId = col(t.keys, ['skuid']);
  // an export without a seller SKU (TikTok "To ship" lists the product title and the variation): the title and the variation identify the item
  if (iSku < 0 && iName < 0) return { orders: [], cancelled: [], errors: ['No SKU or product name column found (Seller SKU / SKU Reference No. / Product Name).'] };
  const byId = new Map<string, ParsedOrder>(); const cancelled = new Set<string>(); const errors: string[] = [];
  t.rows.forEach((r, n) => {
    const orderId = (r[iOrder] ?? '').trim(); const title = iName >= 0 ? (r[iName] ?? '').trim() : ''; const variation = iVar >= 0 ? (r[iVar] ?? '').trim() : '';
    const sku = (iSku >= 0 ? (r[iSku] ?? '').trim() : '') || (iSkuId >= 0 ? (r[iSkuId] ?? '').trim() : '') || (title ? `${title}${variation ? ` :: ${variation}` : ''}` : '');
    if (!orderId || !sku) return;
    // TikTok puts a description row under the header ("Platform unique order ID.")
    if (/\s/.test(orderId) && !/\d/.test(orderId)) return;
    const status = iStatus >= 0 ? (r[iStatus] ?? '').toLowerCase() : '';
    if (/cancel|unpaid|failed|returned/.test(status)) { cancelled.add(orderId); return; }
    const qtyText = iQty >= 0 ? (r[iQty] ?? '').trim() : '1';
    const qty = qtyText === '' ? 1 : num(qtyText);
    if (!Number.isInteger(qty) || qty <= 0) { if (/\d/.test(qtyText)) errors.push(`Row ${n + 2}: quantity "${qtyText}" for order ${orderId} is not a whole number`); return; }
    const o = byId.get(orderId) ?? { orderId, trackingNo: null, lines: [] };
    const track = iTrack >= 0 ? (r[iTrack] ?? '').trim() : '';
    if (track) o.trackingNo = track;
    const same = o.lines.find((l) => l.sku === sku);
    if (same) same.qty += qty; else o.lines.push({ sku, name: iName >= 0 && r[iName] ? `${r[iName].trim()}${variation ? ` — ${variation}` : ''}` : null, qty });
    byId.set(orderId, o);
  });
  for (const id of cancelled) byId.delete(id);
  return { orders: [...byId.values()], cancelled: [...cancelled], errors };
}

// ─────────────── Settlements (payout / income / finance statements) ───────────────

export const AMOUNT_KEYS = ['grossSales', 'sellerDiscounts', 'commission', 'transactionFee', 'shippingFee', 'affiliateFee', 'otherFees', 'refunds', 'withholdingTax'] as const;
export type AmountKey = (typeof AMOUNT_KEYS)[number];
export type Amounts = Record<AmountKey | 'payout' | 'adjustments', number>;
export const zeroAmounts = (): Amounts => ({ grossSales: 0, sellerDiscounts: 0, commission: 0, transactionFee: 0, shippingFee: 0, affiliateFee: 0, otherFees: 0, refunds: 0, withholdingTax: 0, payout: 0, adjustments: 0 });
/** What the platform took off the sale (positive = a cost to GWS). */
export const deductions = (a: Amounts) => a.sellerDiscounts + a.commission + a.transactionFee + a.shippingFee + a.affiliateFee + a.otherFees + a.refunds + a.withholdingTax;

/** Wide files (one row per order): the first matching column per amount, so a detail column is never counted twice with its total. */
const WIDE: Record<AmountKey | 'payout', string[]> = {
  payout: ['payout', 'totalsettlementamount', 'settlementamount', 'totalreleasedamount', 'releasedamount', 'escrowamount', 'payoutamount', 'netamount', 'amountreleased'],
  grossSales: ['grosssales', 'subtotalbeforediscounts', 'skusubtotalbeforediscount', 'originalproductprice', 'originalprice', 'productsubtotal', 'itemprice', 'itempricecredit', 'totalrevenue', 'revenue'],
  sellerDiscounts: ['sellerdiscounts', 'sellerdiscount', 'yourproductdiscount', 'productdiscountrebatefromseller', 'sellervoucher', 'vouchersponsoredbyseller', 'sellerfundedvoucher', 'promotionalchargesvouchers', 'sellercoinscashback'],
  commission: ['commission', 'tiktokshopcommissionfee', 'platformcommissionfee', 'commissionfee'],
  transactionFee: ['transactionfee', 'paymentfee', 'paymentprocessingfee', 'transactionfeepaymentfee'],
  shippingFee: ['shippingfee', 'sellershippingfee', 'shippingfeepaidbyseller', 'shippingfeesellerpaid', 'shippingfeediscrepancy', 'actualreturnshippingfee', 'returnshippingfee'],
  affiliateFee: ['affiliatecommission', 'affiliatefee', 'amscommissionfee', 'affiliatepartnercommission', 'creatorcommission'],
  otherFees: ['otherfees', 'servicefee', 'voucherxtraservicefee', 'freeshippingmaxfee', 'coinscashbackprogramfee', 'flashsalesservicefee', 'sfpservicefee', 'marketingfee'],
  refunds: ['refunds', 'refundamount', 'refundamounttobuyer', 'refundsubtotalaftersellerdiscounts', 'refundsubtotal'],
  withholdingTax: ['withholdingtax', 'taxwithheld', 'whtamount', 'withholdingtaxwht', 'creditablewithholdingtax', 'withholdingtax1', 'ewt'],
};
/** Long files (Lazada "transaction overview": one row per fee, with a Fee Name and an Amount): fee name → amount key. */
export function classifyFee(name: string): AmountKey | 'ignore' {
  const n = name.toLowerCase();
  if (/withholding|wht|tax withheld/.test(n)) return 'withholdingTax';
  if (/affiliate|ams|creator/.test(n)) return 'affiliateFee';
  if (/commission/.test(n)) return 'commission';
  if (/payment fee|transaction fee|payment processing/.test(n)) return 'transactionFee';
  if (/refund|reversal item price|reversal of item price/.test(n)) return 'refunds';
  if (/shipping fee paid by customer|shipping fee \(paid by customer\)|buyer.*shipping/.test(n)) return 'ignore';
  if (/shipping|delivery/.test(n)) return 'shippingFee';
  if (/voucher|discount|promotion|bundle|cashback/.test(n)) return 'sellerDiscounts';
  if (/item price|product price|sales|revenue/.test(n)) return 'grossSales';
  return 'otherFees';
}

export interface ParsedSettlement { orders: { orderId: string; amounts: Amounts }[]; filePayout: number; format: 'wide' | 'long'; columnsUsed: Partial<Record<AmountKey | 'payout', string>>; errors: string[] }

/**
 * Settlement / payout file → amounts per order (rows of the same order are added up). Costs are taken as positive numbers whichever
 * sign the platform uses; the payout keeps its sign. `adjustments` = payout − (gross − deductions): what the file paid beyond the
 * known columns (shipping rebates, platform subsidies, adjustments), so the posted entry always equals the payout.
 */
export function parseSettlement(sheets: string[][][]): ParsedSettlement {
  const t = findTable(sheets, ORDER_ID);
  if (!t) return { orders: [], filePayout: 0, format: 'wide', columnsUsed: {}, errors: ['No "Order ID" (or Order Number) column found. Upload the platform\'s settlement / income statement or the GWS payout template.'] };
  const iOrder = [col(t.keys, ['relatedorderid']), col(t.keys, ORDER_ID)].filter((i) => i >= 0);
  const orderOf = (r: string[]) => { for (const i of iOrder) { const v = (r[i] ?? '').trim(); if (v && /\d/.test(v)) return v; } return ''; };
  const iFee = col(t.keys, ['feename', 'transactiontype', 'feetype']); const iAmount = col(t.keys, ['amount', 'amountphp', 'transactionamount']);
  const iGross = col(t.keys, WIDE.grossSales);
  const out = new Map<string, Amounts>(); const errors: string[] = [];
  const get = (id: string) => { let a = out.get(id); if (!a) { a = zeroAmounts(); out.set(id, a); } return a; };
  if (iFee >= 0 && iAmount >= 0 && iGross < 0) {
    for (const r of t.rows) {
      const id = orderOf(r); if (!id) continue;
      const amt = num(r[iAmount]); const a = get(id); const k = classifyFee(r[iFee] ?? '');
      a.payout += amt;
      if (k === 'ignore') continue;
      if (k === 'grossSales') a.grossSales += amt; else a[k] += -amt; // a fee row is negative in the file = a positive cost
    }
    const iWht = col(t.keys, ['whtamount']);
    if (iWht >= 0) for (const r of t.rows) { const id = orderOf(r); if (id) { const w = Math.abs(num(r[iWht])); get(id).withholdingTax += w; get(id).payout -= w; } }
  } else {
    const idx = Object.fromEntries(Object.entries(WIDE).map(([k, aliases]) => [k, col(t.keys, aliases)])) as Record<AmountKey | 'payout', number>;
    if (idx.payout < 0) errors.push('No payout / settlement amount column found; the payout is computed as gross sales less the fees.');
    for (const r of t.rows) {
      const id = orderOf(r); if (!id) continue;
      const a = get(id);
      for (const k of AMOUNT_KEYS) if (idx[k] >= 0) a[k] += k === 'grossSales' ? num(r[idx[k]]) : Math.abs(num(r[idx[k]]));
      a.payout += idx.payout >= 0 ? num(r[idx.payout]) : 0;
    }
    if (idx.payout < 0) for (const a of out.values()) a.payout = a.grossSales - deductions(a);
  }
  const orders = [...out.entries()].map(([orderId, a]) => {
    for (const k of Object.keys(a) as (keyof Amounts)[]) a[k] = round2(a[k]);
    a.adjustments = round2(a.payout - (a.grossSales - deductions(a)));
    return { orderId, amounts: a };
  });
  const columnsUsed: ParsedSettlement['columnsUsed'] = {};
  if (!(iFee >= 0 && iAmount >= 0 && iGross < 0)) for (const [k, aliases] of Object.entries(WIDE)) { const i = col(t.keys, aliases); if (i >= 0) columnsUsed[k as AmountKey] = t.header[i]; }
  return { orders, filePayout: round2(orders.reduce((s, o) => s + o.amounts.payout, 0)), format: iFee >= 0 && iAmount >= 0 && iGross < 0 ? 'long' : 'wide', columnsUsed, errors };
}

// ─────────────── Ads ───────────────

/** Ads billing / invoice export: amount per month (YYYY-MM) from a date column and a cost / amount column. */
export function parseAds(sheets: string[][][], fallbackMonth: string): { months: { month: string; amount: number }[]; errors: string[] } {
  const AMT = ['amount', 'cost', 'spend', 'totalcost', 'amountspent', 'totalamount', 'billedamount', 'amountphp', 'adspend', 'expense'];
  const t = findTable(sheets, AMT);
  if (!t) return { months: [], errors: ['No Amount / Cost / Spend column found.'] };
  const iAmt = col(t.keys, AMT); const iDate = col(t.keys, ['date', 'month', 'billingdate', 'invoicedate', 'transactiondate', 'day', 'period'], true);
  const byMonth = new Map<string, number>();
  for (const r of t.rows) {
    const label = r.join(' ').toLowerCase();
    if (/total/.test(label) && !(r[iDate] ?? '').match(/\d{4}/)) continue;
    const amt = Math.abs(num(r[iAmt])); if (!amt) continue;
    const month = monthOf(iDate >= 0 ? r[iDate] ?? '' : '') ?? fallbackMonth;
    byMonth.set(month, (byMonth.get(month) ?? 0) + amt);
  }
  return { months: [...byMonth.entries()].sort().map(([month, amount]) => ({ month, amount: round2(amount) })), errors: [] };
}
/** "2026-09-14", "09/14/2026", "14/09/2026", "Sep 2026", "2026-09" → "2026-09". */
export function monthOf(s: string): string | null {
  const v = s.trim();
  let m = v.match(/^(\d{4})[-/.](\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/); if (m) { const a = Number(m[1]); const b = Number(m[2]); const month = a > 12 ? b : a; return `${m[3]}-${String(month).padStart(2, '0')}`; }
  const names = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  m = v.toLowerCase().match(/([a-z]{3})[a-z]*\.?\s+(\d{4})/); if (m && names.includes(m[1])) return `${m[2]}-${String(names.indexOf(m[1]) + 1).padStart(2, '0')}`;
  return null;
}

/** GWS templates (header rows) for associates whose platform file does not read well. */
export const TEMPLATES = {
  orders: ['Order ID', 'Tracking Number', 'GWS SKU', 'Product Name', 'Quantity'],
  settlement: ['Order ID', 'Gross Sales', 'Seller Discounts', 'Commission', 'Transaction Fee', 'Shipping Fee', 'Affiliate Commission', 'Other Fees', 'Refunds', 'Withholding Tax', 'Payout'],
  ads: ['Date', 'Amount', 'Campaign'],
} as const;
