import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, peso } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Field, Input, Select, Stat } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';

function useLocationPicker(defaultAll = true) {
  const { me } = useAuth(); const [sp] = useSearchParams();
  const [locationId, setLocationId] = useState(sp.get('locationId') ?? (me!.locationScoped ? me!.locations[0]?.id ?? '' : defaultAll ? '' : ''));
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; type: string }[]>('/api/locations') });
  const picker = <Field label="Location"><Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>{!me!.locationScoped && <option value="">All</option>}{locations.data?.filter((l) => !me!.locationScoped || me!.locations.some((x) => x.id === l.id)).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>;
  return { locationId, picker };
}

interface Soh { locationId: string; location: { name: string }; product: { sku: string; name: string; accountingClass: string }; batchNo: string | null; expiryDate: string | null; isConsignmentIn: boolean; qty: number; unitCost?: string; valueAtCost?: string }
export function StockPage() {
  const { can } = useAuth(); const { locationId, picker } = useLocationPicker(); const [search, setSearch] = useState('');
  const q = useQuery({ queryKey: ['soh', locationId, search], queryFn: () => api.get<Soh[]>(`/api/stock/on-hand?${locationId ? `locationId=${locationId}&` : ''}search=${encodeURIComponent(search)}`) });
  const wh = useQuery({ queryKey: ['wh-avail'], queryFn: () => api.get<{ productId: string; qty: number }[]>('/api/stock/warehouse-availability') });
  const grouped = Object.values((q.data ?? []).reduce<Record<string, { key: string; location: string; sku: string; name: string; qty: number; batches: number; nearest: string | null; value: number; expiries: Record<string, number> }>>((acc, r) => { const k = `${r.locationId}|${r.product.sku}`; const cur = acc[k] ?? { key: k, location: r.location.name, sku: r.product.sku, name: r.product.name, qty: 0, batches: 0, nearest: null, value: 0, expiries: {} }; cur.qty += r.qty; cur.batches++; const ek = r.expiryDate ?? 'no expiry'; cur.expiries[ek] = (cur.expiries[ek] ?? 0) + r.qty; if (r.expiryDate && (!cur.nearest || r.expiryDate < cur.nearest)) cur.nearest = r.expiryDate; cur.value += Number(r.valueAtCost ?? 0); acc[k] = cur; return acc; }, {}));
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Stock on Hand (Current Inventory)</h1>{picker}<Field label="Search"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="name / SKU" /></Field><Button variant="outline" onClick={() => api.download(`/api/reports/stock-on-hand.xlsx${locationId ? `?locationId=${locationId}` : ''}`, 'StockOnHand.xlsx')}>Export xlsx</Button></div>
    <DataTable data={grouped} columns={[{ header: 'Location', accessorKey: 'location' }, { header: 'SKU', accessorKey: 'sku' }, { header: 'Product', accessorKey: 'name' }, { header: 'On hand', accessorKey: 'qty', cell: (c) => <span className="num block font-medium">{String(c.getValue())}</span> }, { header: 'Nearest expiry', accessorKey: 'nearest' }, { header: 'Qty per expiry date', id: 'expiries', accessorFn: (r) => Object.entries(r.expiries).sort().map(([e, n]) => `${e}: ${n}`).join(' | '), cell: (c) => { const e = Object.entries(c.row.original.expiries).sort(); return <span className="flex flex-wrap gap-1">{e.map(([d, n], i) => <span key={d} className={`rounded px-1 text-xs ${e.length > 1 && i === 0 ? 'bg-amber-100 text-amber-900' : 'bg-slate-100'}`}>{d}: {n}</span>)}{e.length > 1 && <Badge tone="amber">{e.length} dates</Badge>}</span>; } }, ...(can('cost.view') ? [{ header: 'Value at cost', accessorKey: 'value', cell: (c: { getValue: () => unknown }) => <span className="num block">{peso(c.getValue())}</span> }] : [])]} />
    <Card title="Batches (FEFO order)"><DataTable exportName="StockBatches" data={q.data ?? []} columns={[{ header: 'Location', accessorFn: (r) => r.location.name }, { header: 'Product', accessorFn: (r) => r.product.name }, { header: 'Batch', accessorKey: 'batchNo' }, { header: 'Expiry', accessorKey: 'expiryDate' }, { header: 'Qty', accessorKey: 'qty', cell: (c) => <span className="num block">{String(c.getValue())}</span> }, { header: '', cell: (c) => c.row.original.isConsignmentIn ? <Badge tone="purple">consignment-in</Badge> : null }]} /></Card>
    {wh.data && <p className="text-xs text-slate-500">Warehouse availability (qty only) is used when requesting transfers: {wh.data.length} products in stock.</p>}
  </div>;
}

const BUCKET: Record<string, string> = { EXPIRED: 'Expired', LT_1M: '< 1 month', M1_3: '1–3 months', M3_6: '3–6 months' };
export function ExpiryPage() {
  const { can } = useAuth(); const { locationId, picker } = useLocationPicker();
  const exp = useQuery({ queryKey: ['expiring', locationId], queryFn: () => api.get<{ summary: { bucket: string; qty: number; valueAtCost?: string; valueAtSrp: string }[]; items: { location: { name: string }; product: { sku: string; name: string }; batchNo: string | null; expiryDate: string; bucket: string; qty: number; valueAtSrp: string; valueAtCost?: string }[] }>(`/api/alerts/expiring${locationId ? `?locationId=${locationId}` : ''}`) });
  const crit = useQuery({ queryKey: ['critical', locationId], queryFn: () => api.get<{ location: { name: string }; product: { sku: string; name: string }; minQty: number; onHand: number; shortBy: number; warehouseAvailable: number }[]>(`/api/alerts/critical-stock${locationId ? `?locationId=${locationId}` : ''}`) });
  const slow = useQuery({ queryKey: ['slow', locationId], queryFn: () => api.get<{ product: { name: string }; location: { name: string }; qty: number; days: number }[]>(`/api/alerts/slow-moving?days=60${locationId ? `&locationId=${locationId}` : ''}`) });
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Expiry, Low Stock & Alerts</h1>{picker}</div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{exp.data?.summary.map((b) => <Stat key={b.bucket} label={BUCKET[b.bucket]} value={b.qty} sub={can('cost.view') && b.valueAtCost !== undefined ? `at cost ${peso(b.valueAtCost)}` : `at SRP ${peso(b.valueAtSrp)}`} tone={b.bucket === 'EXPIRED' && b.qty ? 'red' : undefined} />)}</div>
    <Card title="Expiry report"><DataTable exportName="ExpiryReport" data={exp.data?.items ?? []} columns={[{ header: 'Location', accessorFn: (r) => r.location.name }, { header: 'Product', accessorFn: (r) => r.product.name }, { header: 'Batch', accessorKey: 'batchNo' }, { header: 'Expiry', accessorKey: 'expiryDate' }, { header: 'Bucket', accessorKey: 'bucket', cell: (c) => <Badge tone={c.getValue() === 'EXPIRED' ? 'red' : c.getValue() === 'LT_1M' ? 'amber' : 'slate'}>{BUCKET[String(c.getValue())]}</Badge> }, { header: 'Qty', accessorKey: 'qty' }, { header: can('cost.view') ? 'Value (cost)' : 'Value (SRP)', accessorFn: (r) => peso(can('cost.view') ? r.valueAtCost : r.valueAtSrp) }]} /></Card>
    <Card title="Critical stock / suggested restock"><DataTable exportName="CriticalStock" data={crit.data ?? []} columns={[{ header: 'Location', accessorFn: (r) => r.location.name }, { header: 'Product', accessorFn: (r) => r.product.name }, { header: 'On hand', accessorKey: 'onHand' }, { header: 'Min', accessorKey: 'minQty' }, { header: 'Short by', accessorKey: 'shortBy' }, { header: 'Warehouse available', accessorKey: 'warehouseAvailable' }]} /></Card>
    <Card title="Slow-moving (no sales in 60 days)"><DataTable exportName="SlowMoving" data={slow.data ?? []} columns={[{ header: 'Location', accessorFn: (r) => r.location?.name }, { header: 'Product', accessorFn: (r) => r.product?.name }, { header: 'Qty', accessorKey: 'qty' }]} /></Card>
  </div>;
}
