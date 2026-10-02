import { locLabel } from '@/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, peso } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, Select, Stat } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';

function useLocationPicker(defaultAll = true) {
  const { me } = useAuth(); const [sp] = useSearchParams();
  const [locationId, setLocationId] = useState(sp.get('locationId') ?? (me!.locationScoped ? me!.locations[0]?.id ?? '' : defaultAll ? '' : ''));
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; type: string }[]>('/api/locations') });
  const picker = <Field label="Location"><Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>{!me!.locationScoped && <option value="">All</option>}{locations.data?.filter((l) => !me!.locationScoped || me!.locations.some((x) => x.id === l.id)).map((l) => <option key={l.id} value={l.id}>{locLabel(l)}</option>)}</Select></Field>;
  return { locationId, picker };
}

interface Soh { locationId: string; batchId: string; flavor?: string | null; location: { name: string }; product: { sku: string; name: string; accountingClass: string }; batchNo: string | null; expiryDate: string | null; isConsignmentIn: boolean; qty: number; unitCost?: string; valueAtCost?: string }
export function StockPage() {
  const { can } = useAuth(); const { locationId, picker } = useLocationPicker(); const [search, setSearch] = useState(''); const [flavorRow, setFlavorRow] = useState<Soh | null>(null);
  const q = useQuery({ queryKey: ['soh', locationId, search], queryFn: () => api.get<Soh[]>(`/api/stock/on-hand?${locationId ? `locationId=${locationId}&` : ''}search=${encodeURIComponent(search)}`) });
  const wh = useQuery({ queryKey: ['wh-avail'], queryFn: () => api.get<{ productId: string; qty: number }[]>('/api/stock/warehouse-availability') });
  const grouped = Object.values((q.data ?? []).reduce<Record<string, { key: string; location: string; sku: string; name: string; qty: number; batches: number; nearest: string | null; value: number; expiries: Record<string, number>; flavors: Record<string, number> }>>((acc, r) => { const k = `${r.locationId}|${r.product.sku}`; const cur = acc[k] ?? { key: k, location: r.location.name, sku: r.product.sku, name: r.product.name, qty: 0, batches: 0, nearest: null, value: 0, expiries: {}, flavors: {} }; cur.qty += r.qty; const fk = r.flavor || 'no flavor set'; cur.flavors[fk] = (cur.flavors[fk] ?? 0) + r.qty; cur.batches++; const ek = r.expiryDate ?? 'no expiry'; cur.expiries[ek] = (cur.expiries[ek] ?? 0) + r.qty; if (r.expiryDate && (!cur.nearest || r.expiryDate < cur.nearest)) cur.nearest = r.expiryDate; cur.value += Number(r.valueAtCost ?? 0); acc[k] = cur; return acc; }, {}));
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Stock on Hand</h1>{picker}<Field label="Search"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="name / SKU" /></Field><Button variant="outline" onClick={() => api.download(`/api/reports/stock-on-hand.xlsx${locationId ? `?locationId=${locationId}` : ''}`, 'StockOnHand.xlsx')}>Export xlsx</Button></div>
    <DataTable search={false} data={grouped} columns={[{ header: 'Location', accessorKey: 'location' }, { header: 'SKU', accessorKey: 'sku' }, { header: 'Product', accessorKey: 'name' }, { header: 'On hand', accessorKey: 'qty', cell: (c) => <span className="num block font-medium">{String(c.getValue())}</span> }, { header: 'Flavors', id: 'flavors', accessorFn: (r) => Object.entries(r.flavors).map(([f, n]) => `${f}: ${n}`).join(' | '), cell: (c) => { const e = Object.entries(c.row.original.flavors); return e.length === 1 && e[0][0] === 'no flavor set' ? <span className="text-xs text-slate-400">—</span> : <span className="flex flex-wrap gap-1">{e.map(([f, n]) => <Badge key={f} tone={f === 'no flavor set' ? 'slate' : 'purple'}>{f}: {n}</Badge>)}</span>; } }, { header: 'Nearest expiry', accessorKey: 'nearest' }, { header: 'Qty per expiry date', id: 'expiries', accessorFn: (r) => Object.entries(r.expiries).sort().map(([e, n]) => `${e}: ${n}`).join(' | '), cell: (c) => { const e = Object.entries(c.row.original.expiries).sort(); return <span className="flex flex-wrap gap-1">{e.map(([d, n], i) => <span key={d} className={`rounded px-1 text-xs ${e.length > 1 && i === 0 ? 'bg-amber-100 text-amber-900' : 'bg-slate-100'}`}>{d}: {n}</span>)}{e.length > 1 && <Badge tone="amber">{e.length} dates</Badge>}</span>; } }, ...(can('cost.view') ? [{ header: 'Value at cost', accessorKey: 'value', cell: (c: { getValue: () => unknown }) => <span className="num block">{peso(c.getValue())}</span> }] : [])]} />
    <Card title="Batches (FEFO order)"><DataTable search={false} exportName="StockBatches" data={q.data ?? []} columns={[{ header: 'Location', accessorFn: (r) => r.location.name }, { header: 'Product', accessorFn: (r) => r.product.name }, { header: 'Flavor', accessorFn: (r) => r.flavor ?? '' }, { header: 'Batch', accessorKey: 'batchNo' }, { header: 'Expiry', accessorKey: 'expiryDate' }, { header: 'Qty', accessorKey: 'qty', cell: (c) => <span className="num block">{String(c.getValue())}</span> }, { header: '', id: 'act', cell: (c) => <span className="flex items-center gap-2">{c.row.original.isConsignmentIn ? <Badge tone="purple">consignment-in</Badge> : null}{can('stock.flavor.set') && <Button size="sm" variant="outline" onClick={() => setFlavorRow(c.row.original)}>{c.row.original.flavor ? 'Change flavor' : 'Set flavors'}</Button>}</span> }]} /></Card>
    {flavorRow && <SetFlavors row={flavorRow} onClose={() => setFlavorRow(null)} />}
    {wh.data && <p className="text-xs text-slate-500">Warehouse availability (qty only) is used when requesting transfers: {wh.data.length} products in stock.</p>}
  </div>;
}

/** Set the flavor of stock that has none, or correct it (owner request 2026-09-30): the SKU's total stays the same. */
function SetFlavors({ row, onClose }: { row: Soh; onClose: () => void }) {
  const qc = useQueryClient();
  const [parts, setParts] = useState<{ flavor: string; qty: string }[]>([{ flavor: '', qty: String(row.qty) }]);
  const total = parts.reduce((t, p) => t + (Number(p.qty) || 0), 0);
  const m = useMutation({ mutationFn: () => api.post('/api/stock/flavors', { locationId: row.locationId, batchId: row.batchId, parts: parts.filter((p) => p.flavor.trim() && Number(p.qty) > 0).map((p) => ({ flavor: p.flavor.trim(), qty: Number(p.qty) })) }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['soh'] }); onClose(); } });
  return <Modal title={`Flavors of ${row.product.name}`} onClose={onClose}>
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">{row.location.name} · {row.expiryDate ? `exp ${row.expiryDate}` : 'no expiry'}{row.batchNo ? ` · batch ${row.batchNo}` : ''} · <b>{row.qty}</b> on hand{row.flavor ? ` · now “${row.flavor}”` : ' · no flavor set'}</p>
      <p className="text-xs text-slate-500">Split the quantity by flavor. Anything not given a flavor stays as it is. The item is still counted as one SKU and its total does not change.</p>
      {parts.map((p, i) => <div key={i} className="flex items-center gap-2"><Input placeholder="Flavor (e.g. Choco)" value={p.flavor} onChange={(e) => setParts(parts.map((x, k) => (k === i ? { ...x, flavor: e.target.value } : x)))} /><Input type="number" min={1} className="w-24" value={p.qty} onChange={(e) => setParts(parts.map((x, k) => (k === i ? { ...x, qty: e.target.value } : x)))} />{parts.length > 1 && <button className="text-red-600" onClick={() => setParts(parts.filter((_, k) => k !== i))}>✕</button>}</div>)}
      <button type="button" className="text-xs text-brand underline" onClick={() => setParts([...parts, { flavor: '', qty: '' }])}>+ another flavor</button>
      <div className={total > row.qty ? 'text-red-700' : 'text-slate-600'}>Total {total} of {row.qty}{total < row.qty ? ` · ${row.qty - total} stay without a flavor` : ''}</div>
      <ErrorBox error={m.error} />
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={m.isPending || total > row.qty || !parts.some((p) => p.flavor.trim() && Number(p.qty) > 0)} onClick={() => m.mutate()}>Save flavors</Button></div>
    </div>
  </Modal>;
}

const BUCKET: Record<string, string> = { EXPIRED: 'Expired', LT_1M: '< 1 month', M1_3: '1–3 months', M3_6: '3–6 months' };
export function ExpiryPage() {
  const { can } = useAuth(); const { locationId, picker } = useLocationPicker();
  const exp = useQuery({ queryKey: ['expiring', locationId], queryFn: () => api.get<{ summary: { bucket: string; qty: number; valueAtCost?: string; valueAtSrp: string }[]; items: { location: { name: string }; product: { sku: string; name: string }; batchNo: string | null; expiryDate: string; bucket: string; qty: number; valueAtSrp: string; valueAtCost?: string }[] }>(`/api/alerts/expiring${locationId ? `?locationId=${locationId}` : ''}`) });
  const crit = useQuery({ queryKey: ['critical', locationId], queryFn: () => api.get<{ location: { name: string }; product: { sku: string; name: string }; minQty: number; onHand: number; shortBy: number; warehouseAvailable: number }[]>(`/api/alerts/critical-stock${locationId ? `?locationId=${locationId}` : ''}`) });
  const slow = useQuery({ queryKey: ['slow', locationId], queryFn: () => api.get<{ product: { name: string }; location: { name: string }; qty: number; days: number }[]>(`/api/alerts/slow-moving?days=60${locationId ? `&locationId=${locationId}` : ''}`) });
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Expiry & Low Stock</h1>{picker}</div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{exp.data?.summary.map((b) => <Stat key={b.bucket} label={BUCKET[b.bucket]} value={b.qty} sub={can('cost.view') && b.valueAtCost !== undefined ? `at cost ${peso(b.valueAtCost)}` : `at SRP ${peso(b.valueAtSrp)}`} tone={b.bucket === 'EXPIRED' && b.qty ? 'red' : undefined} />)}</div>
    <Card title="Expiry report"><DataTable search={false} exportName="ExpiryReport" data={exp.data?.items ?? []} columns={[{ header: 'Location', accessorFn: (r) => r.location.name }, { header: 'Product', accessorFn: (r) => r.product.name }, { header: 'Batch', accessorKey: 'batchNo' }, { header: 'Expiry', accessorKey: 'expiryDate' }, { header: 'Bucket', accessorKey: 'bucket', cell: (c) => <Badge tone={c.getValue() === 'EXPIRED' ? 'red' : c.getValue() === 'LT_1M' ? 'amber' : 'slate'}>{BUCKET[String(c.getValue())]}</Badge> }, { header: 'Qty', accessorKey: 'qty' }, { header: can('cost.view') ? 'Value (cost)' : 'Value (SRP)', accessorFn: (r) => peso(can('cost.view') ? r.valueAtCost : r.valueAtSrp) }]} /></Card>
    <Card title="Critical stock / suggested restock"><DataTable search={false} exportName="CriticalStock" data={crit.data ?? []} columns={[{ header: 'Location', accessorFn: (r) => r.location.name }, { header: 'Product', accessorFn: (r) => r.product.name }, { header: 'On hand', accessorKey: 'onHand' }, { header: 'Min', accessorKey: 'minQty' }, { header: 'Short by', accessorKey: 'shortBy' }, { header: 'Warehouse available', accessorKey: 'warehouseAvailable' }]} /></Card>
    <Card title="Slow-moving (no sales in 60 days)"><DataTable search={false} exportName="SlowMoving" data={slow.data ?? []} columns={[{ header: 'Location', accessorFn: (r) => r.location?.name }, { header: 'Product', accessorFn: (r) => r.product?.name }, { header: 'Qty', accessorKey: 'qty' }]} /></Card>
  </div>;
}
