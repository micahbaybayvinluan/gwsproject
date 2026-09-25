/**
 * §10.1 Chart-of-accounts import helpers: parse the `BALANCE SHEET` / `INCOME STATEMENT` sheets of
 * `ACCTG PROGRAM - FORMAT.xlsm` (and the `CA` code list), detect branch/channel tags from messy titles and match
 * accounts to branch templates. Pure functions (unit-tested); the import review screen lets Accounting Head override.
 */
import type { TemplateRow } from './account-templates';

export interface KnownLocation { id: string; name: string; code: string; type: string }
export type AccountClassKey = TemplateRow['class'];

/** Location code → the spellings that appear in account titles. Longest alias wins. */
export const BRANCH_ALIASES: Record<string, string[]> = {
  WESTAVE: ['west ave', 'west ave.', 'westave', 'west avenue'],
  CSR: ['csr', 'csr ave'],
  IMUS: ['imus', 'imus cavite', 'imus, cavite'],
  LAGUNA: ['laguna'],
  DASMA: ['dasma', 'dasmarinas', 'dasmariñas', 'dasmarinas cavite'],
  VITOCRUZ: ['vito cruz', 'vitocruz'],
  WH: ['warehouse', 'wh', 'bodega'],
  OFFICE: ['office'],
  '711': ['7-11', '7/11', '7-eleven', '711', 'lawson', 'seven eleven'],
  MAYON: ['mayon'], MALOLOS: ['malolos', 'malolos bulacan'], PARANAQUE: ['paranaque', 'parañaque'], ISABELA: ['isabela'], BAGUIO: ['baguio'], PANGASINAN: ['pangasinan'], NAGA: ['naga'], BACOLOD: ['bacolod'], CALOOCAN: ['caloocan'], RIZAL: ['rizal'],
};
const CHANNEL_TAGS: [RegExp, string][] = [
  [/credit card walk[- ]?in/i, 'CREDIT_CARD_WALK_IN'], [/franchise/i, 'FRANCHISE'], [/dealers?/i, 'DEALER'], [/walk[- ]?in/i, 'WALK_IN'], [/delivery fee/i, 'DELIVERY_FEE'], [/delivery/i, 'DELIVERY'],
  [/shipping fee/i, 'SHIPPING_FEE'], [/shipping/i, 'SHIPPING_COURIER'], [/shopee/i, 'SHOPEE'], [/lazada/i, 'LAZADA'], [/tik ?tok/i, 'TIKTOK'], [/personal/i, 'PERSONAL'], [/consignment/i, 'CONSIGNMENT'], [/discount/i, 'DISCOUNT'], [/returns?/i, 'RETURNS'], [/agent/i, 'AGENT'], [/others?/i, 'OTHER'],
];

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function normalizeTitle(t: string) { return t.replace(/\s+/g, ' ').replace(/\s*[-–—]\s*/g, ' – ').trim(); }
export const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Find a branch tag by scanning the title for aliases. Returns location code or null. Only codes present in `locations` are considered. */
export function parseBranchTag(title: string, locations: KnownLocation[]): string | null {
  const t = ` ${title.toLowerCase().replace(/[()]/g, ' ').replace(/\s+/g, ' ')} `;
  const known = locations.length ? new Set(locations.map((l) => l.code)) : new Set(Object.keys(BRANCH_ALIASES));
  let best: { code: string; len: number; pos: number } | null = null;
  for (const [code, aliases] of Object.entries(BRANCH_ALIASES)) {
    if (!known.has(code)) continue;
    for (const a of aliases) {
      const re = new RegExp(`(^|[\\s–\\-(,])${escapeRe(a)}(?=[\\s,)\\-–.]|$)`, 'gi');
      let m: RegExpExecArray | null; let pos = -1;
      while ((m = re.exec(t))) pos = m.index;
      // branch tags are suffixes ("Rent - CSR", "(Imus)"): the alias that appears last wins; ties go to the longer alias
      if (pos >= 0 && (!best || pos > best.pos || (pos === best.pos && a.length > best.len))) best = { code, len: a.length, pos };
    }
  }
  return best?.code ?? null;
}
/** Remove every alias of the given location code (and the location's own name) from a title. */
export function stripBranch(title: string, code: string | null, locations: KnownLocation[] = []): string {
  let t = title;
  const names = [...(code ? BRANCH_ALIASES[code] ?? [] : []), ...locations.filter((l) => l.code === code).map((l) => l.name)].sort((a, b) => b.length - a.length);
  for (const a of names) t = t.replace(new RegExp(escapeRe(a), 'gi'), ' ');
  return t;
}
export function parseChannelTag(title: string): string | null {
  if (!/sales/i.test(title)) return null;
  for (const [re, tag] of CHANNEL_TAGS) if (re.test(title)) return tag;
  return null;
}

/** Section header text (col A of the workbook sheets) → account class. */
export function classFromSection(section: string, title: string): AccountClassKey {
  const s = section.toUpperCase().replace(/\s+/g, ' '); const t = title.toLowerCase();
  if (s.includes('REVENUE')) return /^(other income|interest income)/.test(t) ? 'OTHER_INCOME' : 'REVENUE';
  if (s.includes('DIRECT')) return 'DIRECT_COST';
  if (s.includes('OPERATING') || s.includes('OPEX')) return 'OPEX';
  if (s.includes('OTHER INCOME')) return 'OTHER_INCOME';
  if (s.includes('RECEIVABLE')) return 'AR';
  if (s.includes('INVENTORY')) return 'INVENTORY';
  if (s.includes('ADVANCES TO')) return 'ADVANCES_TO';
  if (s.includes('ADVANCES FROM')) return 'ADVANCES_FROM';
  if (s.includes('FIXED')) return /accumulated dep/.test(t) ? 'ACCUM_DEPN' : 'FIXED_ASSET';
  if (s.includes('LIAB')) return 'CURRENT_LIABILITY';
  if (s.includes('EQUITY') || s.includes('CAPITAL')) return 'EQUITY';
  if (s.includes('CASH')) return 'CASH';
  // no section: infer from title
  if (/accumulated dep/.test(t)) return 'ACCUM_DEPN';
  if (/^(cash|petty cash|gcash)/.test(t) || /cash in bank|cash on hand|platform/.test(t)) return 'CASH';
  if (/^ar\b|receivable/.test(t)) return 'AR';
  if (/inventory/.test(t)) return 'INVENTORY';
  if (/advances to|prepaid|deposits?\b/.test(t)) return 'ADVANCES_TO';
  if (/advances from/.test(t)) return 'ADVANCES_FROM';
  if (/payable|output tax|loan|accrued/.test(t)) return 'CURRENT_LIABILITY';
  if (/capital|retained|drawing|equity/.test(t)) return 'EQUITY';
  if (/^sales/.test(t)) return 'REVENUE';
  if (/^direct cost|^salaries|^incentives|^expired|^13th|sss\/philhealth/.test(t)) return 'DIRECT_COST';
  return 'OPEX';
}

/** Match a title to a template by removing the branch alias and comparing the normalised remainder with the pattern (minus `{branch}`). */
export function matchTemplate(title: string, templates: { key: string; titlePattern: string }[], locations: KnownLocation[] = []): string | null {
  const code = parseBranchTag(title, locations);
  const stripped = stripBranch(title, code, locations).replace(/\bave\.?\s+(?=dealers)/i, ' '); // "Sales - Imus Ave Dealers" (copy-paste of West Ave) → "Sales - Dealers"
  const t = norm(stripped);
  const exact = templates.find((tp) => norm(tp.titlePattern.replace('{branch}', '')) === t);
  return exact?.key ?? null;
}
export function entryScopeFor(cls: string, branchTag: string | null): 'BRANCH' | 'MAIN' | 'BOTH' { return (cls === 'OPEX' || cls === 'DIRECT_COST') && branchTag ? 'BRANCH' : 'MAIN'; }

export interface ParsedCoaRow { code: string | null; title: string; section: string; class: AccountClassKey; branchCode: string | null; channelTag: string | null; templateKey: string | null; entryScope: 'BRANCH' | 'MAIN' | 'BOTH'; isPaymentAccount: boolean; paymentAccountType: string | null; beginningDebit: number; beginningCredit: number; balance: number | null }

const CODE_RE = /^\d{3,6}[A-Z]?$/;
const SKIP_RE = /^(total|gross profit|net income|should be zero|liabilities & she|getwheysted|balance sheet|income statement)/i;

/** Parse a BALANCE SHEET / INCOME STATEMENT grid (1-based rows/cols as exceljs yields them; col A code|section, col B title, col C beginning balance). */
export function parseCoaGrid(grid: unknown[][], templates: { key: string; titlePattern: string }[], locations: KnownLocation[], caCodes: Map<string, string> = new Map()): ParsedCoaRow[] {
  const out: ParsedCoaRow[] = []; let section = '';
  for (const row of grid) {
    if (!row) continue;
    const a = String(row[1] ?? '').trim(); const b = String(row[2] ?? '').trim();
    if (!a && !b) continue;
    if (a && !CODE_RE.test(a) && !b) { if (!SKIP_RE.test(a)) section = a; continue; } // section header
    const code = CODE_RE.test(a) ? a : null;
    const title = normalizeTitle(b || a);
    if (!title || SKIP_RE.test(title)) continue;
    const cls = classFromSection(section, title);
    const branchCode = parseBranchTag(title, locations);
    const rawBal = row[3]; const balance = typeof rawBal === 'number' ? rawBal : rawBal != null && rawBal !== '' && !Number.isNaN(Number(rawBal)) ? Number(rawBal) : null;
    const isBs = !['REVENUE', 'OTHER_INCOME', 'DIRECT_COST', 'OPEX'].includes(cls);
    const bal = isBs && balance != null ? balance : 0;
    // The workbook shows balances in statement-side sign: positive on the asset side is a debit (accumulated depreciation is negative → credit),
    // positive on the liabilities & equity side is a credit.
    const debitSide = !['CURRENT_LIABILITY', 'ADVANCES_FROM', 'EQUITY'].includes(cls);
    const beginningDebit = debitSide ? Math.max(bal, 0) : Math.max(-bal, 0);
    const beginningCredit = debitSide ? Math.max(-bal, 0) : Math.max(bal, 0);
    const lower = title.toLowerCase();
    const paymentAccountType = cls !== 'CASH' ? null : /petty cash/.test(lower) ? 'PETTY_CASH' : /cash on hand/.test(lower) ? 'CASH_DRAWER' : /platform|shopee|lazada|tiktok/.test(lower) ? 'PLATFORM' : /gcash/.test(lower) ? 'GCASH' : /credit card/.test(lower) ? 'CREDIT_CARD_SETTLEMENT' : 'BANK';
    out.push({ code: code ?? caCodes.get(norm(title)) ?? null, title, section, class: cls, branchCode, channelTag: cls === 'REVENUE' ? parseChannelTag(title) : null, templateKey: matchTemplate(title, templates, locations), entryScope: entryScopeFor(cls, branchCode), isPaymentAccount: cls === 'CASH', paymentAccountType, beginningDebit: round2(beginningDebit), beginningCredit: round2(beginningCredit), balance: isBs ? balance : null });
  }
  return out;
}
/** Parse the `CA` sheet (col B code, col C title) into normalised title → code. */
export function parseCaCodes(grid: unknown[][]): Map<string, string> {
  const m = new Map<string, string>();
  for (const row of grid) { if (!row) continue; const code = String(row[2] ?? '').trim(); const title = String(row[3] ?? '').trim(); if (CODE_RE.test(code) && title) m.set(norm(title), code); }
  return m;
}
const round2 = (n: number) => Math.round(n * 100) / 100;
