import * as fs from 'node:fs';
import * as path from 'node:path';

/** One "## " section of docs/USER-GUIDE.md. `roles` holds the permission keys from its `<!-- for: … -->` line ('all' = everyone). */
export interface GuideSection { id: string; title: string; roles: string[] | 'all'; body: string; /** role keys from a `<!-- role: … -->` line (docs/ROLE-GUIDES.md) */ roleKeys?: string[] }
export interface Guide { intro: string; sections: GuideSection[] }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function parseGuide(md: string): Guide {
  const parts = md.split(/^## /m);
  const intro = parts.shift()!.replace(/^# .*\n/, '').trim();
  const sections = parts.map((p) => {
    const nl = p.indexOf('\n');
    const title = (nl < 0 ? p : p.slice(0, nl)).trim();
    let body = nl < 0 ? '' : p.slice(nl + 1);
    const m = body.match(/^\s*<!--\s*for:\s*([^>]*?)\s*-->\s*\n?/);
    let roles: string[] | 'all' = 'all';
    if (m) { const list = m[1].split(',').map((x) => x.trim()).filter(Boolean); roles = list.includes('all') ? 'all' : list; body = body.slice(m[0].length); }
    const r = body.match(/^\s*<!--\s*role:\s*([^>]*?)\s*-->\s*\n?/);
    let roleKeys: string[] | undefined;
    if (r) { roleKeys = r[1].split(',').map((x) => x.trim()).filter(Boolean); body = body.slice(r[0].length); }
    return { id: slug(title), title, roles, body: body.trim(), ...(roleKeys ? { roleKeys } : {}) };
  });
  return { intro, sections };
}

/** Sections a person may read: shared ones plus those matching any of their permissions. */
export function sectionsFor(guide: Guide, permissions: Set<string>): GuideSection[] {
  return guide.sections.filter((s) => s.roles === 'all' || s.roles.some((k) => permissions.has(k)));
}

const STOP = new Set(['the', 'and', 'for', 'how', 'can', 'what', 'where', 'when', 'who', 'does', 'with', 'from', 'into', 'this', 'that', 'there', 'have', 'has', 'are', 'you', 'your', 'our', 'mga', 'ang', 'paano', 'saan', 'ano', 'yung', 'lang', 'naman', 'please', 'system']);
const words = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]+/g) ?? [];

/** Keyword search: a hit in the title counts three times; a crude plural/stem match helps "sales" find "sale". */
export function searchSections(sections: GuideSection[], query: string, limit = 3): GuideSection[] {
  const terms = [...new Set(words(query).filter((w) => w.length >= 3 && !STOP.has(w)))];
  if (!terms.length) return [];
  const stem = (w: string) => (w.length > 4 ? w.replace(/(ing|ed|es|e|s)$/, '') : w);
  const docs = sections.map((s) => ({ s, t: words(s.title).map(stem), b: words(s.body).map(stem) }));
  // rare words (rider, deposit, payslip) count more than words found everywhere (sale, stock)
  const weight = (term: string) => Math.log(1 + docs.length / (1 + docs.filter((d) => d.t.some((w) => w.startsWith(term)) || d.b.some((w) => w.startsWith(term))).length));
  const scored = docs.map(({ s, t, b }) => {
    let score = 0;
    for (const term of terms.map(stem)) { const w = weight(term); score += w * (t.filter((x) => x.startsWith(term)).length * 3 + Math.min(5, b.filter((x) => x.startsWith(term)).length)); }
    return { s, score };
  });
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.s);
}

/** Finds docs/USER-GUIDE.md (or another file in docs/) from the source tree, the build output or HELP_GUIDE_PATH. */
export function loadGuideFile(name = 'USER-GUIDE.md'): string {
  const candidates = name === 'USER-GUIDE.md' ? [process.env.HELP_GUIDE_PATH].filter((x): x is string => !!x) : [];
  for (let dir = __dirname, i = 0; i < 6; i++, dir = path.dirname(dir)) candidates.push(path.join(dir, 'docs', name));
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`docs/${name} not found`);
  return fs.readFileSync(found, 'utf8');
}

/** The step-by-step guide(s) for one role from docs/ROLE-GUIDES.md. */
export function roleGuideFor(roleGuides: Guide, roleKey: string): GuideSection[] {
  return roleGuides.sections.filter((s) => s.roleKeys?.includes(roleKey));
}
