import ExcelJS from 'exceljs';

/** One product line of TIKTOK_SHOPEE_MASTERLIST_2026.xlsx: the platform prices are followed exactly as written (no markup, no rounding). */
export interface EcomMasterRow { name: string; category: string | null; srp: number | null; tiktok: number | null; shopee: number | null }

/** Same name, whatever the spacing, case or punctuation. */
export const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const num = (v: ExcelJS.CellValue): number | null => {
  const x = v && typeof v === 'object' && 'result' in v ? (v as { result: ExcelJS.CellValue }).result : v;
  if (x == null || x === '') return null;
  const n = typeof x === 'number' ? x : Number(String(x).replace(/[₱,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const txt = (v: ExcelJS.CellValue) => { const x = v && typeof v === 'object' && 'richText' in v ? (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('') : v; return x == null ? '' : String(x).trim(); };

/** Sheet 1: A product name, B category, E SRP, F TikTok price, G Shopee price. Brand heading rows (no prices) are skipped. */
export async function parseEcomMasterlist(buf: Buffer | Uint8Array): Promise<EcomMasterRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const head = (c: number) => txt(ws.getRow(1).getCell(c).value).toLowerCase();
  if (!head(6).startsWith('tiktok') || !head(7).startsWith('shopee')) throw new Error('This is not the TikTok / Shopee masterlist: column F should be the TikTok price and column G the Shopee price');
  const rows: EcomMasterRow[] = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const name = txt(row.getCell(1).value);
    const tiktok = num(row.getCell(6).value), shopee = num(row.getCell(7).value);
    if (!name || (tiktok == null && shopee == null)) return;
    rows.push({ name, category: txt(row.getCell(2).value) || null, srp: num(row.getCell(5).value), tiktok, shopee });
  });
  return rows;
}
