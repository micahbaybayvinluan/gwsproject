/**
 * §10.1 Chart-of-accounts import helpers: parse messy branch/channel suffixes from account titles.
 * Pure functions (unit-tested); the import review screen lets Accounting Head confirm/override each tag.
 */
export interface KnownLocation { id: string; name: string; code: string; type: string }

const BRANCH_ALIASES: Record<string, string[]> = {
  WESTAVE: ['west ave', 'west ave.', 'westave', 'west avenue'],
  CSR: ['csr', 'csr ave'],
  IMUS: ['imus', 'imus cavite'],
  LAGUNA: ['laguna'],
  DASMA: ['dasma', 'dasmarinas', 'dasmariñas', 'dasmariñas'],
  VITOCRUZ: ['vito cruz', 'vitocruz'],
  WH: ['warehouse', 'wh', 'bodega'],
  OFFICE: ['office'],
  '711': ['7-11', '7-eleven', '711', 'lawson', '7-11/lawson'],
  MAYON: ['mayon'], MALOLOS: ['malolos', 'malolos bulacan'], PARANAQUE: ['paranaque', 'parañaque'], ISABELA: ['isabela'], BAGUIO: ['baguio'], PANGASINAN: ['pangasinan'], NAGA: ['naga'], BACOLOD: ['bacolod'], CALOOCAN: ['caloocan'], RIZAL: ['rizal'],
};
const CHANNEL_TAGS: [RegExp, string][] = [
  [/credit card walk[- ]?in/i, 'CREDIT_CARD_WALK_IN'], [/franchise/i, 'FRANCHISE'], [/dealers?/i, 'DEALER'], [/walk[- ]?in/i, 'WALK_IN'], [/delivery fee/i, 'DELIVERY_FEE'], [/delivery/i, 'DELIVERY'],
  [/shipping fee/i, 'SHIPPING_FEE'], [/shipping/i, 'SHIPPING_COURIER'], [/shopee/i, 'SHOPEE'], [/lazada/i, 'LAZADA'], [/tik ?tok/i, 'TIKTOK'], [/personal/i, 'PERSONAL'], [/consignment/i, 'CONSIGNMENT'], [/discount/i, 'DISCOUNT'], [/returns?/i, 'RETURNS'], [/agent/i, 'AGENT'], [/others?/i, 'OTHER'],
];

export function normalizeTitle(t: string) { return t.replace(/\s+/g, ' ').replace(/\s*[-–—]\s*/g, ' – ').trim(); }

/** Find a branch tag by scanning the title suffix / parenthetical for aliases. Returns location code or null. */
export function parseBranchTag(title: string, locations: KnownLocation[]): string | null {
  const t = title.toLowerCase().replace(/[()]/g, ' ').replace(/\s+/g, ' ');
  let best: { code: string; len: number } | null = null;
  for (const [code, aliases] of Object.entries(BRANCH_ALIASES)) {
    if (!locations.some((l) => l.code === code)) continue;
    for (const a of aliases) {
      const re = new RegExp(`(^|[\\s–\\-(])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$|\\)|\\.)`, 'i');
      if (re.test(t) && (!best || a.length > best.len)) best = { code, len: a.length };
    }
  }
  return best?.code ?? null;
}
export function parseChannelTag(title: string): string | null {
  if (!/^(sales|ar\b|accounts receivable)/i.test(title.trim()) && !/sales/i.test(title)) return null;
  for (const [re, tag] of CHANNEL_TAGS) if (re.test(title)) return tag;
  return null;
}
export function classFromSection(section: string, title: string): string {
  const s = section.toUpperCase(); const t = title.toLowerCase();
  if (s.includes('REVENUE')) return 'REVENUE';
  if (s.includes('DIRECT')) return 'DIRECT_COST';
  if (s.includes('OPERATING') || s.includes('OPEX')) return 'OPEX';
  if (s.includes('OTHER INCOME')) return 'OTHER_INCOME';
  if (/accumulated dep/.test(t)) return 'ACCUM_DEPN';
  if (/^(cash|petty cash|gcash|shopee|lazada|tiktok|bank)/.test(t) || /cash in bank|cash on hand|platform/.test(t)) return 'CASH';
  if (/^ar\b|receivable/.test(t)) return 'AR';
  if (/inventory/.test(t)) return 'INVENTORY';
  if (/advances to/.test(t)) return 'ADVANCES_TO';
  if (/advances from/.test(t)) return 'ADVANCES_FROM';
  if (/payable|output tax|loan/.test(t)) return 'CURRENT_LIABILITY';
  if (/capital|retained|drawing|equity/.test(t)) return 'EQUITY';
  if (/equipment|furniture|vehicle|improvement|fixed asset/.test(t)) return 'FIXED_ASSET';
  return s.includes('LIAB') ? 'CURRENT_LIABILITY' : 'FIXED_ASSET';
}
/** Match an imported title to a template key (so old and new branches behave identically). */
export function matchTemplate(title: string, templates: { key: string; titlePattern: string }[]): string | null {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z]/g, '');
  const t = norm(title.replace(/\(.*?\)/g, '').replace(/[-–—].*$/, ''));
  for (const tp of templates) { const base = norm(tp.titlePattern.replace('{branch}', '').replace(/\(.*?\)/g, '')); if (base && (t === base || t.startsWith(base))) return tp.key; }
  return null;
}
export function entryScopeFor(cls: string, branchTag: string | null): 'BRANCH' | 'MAIN' | 'BOTH' { return (cls === 'OPEX' || cls === 'DIRECT_COST') && branchTag ? 'BRANCH' : 'MAIN'; }
