/**
 * Reading shipping labels (waybills) of TikTok Shop, Shopee and Lazada (owner request 2026-09-30). A label carries the order number, the tracking number,
 * the quantity and the weight, but not the product or the price, so the report asks for the product once per label (remembered by platform and weight).
 * Buyer names and addresses on the label are never kept.
 */
export interface Waybill { platform: 'TIKTOK' | 'SHOPEE' | 'LAZADA' | 'UNKNOWN'; orderId: string; trackingNo: string | null; qty: number; weightG: number | null; rtsDate: string | null }

/** Text of one label page as lines (items grouped by their height on the page, left to right). */
export function pageLines(items: { str: string; transform: number[] }[]): string[] {
  const rows = new Map<number, [number, string][]>();
  for (const it of items) { if (!it.str?.trim() && it.str !== ' ') continue; const y = Math.round(it.transform[5] / 3); (rows.get(y) ?? rows.set(y, []).get(y)!).push([it.transform[4], it.str]); }
  return [...rows.keys()].sort((a, b) => b - a).map((y) => rows.get(y)!.sort((a, b) => a[0] - b[0]).map((x) => x[1]).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
}
/** Some labels print letters and digits spaced apart ("5 8 6 0 2 4"): rejoin them. */
const squash = (s: string) => s.replace(/\s+/g, '');

export function parseWaybill(lines: string[]): Waybill | null {
  const text = lines.join('\n');
  let platform: Waybill['platform'] = 'UNKNOWN'; let orderId = ''; let trackingNo: string | null = null;
  // TikTok Shop: "TT Order ID: 5860243575340738873", J&T / Flash / other courier tracking
  const tt = /TT\s*Order\s*ID\s*:?\s*([\d\s]{12,40})/i.exec(text);
  if (tt) { platform = 'TIKTOK'; orderId = squash(tt[1]).match(/\d{12,25}/)?.[0] ?? ''; }
  // Lazada
  if (!platform || platform === 'UNKNOWN') { if (/lazada|LEX\b|\bLZD/i.test(text)) platform = 'LAZADA'; }
  // Shopee: order sn like 2609057S9U6WH6 and an SPX / Flash tracking like PH2620256392738
  const shopeeSn = /\b(\d{6}[0-9A-Z]{6,10})\b/.exec(text.replace(/[^\S\n]+/g, ' '));
  if (platform === 'UNKNOWN' && (/Sort\s*Code|SPX|Shopee|Order ID/i.test(text) && shopeeSn)) { platform = 'SHOPEE'; orderId = shopeeSn[1]; }
  if (platform === 'LAZADA' && !orderId) orderId = /\b(\d{12,16})\b/.exec(text)?.[1] ?? '';
  // tracking number
  const trk = /\b(JT\d{10,}|SPXPH\d{8,}|PH\d{10,}|LBC\d{8,}|FE\d{9,}|LEX[A-Z0-9]{8,}|NLPH[A-Z0-9]{8,}|LZ[A-Z0-9]{10,})\b/.exec(text.replace(/\s+/g, ' '));
  trackingNo = trk?.[1] ?? null;
  if (!orderId && trackingNo) orderId = trackingNo;
  if (!orderId) return null;
  const q = /Product\s*Quantity\s*:?\s*(\d{1,4})/i.exec(text) ?? /\bQty\s*:?\s*(\d{1,4})/i.exec(text) ?? /Quantity\s*:?\s*(\d{1,4})/i.exec(text);
  const w = /Weight\s*:?\s*\n?\s*([\d.]+)\s*(kg|g)\b/i.exec(text) ?? /([\d.]+)\s*(kg|g)\b/i.exec(text.replace(/\n/g, ' '));
  const weightG = w ? Math.round(Number(w[1]) * (w[2].toLowerCase() === 'kg' ? 1000 : 1)) : null;
  const rts = /RTS\s*Time\s*:?\s*(\d{4}-\d{2}-\d{2})/i.exec(text);
  return { platform, orderId, trackingNo, qty: q ? Math.max(1, Number(q[1])) : 1, weightG, rtsDate: rts?.[1] ?? null };
}

/** Every label page of a PDF (pdf.js 3, the build that loads from this CommonJS app). */
export async function readWaybills(buf: Buffer): Promise<{ waybills: Waybill[]; unreadable: number[] }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js') as { getDocument: (o: object) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }> }> } };
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false, disableFontFace: true }).promise;
  const waybills: Waybill[] = []; const unreadable: number[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i); const tc = await page.getTextContent();
    const wb = parseWaybill(pageLines(tc.items as { str: string; transform: number[] }[]));
    if (wb) waybills.push(wb); else unreadable.push(i);
  }
  return { waybills, unreadable };
}
