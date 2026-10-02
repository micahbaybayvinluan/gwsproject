import { locLabel } from '@/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, fmtDate, peso } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Field, Input, Select, statusTone } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';

/** §7.6 Expiry / damage write-off → Head Auditor approval. */
export function WriteoffsPage() {
  const { me, can } = useAuth(); const qc = useQueryClient();
  const [locationId, setLocationId] = useState(me!.locations[0]?.id ?? ''); const [productId, setProductId] = useState(''); const [search, setSearch] = useState('');
  const [lines, setLines] = useState<{ productId: string; name: string; batchId: string; batchNo: string; qty: number; reason: 'EXPIRED' | 'DAMAGED' | 'SPOILED' }[]>([]);
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/locations') });
  const products = useQuery({ queryKey: ['products', search, 'wo', locationId], queryFn: () => api.get<{ id: string; name: string; sku: string }[]>(`/api/products?search=${encodeURIComponent(search)}&take=20${locationId ? `&inStockAt=${locationId}&includeExpired=1` : ''}`), enabled: search.length >= 2 });
  const batches = useQuery({ queryKey: ['batches', productId, locationId], queryFn: () => api.get<{ batchId: string; batchNo: string | null; expiryDate: string | null; flavor?: string | null; qty: number }[]>(`/api/stock/batches/${productId}?locationId=${locationId}`), enabled: !!productId && !!locationId });
  const list = useQuery({ queryKey: ['writeoffs'], queryFn: () => api.get<{ id: string; controlNo: string; docDate: string; status: string; chargeTo: string; chargeEmployeeIds: string[]; chargeFormId: string | null; location: { name: string }; lines: { qty: number; reason: string; product: { name: string } }[] }[]>('/api/writeoffs') });
  // who bears the loss: the company (expense) or named staff (charge form to HR, deducted from payroll)
  const [chargeTo, setChargeTo] = useState<'COMPANY' | 'STAFF'>('COMPANY'); const [staffIds, setStaffIds] = useState<string[]>([]);
  const staff = useQuery({ queryKey: ['staff', locationId], queryFn: () => api.get<{ id: string; fullName: string; position: string | null }[]>(`/api/staff?locationId=${locationId}`), enabled: !!locationId && chargeTo === 'STAFF' });
  const m = useMutation({ mutationFn: () => api.post('/api/writeoffs', { locationId, chargeTo, employeeIds: chargeTo === 'STAFF' ? staffIds : [], lines: lines.map((l) => ({ productId: l.productId, batchId: l.batchId, qty: l.qty, reason: l.reason })) }), onSuccess: () => { setLines([]); setStaffIds([]); setChargeTo('COMPANY'); void qc.invalidateQueries({ queryKey: ['writeoffs'] }); } });
  return <div className="space-y-4">
    <h1 className="text-2xl font-bold tracking-tight text-navy">Write-offs</h1>
    {can('writeoff.create') && <Card title="New write-off (needs Head Auditor approval)">
      <div className="grid gap-3 md:grid-cols-3"><Field label="Location"><Select value={locationId} onChange={(e) => setLocationId(e.target.value)}><option value="">—</option>{locations.data?.filter((l) => !me!.locationScoped || me!.locations.some((x) => x.id === l.id)).map((l) => <option key={l.id} value={l.id}>{locLabel(l)}</option>)}</Select></Field><Field label="Product"><Input placeholder="search…" value={search} onChange={(e) => setSearch(e.target.value)} />{search.length >= 2 && <ul className="max-h-40 divide-y overflow-auto rounded border bg-white text-sm">{products.data?.map((p) => <li key={p.id}><button className="w-full px-2 py-1 text-left hover:bg-slate-50" onClick={() => { setProductId(p.id); setSearch(p.name); }}>{p.name}</button></li>)}</ul>}</Field><Field label="Batch"><Select onChange={(e) => { const b = batches.data?.find((x) => x.batchId === e.target.value); if (b) setLines([...lines, { productId, name: search, batchId: b.batchId, batchNo: b.batchNo ?? '', qty: b.qty, reason: 'EXPIRED' }]); }}><option value="">pick a batch to add…</option>{batches.data?.map((b) => <option key={b.batchId} value={b.batchId}>{b.flavor ? `${b.flavor} · ` : ''}{b.batchNo ?? 'no batch'} · exp {fmtDate(b.expiryDate)} · {b.qty} on hand</option>)}</Select></Field></div>
      <div className="sticky-head"><table className="mt-3 w-full text-sm"><tbody>{lines.map((l, i) => <tr key={i} className="border-t"><td>{l.name} · {l.batchNo}</td><td><Input type="number" className="w-24" value={l.qty} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, qty: Number(e.target.value) } : x)))} /></td><td><Select value={l.reason} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, reason: e.target.value as never } : x)))}><option>EXPIRED</option><option>DAMAGED</option><option>SPOILED</option></Select></td><td><button className="text-red-600" onClick={() => setLines(lines.filter((_, k) => k !== i))}>✕</button></td></tr>)}</tbody></table></div>
      <div className="mt-3 rounded-md border border-slate-200 p-3">
        <div className="text-sm font-medium">Who bears the loss?</div>
        <label className="mr-4 inline-flex items-center gap-2 text-sm"><input type="radio" checked={chargeTo === 'COMPANY'} onChange={() => setChargeTo('COMPANY')} /> Expensed by the company</label>
        <label className="inline-flex items-center gap-2 text-sm"><input type="radio" checked={chargeTo === 'STAFF'} onChange={() => setChargeTo('STAFF')} /> Charged to staff</label>
        {chargeTo === 'STAFF' && <div className="mt-2 flex flex-wrap gap-3">{staff.data?.length ? staff.data.map((e) => <label key={e.id} className="inline-flex items-center gap-1 text-sm"><input type="checkbox" checked={staffIds.includes(e.id)} onChange={(ev) => setStaffIds(ev.target.checked ? [...staffIds, e.id] : staffIds.filter((x) => x !== e.id))} />{e.fullName}</label>) : <span className="text-xs text-slate-500">No staff recorded for this location (HR adds employees under Payroll).</span>}</div>}
        {chargeTo === 'STAFF' && <p className="mt-1 text-xs text-slate-500">On approval a charge form is created for HR, split equally among the staff ticked; they are notified and it is deducted from payroll.</p>}
      </div>
      <Button className="mt-3" disabled={!lines.length || m.isPending || (chargeTo === 'STAFF' && !staffIds.length)} onClick={() => m.mutate()}>Submit write-off</Button><ErrorBox error={m.error} />
    </Card>}
    <DataTable exportName="Writeoffs" data={list.data ?? []} columns={[{ header: 'Date', accessorKey: 'docDate', cell: (c) => fmtDate(c.getValue()) }, { header: 'Control #', accessorKey: 'controlNo' }, { header: 'Location', accessorFn: (r) => r.location.name }, { header: 'Items', accessorFn: (r) => r.lines.map((l) => `${l.qty}× ${l.product.name} (${l.reason})`).join(', ') }, { header: 'Borne by', accessorFn: (r) => (r.chargeTo === 'STAFF' ? `Staff (${r.chargeEmployeeIds.length})` : 'Company') }, { header: 'Status', accessorKey: 'status', cell: (c) => <Badge tone={statusTone(String(c.getValue()))}>{String(c.getValue())}</Badge> }]} />
  </div>;
}
