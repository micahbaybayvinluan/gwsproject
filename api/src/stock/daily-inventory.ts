import type { MovementType } from '@prisma/client';

/**
 * Daily Inventory Report (owner request, 2026-09): per product, per business day in a date range —
 * Beg → Receive / Transfer In / Returns / Pull Out / Sales / Other out / Adjustments → End,
 * with the same buckets valued at batch cost. Cost keys (`*Cost`) are stripped by the redaction layer for roles without `cost.view`.
 * Pure function: the service feeds it ledger rows; tests exercise it without a DB.
 */
export interface LedgerRow { productId: string; qtyDelta: number; movementType: MovementType; businessDate: string; unitCost: number }
export interface Opening { productId: string; qty: number; cost: number }
export interface ProductRef { id: string; sku: string; name: string; brand?: string | null }

export const RECEIVE: MovementType[] = ['RECEIVE'];
export const TRANSFER_IN: MovementType[] = ['TRANSFER_IN', 'CONSIGN_RETURN', 'BUNDLE_BUILD'];
export const RETURNS: MovementType[] = ['SALE_RETURN'];
export const PULL_OUT: MovementType[] = ['TRANSFER_OUT', 'RETURN_TO_WAREHOUSE', 'RETURN_TO_SUPPLIER', 'CONSIGN_OUT', 'BUNDLE_BREAK'];
export const SALES: MovementType[] = ['SALE', 'CONSIGN_SALE'];
export const OTHER_OUT: MovementType[] = ['FREEBIE_ISSUE', 'TASTING'];
export const ADJUST: MovementType[] = ['ADJUST_COUNT', 'EXPIRED_WRITEOFF'];

export interface Buckets { receive: number; transferIn: number; returns: number; pullOut: number; sales: number; other: number; adjust: number; receiveCost: number; transferInCost: number; returnsCost: number; pullOutCost: number; salesCost: number; otherCost: number; adjustCost: number }
export interface DayRow extends Buckets { date: string; beg: number; begCost: number; end: number; endCost: number }
export interface ProductRow extends Buckets { product: ProductRef; beg: number; begCost: number; end: number; endCost: number; unitCost: number; moved: boolean; days: DayRow[] }
export interface DailyInventoryReport { from: string; to: string; days: string[]; products: ProductRow[]; totals: Buckets & { beg: number; begCost: number; end: number; endCost: number } }

const r2 = (n: number) => Math.round(n * 100) / 100;
const emptyBuckets = (): Buckets => ({ receive: 0, transferIn: 0, returns: 0, pullOut: 0, sales: 0, other: 0, adjust: 0, receiveCost: 0, transferInCost: 0, returnsCost: 0, pullOutCost: 0, salesCost: 0, otherCost: 0, adjustCost: 0 });

/** True when any stock moved (receive, transfer, return, pull-out, sale, other out or adjustment). */
export const hasMovement = (b: Pick<Buckets, 'receive' | 'transferIn' | 'returns' | 'pullOut' | 'sales' | 'other' | 'adjust'>) => !!(b.receive || b.transferIn || b.returns || b.pullOut || b.sales || b.other || b.adjust);

/** Inclusive list of YYYY-MM-DD strings from..to. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = []; const d = new Date(`${from}T00:00:00Z`); const end = new Date(`${to}T00:00:00Z`);
  for (; d <= end && out.length < 400; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

export function buildDailyInventory(from: string, to: string, products: ProductRef[], opening: Opening[], moves: LedgerRow[]): DailyInventoryReport {
  const days = dateRange(from, to);
  // a consignment out lands at the consignee as a positive CONSIGN_OUT row: count it as stock coming in there
  moves = moves.map((m) => (m.movementType === 'CONSIGN_OUT' && m.qtyDelta > 0 ? { ...m, movementType: 'TRANSFER_IN' as MovementType } : m));
  const byProduct = new Map<string, LedgerRow[]>(); for (const m of moves) { const a = byProduct.get(m.productId) ?? []; a.push(m); byProduct.set(m.productId, a); }
  const openMap = new Map(opening.map((o) => [o.productId, o]));
  const rows: ProductRow[] = [];
  for (const p of [...products].sort((a, b) => a.name.localeCompare(b.name))) {
    const pm = byProduct.get(p.id) ?? []; const o = openMap.get(p.id);
    if (!pm.length && !(o && (o.qty || o.cost))) continue; // nothing to report for this product
    let qty = o?.qty ?? 0; let cost = o?.cost ?? 0;
    const tot = emptyBuckets(); const begQty = qty, begCost = cost;
    const dayRows: DayRow[] = [];
    for (const date of days) {
      const dm = pm.filter((m) => m.businessDate === date);
      const b = emptyBuckets();
      const add = (k: keyof Buckets, ck: keyof Buckets, types: MovementType[], signed = false) => { for (const m of dm) if (types.includes(m.movementType)) { const q = signed ? m.qtyDelta : Math.abs(m.qtyDelta); (b[k] as number) += q; (b[ck] as number) += q * m.unitCost; } };
      add('receive', 'receiveCost', RECEIVE); add('transferIn', 'transferInCost', TRANSFER_IN); add('returns', 'returnsCost', RETURNS);
      add('pullOut', 'pullOutCost', PULL_OUT); add('sales', 'salesCost', SALES); add('other', 'otherCost', OTHER_OUT); add('adjust', 'adjustCost', ADJUST, true);
      const dBeg = qty, dBegCost = cost;
      qty += b.receive + b.transferIn + b.returns - b.pullOut - b.sales - b.other + b.adjust;
      cost += b.receiveCost + b.transferInCost + b.returnsCost - b.pullOutCost - b.salesCost - b.otherCost + b.adjustCost;
      for (const k of Object.keys(b) as (keyof Buckets)[]) (tot[k] as number) += b[k];
      dayRows.push({ date, beg: dBeg, begCost: r2(dBegCost), ...b, end: qty, endCost: r2(cost) });
    }
    for (const d of dayRows) for (const k of Object.keys(d) as (keyof DayRow)[]) if (k.endsWith('Cost')) (d[k] as number) = r2(d[k] as number);
    for (const k of Object.keys(tot) as (keyof Buckets)[]) if (k.endsWith('Cost')) (tot[k] as number) = r2(tot[k]);
    rows.push({ product: p, beg: begQty, begCost: r2(begCost), ...tot, end: qty, endCost: r2(cost), unitCost: qty ? r2(cost / qty) : 0, moved: hasMovement(tot), days: dayRows });
  }
  // items that moved in the period first, then items only carried in stock (owner request 2026-09-27); by name within each group
  rows.sort((a, b) => Number(b.moved) - Number(a.moved) || a.product.name.localeCompare(b.product.name));
  const totals = { ...emptyBuckets(), beg: 0, begCost: 0, end: 0, endCost: 0 };
  for (const p of rows) for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] = r2(totals[k] + (p[k] as number));
  return { from, to, days, products: rows, totals };
}
