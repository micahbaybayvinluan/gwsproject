/** Standalone exceljs readers shared by the API importers and the Prisma seed (no Nest dependencies). */
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import * as fs from 'node:fs/promises';

/**
 * Excel writes legacy VML drawings for cell comments; the owner's .xlsm files contain VML that exceljs' XML parser rejects
 * ("unexpected close tag"). Comments carry no data we need, so strip those parts (and their relationships) before loading.
 */
export async function sanitizeWorkbook(buf: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  const doomed = Object.keys(zip.files).filter((f) => /vmldrawing|xl\/comments|xl\/threadedcomments|xl\/persons/i.test(f));
  if (!doomed.length && !Object.keys(zip.files).some((f) => /vbaProject/i.test(f))) return buf;
  for (const f of doomed) zip.remove(f);
  for (const f of Object.keys(zip.files)) {
    if (/xl\/worksheets\/sheet\d+\.xml$/i.test(f)) { const xml = await zip.file(f)!.async('string'); zip.file(f, xml.replace(/<legacyDrawing[^>]*\/>/g, '').replace(/<legacyDrawingHF[^>]*\/>/g, '')); }
    if (/\.rels$/i.test(f)) { const xml = await zip.file(f)!.async('string'); zip.file(f, xml.replace(/<Relationship [^>]*(vmlDrawing|comments|threadedComments|persons)[^>]*\/>/gi, '')); }
    if (f === '[Content_Types].xml') { const xml = await zip.file(f)!.async('string'); zip.file(f, xml.replace(/<Override [^>]*(vmlDrawing|\/comments|threadedComments|persons)[^>]*\/>/gi, '')); }
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export async function loadWorkbook(source: string | Buffer): Promise<ExcelJS.Workbook> {
  const raw = typeof source === 'string' ? await fs.readFile(source) : source;
  try { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(raw as unknown as ArrayBuffer); return wb; }
  catch { const wb = new ExcelJS.Workbook(); await wb.xlsx.load((await sanitizeWorkbook(raw)) as unknown as ArrayBuffer); return wb; }
}
/** Raw cell grid: grid[row][col], both 1-based as exceljs yields them; formulas resolve to their cached result. */
export function gridOf(wb: ExcelJS.Workbook, sheetName: string): unknown[][] {
  const ws = wb.getWorksheet(sheetName) ?? wb.worksheets.find((w) => w.name.trim().toLowerCase() === sheetName.trim().toLowerCase()) ?? wb.worksheets.find((w) => w.name.toLowerCase().includes(sheetName.toLowerCase()));
  if (!ws) throw new Error(`Sheet ${sheetName} not found; available: ${wb.worksheets.map((w) => w.name).join(', ')}`);
  const out: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row, i) => { out[i] = (row.values as unknown[]).map(cellValue); });
  return out;
}
export function cellValue(v: unknown): unknown {
  if (v && typeof v === 'object') {
    if ('result' in (v as object)) return (v as { result: unknown }).result;
    if ('richText' in (v as object)) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('');
    if ('text' in (v as object)) return (v as { text: string }).text;
  }
  return v;
}
