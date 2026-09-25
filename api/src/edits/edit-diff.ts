/** Human-readable change list between two document snapshots (header fields + per-product lines). Pure, unit-tested. */
export interface Snap { header: Record<string, string | number | null | undefined>; lines: ({ product: string } & Record<string, string | number | null | undefined>)[] }
const LABEL: Record<string, string> = { supplier: 'Supplier', supplierRef: 'Supplier ref', docDate: 'Date', notes: 'Notes', to: 'Transfer to', transferType: 'Type', returnReason: 'Return reason', qty: 'qty', freeQty: 'free', expiryDate: 'expiry', batchNo: 'batch', remarks: 'remarks' };
const show = (v: unknown) => (v === '' || v == null ? '—' : String(v));

export function describeChanges(before: Snap, after: Snap): string[] {
  const out: string[] = [];
  for (const k of new Set([...Object.keys(before.header), ...Object.keys(after.header)])) {
    if (k.endsWith('Id')) continue;
    if (show(before.header[k]) !== show(after.header[k])) out.push(`${LABEL[k] ?? k}: ${show(before.header[k])} → ${show(after.header[k])}`);
  }
  const key = (l: Snap['lines'][number]) => l.product;
  const b = new Map(before.lines.map((l) => [key(l), l])); const a = new Map(after.lines.map((l) => [key(l), l]));
  for (const [name, l] of a) {
    const old = b.get(name);
    if (!old) { out.push(`Added ${name}: ${Object.entries(l).filter(([k]) => k !== 'product' && k !== 'productId').map(([k, v]) => `${LABEL[k] ?? k} ${show(v)}`).join(', ')}`); continue; }
    const diffs = Object.keys(l).filter((k) => k !== 'product' && k !== 'productId' && show(l[k]) !== show(old[k])).map((k) => `${LABEL[k] ?? k} ${show(old[k])} → ${show(l[k])}`);
    if (diffs.length) out.push(`${name}: ${diffs.join(', ')}`);
  }
  for (const name of b.keys()) if (!a.has(name)) out.push(`Removed ${name}`);
  return out;
}
