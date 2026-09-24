/**
 * §7.1 Product import from `inventory.xlsm` sheet `DAILY INVTY COUNT`:
 * B = name, C = FRANCHISEE price, D = DEALER, E = RETAILER (SRP), F = COST (may be blank).
 * Pure classifier + row parser (unit-tested); DB writes live in ImportsService.
 */
export type AccClass = 'SUPPLEMENT' | 'FREEBIE' | 'PLASTIC' | 'APPAREL' | 'EQUIPMENT' | 'OTHER' | 'REPACKED' | 'BUNDLE';
export interface ParsedProduct { name: string; franchise: number | null; dealer: number | null; retail: number | null; cost: number | null; accountingClass: AccClass; needsReview: boolean; trackExpiry: boolean }

const KEYWORDS: [RegExp, AccClass][] = [
  [/^\s*repacked/i, 'REPACKED'],
  [/promo\s*bundle|bundle/i, 'BUNDLE'],
  [/shaker|bottle|tumbler|jug|funnel|pill\s*box|pillbox|scoop/i, 'PLASTIC'],
  [/plastic|ecobag|eco\s*bag|paper\s*bag/i, 'PLASTIC'],
  [/shirt|t-shirt|tee|jersey|hoodie|jacket|shorts|leggings|cap\b|towel|bag\b|gloves|belt|wrist|knee|sleeve|socks|apparel/i, 'APPAREL'],
  [/dumbbell|barbell|\bbar\b|bench|rack|plate|kettlebell|band|rope|mat\b|roller|equipment|weight|machine|treadmill|bike/i, 'EQUIPMENT'],
  [/freebie|free\s*item|sample|sachet\s*free|giveaway/i, 'FREEBIE'],
];
const AMBIGUOUS = /\b(set|combo|pack|kit|bar)\b/i;

export function classify(name: string): { accountingClass: AccClass; needsReview: boolean } {
  for (const [re, cls] of KEYWORDS) if (re.test(name)) return { accountingClass: cls, needsReview: cls === 'BUNDLE' || (cls === 'EQUIPMENT' && /\bbar\b/i.test(name) && /protein|energy|snack/i.test(name)) };
  return { accountingClass: 'SUPPLEMENT', needsReview: AMBIGUOUS.test(name) };
}
const num = (v: unknown): number | null => { if (v == null || v === '') return null; const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[₱,\s]/g, '')); return Number.isFinite(n) ? n : null; };

/** Parse the raw grid (1-based rows/cols as exceljs gives them). Skips header/blank/section rows. */
export function parseProductGrid(grid: unknown[][]): ParsedProduct[] {
  const out: ParsedProduct[] = [];
  for (const row of grid) {
    if (!row) continue;
    const name = String(row[2] ?? '').trim();
    if (!name || /^(item|items|product|name|description|daily|beg|total)/i.test(name)) continue;
    const franchise = num(row[3]), dealer = num(row[4]), retail = num(row[5]), cost = num(row[6]);
    if (franchise == null && dealer == null && retail == null) continue; // section header rows
    const c = classify(name);
    // protein bars are supplements (food) — override the equipment "bar" keyword
    const accountingClass: AccClass = /protein|energy|snack/i.test(name) && c.accountingClass === 'EQUIPMENT' ? 'SUPPLEMENT' : c.accountingClass;
    out.push({ name, franchise, dealer, retail, cost, accountingClass, needsReview: c.needsReview, trackExpiry: ['SUPPLEMENT', 'REPACKED', 'FREEBIE', 'BUNDLE'].includes(accountingClass) });
  }
  return out;
}
