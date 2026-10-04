import ExcelJS from 'exceljs';
import { PROOF_KINDS, ProofItem, proofMeta } from './proofs';

/** The PROOFS sheet of an Excel report: legend, one row per proof (missing ones in red) and the picture beside each row, so Accounting checks without paper. */
export function addProofsSheet(wb: ExcelJS.Workbook, items: ProofItem[], images: Map<string, { buffer: Buffer; ext: 'png' | 'jpeg' }>, name = 'PROOFS') {
  const ws = wb.addWorksheet(name);
  ws.columns = [{ width: 8 }, { width: 20 }, { width: 18 }, { width: 24 }, { width: 14 }, { width: 24 }, { width: 22 }, { width: 14 }, { width: 12 }, { width: 18 }, { width: 28 }];
  ws.getCell('A1').value = 'PROOFS OF PAYMENT'; ws.getCell('A1').font = { bold: true, size: 13 };
  let r = 2;
  for (const k of PROOF_KINDS.filter((x) => items.some((i) => i.kind === x.kind))) {
    const c = ws.getCell(r, 1); c.value = k.code; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + k.color.slice(1).toUpperCase() } }; c.alignment = { horizontal: 'center' };
    ws.getCell(r, 2).value = k.label; ws.getCell(r, 4).value = k.what; r++;
  }
  const miss = items.filter((i) => i.missing).length;
  ws.getCell(r, 1).value = miss ? `${miss} of ${items.length} proofs are MISSING (red).` : `All ${items.length} proofs uploaded.`; ws.getCell(r, 1).font = { bold: true, color: { argb: miss ? 'FFB91C1C' : 'FF15803D' } }; r += 2;
  const head = ['Ref', 'Type', 'Document', 'Customer / for', 'How', 'Account', 'Reference', 'Amount', 'Date', 'Proof', 'Picture'];
  head.forEach((h, i) => { const c = ws.getCell(r, i + 1); c.value = h; c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE68A' } }; });
  r++;
  for (const i of items) {
    const m = proofMeta(i.kind); const img = i.attachmentId ? images.get(i.attachmentId) : undefined;
    const vals = [i.ref, i.kindLabel, i.docNo, i.party ?? '', i.mode, i.account ?? '', i.reference ?? '', i.amount, i.date, i.missing ? 'MISSING' : img ? 'picture →' : `file: ${i.fileName ?? ''}`];
    vals.forEach((v, ci) => { const c = ws.getCell(r, ci + 1); c.value = v as ExcelJS.CellValue; c.alignment = { vertical: 'top', wrapText: true }; if (ci === 7) c.numFmt = '#,##0.00;(#,##0.00);-'; });
    const ref = ws.getCell(r, 1); ref.font = { bold: true, color: { argb: 'FFFFFFFF' } }; ref.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i.missing ? 'FFB91C1C' : 'FF' + m.color.slice(1).toUpperCase() } };
    if (i.missing) ws.getCell(r, 10).font = { bold: true, color: { argb: 'FFB91C1C' } };
    if (img) { const id = wb.addImage({ buffer: img.buffer as never, extension: img.ext }); ws.addImage(id, { tl: { col: 10, row: r - 1 }, ext: { width: 190, height: 130 } }); ws.getRow(r).height = 100; }
    r++;
  }
  return ws;
}
