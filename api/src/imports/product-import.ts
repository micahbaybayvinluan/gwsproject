/**
 * §7.1 Product import from `inventory.xlsm` sheet `DAILY INVTY COUNT`:
 * B = name, C = FRANCHISEE price, D = DEALER, E = RETAILER (SRP), F = COST (blank in the real file), G = actual qty on hand.
 * Brand header rows (all caps, or a name the next rows start with) have no prices and become the `brand` of the products below.
 * Pure classifier + row parser (unit-tested); DB writes live in ImportsService and the seed.
 */
export type AccClass = 'SUPPLEMENT' | 'FREEBIE' | 'PLASTIC' | 'APPAREL' | 'EQUIPMENT' | 'OTHER' | 'REPACKED' | 'BUNDLE';
export interface ParsedProduct { name: string; brand: string | null; franchise: number | null; dealer: number | null; retail: number | null; cost: number | null; openingQty: number | null; accountingClass: AccClass; needsReview: boolean; trackExpiry: boolean }

const KEYWORDS: [RegExp, AccClass][] = [
  [/^\s*repacked/i, 'REPACKED'],
  [/promo\s*bundle|bundle/i, 'BUNDLE'],
  [/shaker|bottle|tumbler|jug|funnel|pill\s*box|pillbox|scoop/i, 'PLASTIC'],
  [/plastic|ecobag|eco\s*bag|paper\s*bag/i, 'PLASTIC'],
  [/shirt|t-shirt|\btee\b|jersey|hoodie|jacket|shorts|leggings|\bcap\b|towel|\bbag\b|gloves|belt|wrist|knee|sleeve|socks|apparel|lettering|plain text/i, 'APPAREL'],
  [/dumbbell|barbell|\bbar\b|bench|rack|plate|kettlebell|band|rope|\bmat\b|roller|equipment|weight|machine|treadmill|bike/i, 'EQUIPMENT'],
  [/freebie|free\s*item|sample|giveaway/i, 'FREEBIE'],
];
const AMBIGUOUS = /\b(set|combo|pack|kit|bar)\b/i;

export function classify(name: string): { accountingClass: AccClass; needsReview: boolean } {
  for (const [re, cls] of KEYWORDS) if (re.test(name)) {
    if (cls === 'EQUIPMENT' && /protein|energy|snack|\bbar\b/i.test(name) && /protein|energy|snack/i.test(name)) return { accountingClass: 'SUPPLEMENT', needsReview: false }; // protein bars are food
    return { accountingClass: cls, needsReview: cls === 'BUNDLE' };
  }
  return { accountingClass: 'SUPPLEMENT', needsReview: AMBIGUOUS.test(name) };
}
const num = (v: unknown): number | null => { if (v == null || v === '') return null; const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[₱,\s]/g, '')); return Number.isFinite(n) ? n : null; };
const isAllCaps = (s: string) => /[A-Z]/.test(s) && s === s.toUpperCase();

/** Parse the raw grid (1-based rows/cols as exceljs gives them). Skips header/blank rows; brand headers set `brand` for following rows. */
export function parseProductGrid(grid: unknown[][]): ParsedProduct[] {
  const out: ParsedProduct[] = [];
  const rows = grid.filter(Boolean);
  let brand: string | null = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = String(row[2] ?? '').replace(/\s+/g, ' ').trim();
    if (!name || name === '.' || /^(item|items|product|name|description|daily|beg|total|inventory|no\.|\(note)/i.test(name)) continue;
    const franchise = num(row[3]), dealer = num(row[4]), retail = num(row[5]), cost = num(row[6]), qty = num(row[7]);
    const priced = franchise != null || dealer != null || retail != null;
    if (!priced) {
      // brand header if ALL CAPS, or if the next named row starts with this row's first word
      const next = rows.slice(i + 1).find((r) => String(r[2] ?? '').trim());
      const first = name.split(' ')[0].toLowerCase();
      const looksHeader = isAllCaps(name) || (!!next && name.split(' ').length <= 3 && String(next[2]).trim().toLowerCase().startsWith(first) && first.length > 2 && (qty == null || qty === 0));
      if (looksHeader) { brand = name.replace(/\s+$/, ''); continue; }
    }
    const c = classify(name);
    out.push({ name, brand, franchise, dealer, retail, cost, openingQty: qty != null ? Math.trunc(qty) : null, accountingClass: c.accountingClass, needsReview: c.needsReview || !priced, trackExpiry: ['SUPPLEMENT', 'REPACKED', 'FREEBIE', 'BUNDLE'].includes(c.accountingClass) });
  }
  return out;
}
