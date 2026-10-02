/** Words that say nothing about which product it is. */
const NOISE = new Set(['getwheysted', 'official', 'store', 'fitness', 'supplements', 'supplement', 'good', 'stock', 'creamy', 'free', 'shipping', 'the', 'and', 'with', 'of', 'a', 'pcs', 'pc']);

/** "10 Servings" → "10s", "5 lbs" → "5lbs", then words. */
export function matchTokens(text: string): string[] {
  const t = text.toLowerCase().replace(/(\d+(?:\.\d+)?)\s*(?:servings?|serv|srv|s)\b/g, '$1s').replace(/(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?)\b/g, '$1lbs').replace(/(\d+)\s*(?:tablets?|tabs?)\b/g, '$1tabs').replace(/(\d+)\s*(?:capsules?|caps)\b/g, '$1caps').replace(/(\d+)\s*(?:softgels?)\b/g, '$1softgels');
  return t.split(/[^a-z0-9.]+/).map((w) => w.replace(/^\.+|\.+$/g, '')).filter((w) => w && !NOISE.has(w));
}

export interface MatchProduct { id: string; sku: string; name: string }
/**
 * The GWS products that look like a platform listing (product title + variation): every word of the GWS name (flavor in brackets, the size "10s", "5lbs") has to be found in the listing.
 * Best first; only products with most of their words found are offered, and they are only suggestions: the person confirms.
 */
export function suggestProducts(platformText: string, products: MatchProduct[], max = 3): (MatchProduct & { score: number })[] {
  const have = new Set(matchTokens(platformText));
  const out: (MatchProduct & { score: number; hit: number })[] = [];
  for (const p of products) {
    const want = matchTokens(p.name); if (want.length < 2) continue;
    // the first word of the GWS name (the line: Prothin, Core, C4…) and the flavor in brackets must be in the listing
    const flavor = /\(([^)]*)\)/.exec(p.name); const flavorWords = flavor ? matchTokens(flavor[1]) : [];
    if (!have.has(want[0]) || flavorWords.some((w) => !have.has(w))) continue;
    const hit = want.filter((w) => have.has(w)).length; const score = hit / want.length;
    // a size / count in the GWS name that the listing does not have means another pack: never suggested
    if (want.some((w) => /^\d/.test(w) && !have.has(w))) continue;
    if (score >= 0.8) out.push({ ...p, score: Math.round(score * 100) / 100, hit });
  }
  // the more specific product first: more of its words found, then the better fraction
  return out.sort((a, b) => b.hit - a.hit || b.score - a.score || a.name.length - b.name.length).slice(0, max).map(({ hit: _h, ...rest }) => rest);
}
