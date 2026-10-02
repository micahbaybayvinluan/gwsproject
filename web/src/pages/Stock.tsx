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
  const slow = useQuery({ queryKey: ['slow', locationId], queryFn: () => api.get<{ product: { sku: string; name: string }; location: { name: string }; qty: number; days: number }[]>(`/api/alerts/slow-moving?days=60${locationId ? `&locationId=${locationId}` : ''}`) });
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Expiry & Low Stock</h1>{picker}</div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{exp.data?.summary.map((b) => <Stat key={b.bucket} label={BUCKET[b.bucket]} value={b.qty} sub={can('cost.view') && b.valueAtCost !== undefined ? `at cost ${peso(b.valueAtCost)}` : `at SRP ${peso(b.valueAtSrp)}`} tone={b.bucket === 'EXPIRED' && b.qty ? 'red' : undefined} />)}</div>
    <DaysOfStock locationId={locationId} />
    <Card title="Expiry report"><DataTable columnSearch exportName="ExpiryReport" data={exp.data?.items ?? []} columns={[{ header: 'Location', accessorFn: (r) => r.location.name }, { header: 'SKU', accessorFn: (r) => r.product.sku }, { header: 'Product', accessorFn: (r) => r.product.name }, { header: 'Batch', accessorKey: 'batchNo' }, { header: 'Expiry', accessorKey: 'expiryDate' }, { header: 'Bucket', accessorKey: 'bucket', cell: (c) => <Badge tone={c.getValue() === 'EXPIRED' ? 'red' : c.getValue() === 'LT_1M' ? 'amber' : 'slate'}>{BUCKET[String(c.getValue())]}</Badge> }, { header: 'Qty', accessorKey: 'qty' }, { header: can('cost.view') ? 'Value (cost)' : 'Value (SRP)', accessorFn: (r) => peso(can('cost.view') ? r.valueAtCost : r.valueAtSrp) }]} /></Card>
    <Card title="Critical stock / suggested restock"><DataTable columnSearch exportName="CriticalStock" data={crit.data ?? []} columns={[{ header: 'Location', accessorFn: (r) => r.location.name }, { header: 'SKU', accessorFn: (r) => r.product.sku }, { header: 'Product', accessorFn: (r) => r.product.name }, { header: 'On hand', accessorKey: 'onHand' }, { header: 'Min', accessorKey: 'minQty' }, { header: 'Short by', accessorKey: 'shortBy' }, { header: 'Warehouse available', accessorKey: 'warehouseAvailable' }]} /></Card>
    <Card title="Slow-moving (no sales in 60 days)"><DataTable columnSearch exportName="SlowMoving" data={slow.data ?? []} columns={[{ header: 'Location', accessorFn: (r) => r.location?.name }, { header: 'SKU', accessorFn: (r) => r.product?.sku }, { header: 'Product', accessorFn: (r) => r.product?.name }, { header: 'Qty', accessorKey: 'qty' }]} /></Card>
  </div>;
}

interface DaysRow { location: { id: string; name: string }; product: { sku: string; name: string; brand: string | null }; onHand: number; sold: number; avgPerDay: number; daysLeft: number | null; level: string; runsOutOn: string | null; suggestedQty: number; warehouseAvailable: number; asked: number }
const LEVEL: Record<string, { label: string; tone: 'red' | 'amber' | 'blue' | 'green' | 'slate' }> = { OUT: { label: 'Out', tone: 'red' }, CRITICAL: { label: 'Critical', tone: 'red' }, LOW: { label: 'Low', tone: 'amber' }, WATCH: { label: 'Watch', tone: 'blue' }, OK: { label: 'Enough', tone: 'green' }, NO_SALES: { label: 'No sales', tone: 'slate' } };

/** How many days each item will last at its average daily sales (owner request 2026-10-02): the most critical first, searchable per column. */
function DaysOfStock({ locationId }: { locationId: string }) {
  const [days, setDays] = useState('30'); const [cover, setCover] = useState('30'); const [combine, setCombine] = useState(false);
  const q = useQuery({ queryKey: ['days-of-stock', locationId, days, cover, combine], queryFn: () => api.get<{ days: number; cover: number; rows: DaysRow[]; counts: Record<string, number> }>(`/api/alerts/days-of-stock?days=${days}&cover=${cover}${locationId ? `&locationId=${locationId}` : ''}${combine ? '&combine=1' : ''}`) });
  const d = q.data;
  return <Card title="Days of stock left, by average sales (most critical first)">
    <div className="mb-3 flex flex-wrap items-end gap-3">
      <Field label="Average sales of the last"><Select value={days} onChange={(e) => setDays(e.target.value)}>{[['14', '14 days'], ['30', '30 days'], ['60', '60 days'], ['90', '90 days']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      <Field label="Restock to cover"><Select value={cover} onChange={(e) => setCover(e.target.value)}>{[['14', '14 days'], ['30', '30 days'], ['45', '45 days'], ['60', '60 days']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={combine} onChange={(e) => setCombine(e.target.checked)} /> All locations together (one line per item)</label>
    </div>
    {d && <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Out of stock, still selling" value={d.counts.OUT} tone={d.counts.OUT ? 'red' : undefined} /><Stat label="Critical: 7 days or less" value={d.counts.CRITICAL} tone={d.counts.CRITICAL ? 'red' : undefined} /><Stat label="Low: 8–14 days" value={d.counts.LOW} tone={d.counts.LOW ? 'amber' : undefined} /><Stat label="Watch: 15–30 days" value={d.counts.WATCH} /></div>}
    <ErrorBox error={q.error} />
    <DataTable columnSearch exportName="DaysOfStock" data={d?.rows ?? []} columns={[
      { header: 'SKU', accessorFn: (r) => r.product.sku }, { header: 'Product', accessorFn: (r) => r.product.name }, { header: 'Brand', accessorFn: (r) => r.product.brand ?? '' }, { header: 'Location', accessorFn: (r) => r.location.name },
      { header: 'On hand', accessorKey: 'onHand' }, { header: `Sold (${d?.days ?? days} days)`, accessorKey: 'sold' }, { header: 'Avg / day', accessorKey: 'avgPerDay' },
      { header: 'Days left', accessorFn: (r) => (r.daysLeft == null ? '' : String(r.daysLeft)), cell: (c) => { const r = c.row.original; return r.level === 'OUT' ? <b className="text-red-700">0</b> : r.daysLeft == null ? <span className="text-slate-400">—</span> : <b className={r.daysLeft <= 7 ? 'text-red-700' : r.daysLeft <= 14 ? 'text-amber-700' : ''}>{r.daysLeft}</b>; } },
      { header: 'Level', accessorFn: (r) => LEVEL[r.level]?.label ?? r.level, cell: (c) => { const l = LEVEL[c.row.original.level]; return <Badge tone={l?.tone ?? 'slate'}>{l?.label ?? c.row.original.level}</Badge>; } },
      { header: 'Runs out about', accessorFn: (r) => r.runsOutOn ?? '' }, { header: `Restock to cover ${d?.cover ?? cover} days`, accessorFn: (r) => (r.suggestedQty ? String(r.suggestedQty) : '') }, { header: 'Warehouse has', accessorKey: 'warehouseAvailable' }, { header: 'Customers asked (not available)', accessorFn: (r) => (r.asked ? String(r.asked) : ''), cell: (c) => (c.row.original.asked ? <b className="text-amber-700">{c.row.original.asked}</b> : '') },
    ]} />
    <p className="mt-2 text-xs text-slate-500">Days left = on hand ÷ average daily sales over the period (sales less returns; the warehouse also counts its e-commerce pull-outs). Levels: Out = no stock but still selling; Critical = 7 days or less; Low = 8–14; Watch = 15–30; Enough = over 30. Out comes first, then the fewest days left; items with stock and no sales are last. Per location, only sales recorded at that location count; tick “All locations together” for the company-wide days.</p>
  </Card>;
}
