import { PendingMaster, pendingMessage } from '@/components/PendingMaster';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, fmtDate, peso } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Field, Input, Select, statusTone } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';

interface Product { id: string; sku: string; barcode: string | null; name: string; brand: string | null; unit: string; trackExpiry: boolean; active: boolean; isBundle: boolean; franchiseVisible: boolean; needsReview: boolean; category: { id: string; name: string; accountingClass: string }; supplier: { code: string; name?: string } | null; tierPrices: Record<string, string>; cost?: string | null }

export function ProductsPage() {
  const nav = useNavigate(); const { can } = useAuth(); const qc = useQueryClient();
  const [search, setSearch] = useState(''); const [all, setAll] = useState(false);
  const q = useQuery({ queryKey: ['products-list', search, all], queryFn: () => api.get<Product[]>(`/api/products?search=${encodeURIComponent(search)}${all ? '&all=1' : ''}&take=1000`) });
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/categories') });
  const tiers = useQuery({ queryKey: ['tiers'], queryFn: () => api.get<{ key: string; name: string }[]>('/api/products/tiers') });
  const [f, setF] = useState({ name: '', categoryId: '', brand: '', unit: 'pc', trackExpiry: true, franchiseVisible: true, prices: {} as Record<string, string>, cost: '' });
  const [sent, setSent] = useState('');
  const m = useMutation({ mutationFn: () => api.post('/api/products', { ...f, prices: Object.fromEntries(Object.entries(f.prices).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])), cost: f.cost ? Number(f.cost) : undefined }), onSuccess: (r) => { setSent(pendingMessage(r)); setF({ ...f, name: '', prices: {}, cost: '' }); void qc.invalidateQueries({ queryKey: ['products-list'] }); void qc.invalidateQueries({ queryKey: ['master-pending'] }); } });
  const visibleTiers = (tiers.data ?? []).filter((t) => can(`price.view.${t.key}`));
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-xl font-semibold">Products</h1><Field label="Search"><Input value={search} onChange={(e) => setSearch(e.target.value)} /></Field><label className="flex items-center gap-1 pb-2 text-sm"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> include inactive</label></div>
    {can('product.create') && <Card title="New product">
      <div className="grid gap-3 md:grid-cols-4"><Field label="Name" className="md:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><Field label="Category"><Select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">—</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field><Field label="Brand"><Input value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} /></Field>
        {visibleTiers.map((t) => <Field key={t.key} label={`${t.name} price`}><Input type="number" step="0.01" value={f.prices[t.key] ?? ''} onChange={(e) => setF({ ...f, prices: { ...f.prices, [t.key]: e.target.value } })} /></Field>)}
        {can('cost.edit') && <Field label="Standard cost"><Input type="number" step="0.01" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></Field>}
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.trackExpiry} onChange={(e) => setF({ ...f, trackExpiry: e.target.checked })} /> Track expiry</label><label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.franchiseVisible} onChange={(e) => setF({ ...f, franchiseVisible: e.target.checked })} /> Visible to franchises</label></div>
      <Button className="mt-3" disabled={!f.name || !f.categoryId} onClick={() => m.mutate()}>Create</Button>{sent && <p className="mt-2 text-sm text-amber-700">{sent}</p>}<ErrorBox error={m.error} /></Card>}
    <PendingMaster kind="Product" label="New products" />
    <DataTable exportName="Products" data={q.data ?? []} onRowClick={(r) => nav(`/products/${r.id}`)} columns={[{ header: 'SKU', accessorKey: 'sku' }, { header: 'Name', accessorKey: 'name', cell: (c) => <>{String(c.getValue())}{c.row.original.needsReview && <Badge tone="amber">review</Badge>}{!c.row.original.active && <Badge tone="red">inactive</Badge>}</> }, { header: 'Category', accessorFn: (r) => r.category.name }, ...visibleTiers.map((t) => ({ header: t.name, accessorFn: (r: Product) => r.tierPrices[t.key], cell: (c: { getValue: () => unknown }) => <span className="num block">{c.getValue() != null ? peso(c.getValue()) : '—'}</span> })), ...(can('cost.view') ? [{ header: 'Cost', accessorKey: 'cost', cell: (c: { getValue: () => unknown }) => <span className="num block">{c.getValue() != null ? peso(c.getValue()) : '—'}</span> }] : []), { header: 'Supplier', accessorFn: (r) => (r.supplier ? r.supplier.name ? `${r.supplier.code} — ${r.supplier.name}` : r.supplier.code : '') }]} />
  </div>;
}

export function ProductDetailPage() {
  const { id } = useParams(); const { can } = useAuth(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['product', id], queryFn: () => api.get<Product & { priceHistory: { tier: string; price: string; effectiveFrom: string; approvedBy: string | null }[]; costHistory?: { cost: string; effectiveFrom: string }[] }>(`/api/products/${id}`) });
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/categories') });
  const [patch, setPatch] = useState<Record<string, unknown>>({});
  const m = useMutation({ mutationFn: () => api.patch(`/api/products/${id}`, patch), onSuccess: () => { setPatch({}); void qc.invalidateQueries({ queryKey: ['product', id] }); } });
  const p = q.data; if (!p) return null;
  return <div className="mx-auto max-w-4xl space-y-4">
    <h1 className="text-xl font-semibold">{p.name} <span className="text-base text-slate-500">{p.sku}</span></h1>
    <Card title="Master data" actions={can('product.edit') && <Button size="sm" disabled={!Object.keys(patch).length} onClick={() => m.mutate()}>Save</Button>}>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Name"><Input defaultValue={p.name} disabled={!can('product.edit')} onChange={(e) => setPatch({ ...patch, name: e.target.value })} /></Field>
        <Field label="Category"><Select defaultValue={p.category.id} disabled={!can('product.edit')} onChange={(e) => setPatch({ ...patch, categoryId: e.target.value })}>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Barcode"><Input defaultValue={p.barcode ?? ''} disabled={!can('product.edit')} onChange={(e) => setPatch({ ...patch, barcode: e.target.value || null })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" defaultChecked={p.trackExpiry} disabled={!can('product.edit')} onChange={(e) => setPatch({ ...patch, trackExpiry: e.target.checked })} /> Track expiry</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" defaultChecked={p.franchiseVisible} disabled={!can('product.edit')} onChange={(e) => setPatch({ ...patch, franchiseVisible: e.target.checked })} /> Franchise visible</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" defaultChecked={p.active} disabled={!can('product.edit')} onChange={(e) => setPatch({ ...patch, active: e.target.checked })} /> Active</label>
        {p.needsReview && can('product.edit') && <label className="flex items-center gap-2 text-sm"><input type="checkbox" onChange={(e) => setPatch({ ...patch, needsReview: !e.target.checked })} /> Reviewed (clear import flag)</label>}
      </div><ErrorBox error={m.error} />
    </Card>
    <Card title="Prices in effect"><div className="flex flex-wrap gap-3">{Object.entries(p.tierPrices).map(([t, v]) => <div key={t} className="rounded border px-3 py-2 text-sm"><div className="text-xs text-slate-500">{t}</div><div className="font-medium">{peso(v)}</div></div>)}{can('cost.view') && <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm"><div className="text-xs text-slate-500">Standard cost</div><div className="font-medium">{p.cost != null ? peso(p.cost) : '—'}</div></div>}</div></Card>
    <Card title="Price history (never edited; new price = new row)"><DataTable data={p.priceHistory} columns={[{ header: 'Tier', accessorKey: 'tier' }, { header: 'Price', accessorKey: 'price', cell: (c) => <span className="num block">{peso(c.getValue())}</span> }, { header: 'From', accessorKey: 'effectiveFrom' }, { header: 'Approved by', accessorKey: 'approvedBy' }]} /></Card>
    {can('cost.view') && p.costHistory && <Card title="Cost history"><DataTable data={p.costHistory} columns={[{ header: 'Cost', accessorKey: 'cost', cell: (c) => <span className="num block">{peso(c.getValue())}</span> }, { header: 'From', accessorKey: 'effectiveFrom' }]} /></Card>}
  </div>;
}

/** §17 Price change process (Head Auditor/Admin creates → Admin approves → effective at 00:00 Manila). */
export function PriceChangesPage() {
  const qc = useQueryClient(); const { can } = useAuth();
  const q = useQuery({ queryKey: ['price-changes'], queryFn: () => api.get<{ id: string; controlNo: string; status: string; effectiveFrom: string; revaluationStatus: string | null; lines: { tier: string | null; oldPrice: string | null; newPrice: string | null; costOld?: string | null; costNew?: string | null; product: { name: string } }[] }[]>('/api/price-changes') });
  const [eff, setEff] = useState(''); const [search, setSearch] = useState('');
  const [lines, setLines] = useState<{ productId: string; name: string; tier: string; newPrice: string; costNew: string }[]>([]);
  const products = useQuery({ queryKey: ['products', search], queryFn: () => api.get<{ id: string; name: string }[]>(`/api/products?search=${encodeURIComponent(search)}&take=20`), enabled: search.length >= 2 });
  const tiers = useQuery({ queryKey: ['tiers'], queryFn: () => api.get<{ key: string; name: string }[]>('/api/products/tiers') });
  const m = useMutation({ mutationFn: () => api.post('/api/price-changes', { effectiveFrom: eff || undefined, lines: lines.map((l) => ({ productId: l.productId, tier: l.tier || null, newPrice: l.newPrice ? Number(l.newPrice) : null, costNew: l.costNew ? Number(l.costNew) : null })) }), onSuccess: () => { setLines([]); void qc.invalidateQueries({ queryKey: ['price-changes'] }); } });
  return <div className="space-y-4">
    <h1 className="text-xl font-semibold">Price changes</h1>
    <Card title="New price change (Admin approval; effective 00:00 Manila on the date; history untouched)">
      <div className="flex flex-wrap items-end gap-2"><Field label="Effective from (default tomorrow)"><Input type="date" value={eff} onChange={(e) => setEff(e.target.value)} /></Field><Field label="Add product"><Input value={search} onChange={(e) => setSearch(e.target.value)} /></Field></div>
      {search.length >= 2 && <ul className="max-h-40 divide-y overflow-auto rounded border bg-white text-sm">{products.data?.map((p) => <li key={p.id}><button className="w-full px-2 py-1 text-left hover:bg-slate-50" onClick={() => { setLines([...lines, { productId: p.id, name: p.name, tier: 'RETAIL', newPrice: '', costNew: '' }]); setSearch(''); }}>{p.name}</button></li>)}</ul>}
      <table className="mt-2 w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Product</th><th>Tier</th><th>New price</th>{can('cost.edit') && <th>New cost (triggers REVALUATION if higher)</th>}<th /></tr></thead><tbody>{lines.map((l, i) => <tr key={i} className="border-t"><td>{l.name}</td><td><Select value={l.tier} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, tier: e.target.value } : x)))}><option value="">(cost only)</option>{tiers.data?.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</Select></td><td><Input type="number" step="0.01" value={l.newPrice} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, newPrice: e.target.value } : x)))} /></td>{can('cost.edit') && <td><Input type="number" step="0.01" value={l.costNew} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, costNew: e.target.value } : x)))} /></td>}<td><button className="text-red-600" onClick={() => setLines(lines.filter((_, k) => k !== i))}>✕</button></td></tr>)}</tbody></table>
      <Button className="mt-3" disabled={!lines.length} onClick={() => m.mutate()}>Submit for approval</Button><ErrorBox error={m.error} />
    </Card>
    <DataTable data={q.data ?? []} columns={[{ header: 'Control #', accessorKey: 'controlNo' }, { header: 'Effective', accessorKey: 'effectiveFrom', cell: (c) => fmtDate(c.getValue()) }, { header: 'Lines', accessorFn: (r) => r.lines.map((l) => `${l.product.name} ${l.tier ?? 'cost'}: ${l.oldPrice ?? l.costOld ?? '-'} → ${l.newPrice ?? l.costNew}`).join('; ') }, { header: 'Status', accessorKey: 'status', cell: (c) => <Badge tone={statusTone(String(c.getValue()))}>{String(c.getValue())}</Badge> }, { header: 'Revaluation', accessorKey: 'revaluationStatus' }]} />
  </div>;
}

export function SuppliersPage() {
  const { can } = useAuth(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<{ id: string; code: string; supplierName?: string; contact: string | null; termsDays: number; isConsignor: boolean; active: boolean }[]>('/api/suppliers') });
  const [f, setF] = useState({ name: '', contact: '', termsDays: '30', isConsignor: false });
  const [sent, setSent] = useState('');
  const m = useMutation({ mutationFn: () => api.post('/api/suppliers', { ...f, termsDays: Number(f.termsDays) }), onSuccess: (r) => { setSent(pendingMessage(r)); setF({ name: '', contact: '', termsDays: '30', isConsignor: false }); void qc.invalidateQueries({ queryKey: ['suppliers'] }); void qc.invalidateQueries({ queryKey: ['master-pending'] }); } });
  return <div className="space-y-4"><h1 className="text-xl font-semibold">Suppliers</h1>
    {can('supplier.edit') && <Card title="New supplier"><div className="grid gap-3 md:grid-cols-4"><Field label="Name (Admin/Head Auditor only)"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><Field label="Contact"><Input value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} /></Field><Field label="Terms (days)"><Input type="number" value={f.termsDays} onChange={(e) => setF({ ...f, termsDays: e.target.value })} /></Field><label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.isConsignor} onChange={(e) => setF({ ...f, isConsignor: e.target.checked })} /> Consignor (consignment-in)</label></div><Button className="mt-3" disabled={!f.name} onClick={() => m.mutate()}>Create</Button><ErrorBox error={m.error} /></Card>}
    {sent && <p className="text-sm text-amber-700">{sent}</p>}<PendingMaster kind="Supplier" label="New suppliers" />
    <DataTable data={q.data ?? []} columns={[{ header: 'Code', accessorKey: 'code' }, ...(can('supplier.view.name') ? [{ header: 'Name', accessorKey: 'supplierName' }] : []), { header: 'Contact', accessorKey: 'contact' }, { header: 'Terms', accessorKey: 'termsDays' }, { header: '', cell: (c) => c.row.original.isConsignor ? <Badge tone="purple">consignor</Badge> : null }]} />
    {!can('supplier.view.name') && <p className="text-xs text-slate-500">Supplier names are visible to Admin, Head Auditor and External Auditor only (§16).</p>}
  </div>;
}
