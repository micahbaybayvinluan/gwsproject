import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, fmtDate, peso } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Field, Input, Select, statusTone } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';
import { Attachments } from '@/components/Attachments';
import { EditRequests, History, ReceivingEditor, useEditRights } from '@/components/DocEdits';

interface Rcv { id: string; controlNo: string; docDate: string; status: string; supplierRef: string | null; notes?: string | null; preparedBy?: string; preparedByName?: string | null; isConsignmentIn: boolean; supplier: { code: string; name?: string }; location: { name: string }; lines: { id: string; qty: number; freeQty: number; expiryDate: string | null; batchNo: string | null; unitCost?: string | null; currentStandardCost?: string | null; costUnchanged: boolean; isNewProduct: boolean; product: { name: string; sku: string; trackExpiry: boolean } }[]; attachments?: unknown[] }

/** §7.2 Supplier's Form: warehouse enters qty/expiry/batch (cost hidden); Head Auditor confirms/enters cost and approves. */
export function ReceivingPage() {
  const nav = useNavigate(); const { can } = useAuth(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['receiving'], queryFn: () => api.get<Rcv[]>('/api/receiving') });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<{ id: string; code: string; supplierName?: string; isConsignor: boolean }[]>('/api/suppliers') });
  const [f, setF] = useState({ supplierId: '', supplierRef: '', isConsignmentIn: false, notes: '' });
  const [lines, setLines] = useState<{ productId: string; name: string; qty: number; freeQty: number; expiryDate: string; batchNo: string; unitCost: string }[]>([]);
  const [search, setSearch] = useState('');
  const products = useQuery({ queryKey: ['products', search], queryFn: () => api.get<{ id: string; name: string; sku: string; trackExpiry: boolean }[]>(`/api/products?search=${encodeURIComponent(search)}&take=20`), enabled: search.length >= 2 });
  const m = useMutation({ mutationFn: () => api.post<{ id: string; warnings: string[] }>('/api/receiving', { ...f, lines: lines.map((l) => ({ productId: l.productId, qty: l.qty, freeQty: l.freeQty, expiryDate: l.expiryDate || null, batchNo: l.batchNo || null, unitCost: can('cost.edit') && l.unitCost ? Number(l.unitCost) : null })) }), onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['receiving'] }); nav(`/receiving/${r.id}`); } });
  return <div className="space-y-4">
    <h1 className="text-xl font-semibold">Receiving (Supplier's Form / PO)</h1>
    {can('receiving.create') && <Card title="New receiving">
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Supplier (code)"><Select value={f.supplierId} onChange={(e) => { const s = suppliers.data?.find((x) => x.id === e.target.value); setF({ ...f, supplierId: e.target.value, isConsignmentIn: !!s?.isConsignor }); }}><option value="">—</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.code}{s.supplierName ? ` — ${s.supplierName}` : ''}</option>)}</Select></Field>
        <Field label="Supplier invoice / DR #"><Input value={f.supplierRef} onChange={(e) => setF({ ...f, supplierRef: e.target.value })} /></Field>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.isConsignmentIn} onChange={(e) => setF({ ...f, isConsignmentIn: e.target.checked })} /> Consignment-in (supplier's stock)</label>
        <Field label="Notes"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <div className="mt-3"><Input placeholder="Add product…" value={search} onChange={(e) => setSearch(e.target.value)} />{search.length >= 2 && <ul className="max-h-48 divide-y overflow-auto rounded border bg-white">{products.data?.map((p) => <li key={p.id}><button className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setLines([...lines, { productId: p.id, name: p.name, qty: 1, freeQty: 0, expiryDate: '', batchNo: '', unitCost: '' }]); setSearch(''); }}>{p.name} <span className="text-xs text-slate-500">{p.sku}{p.trackExpiry ? ' · expiry required' : ''}</span></button></li>)}</ul>}</div>
      <table className="mt-3 w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Product</th><th>Qty</th><th>Free</th><th>Expiry</th><th>Batch #</th>{can('cost.edit') && <th>Unit cost</th>}<th /></tr></thead><tbody>{lines.map((l, i) => <tr key={i} className="border-t"><td>{l.name}</td><td><Input type="number" className="w-20" value={l.qty} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, qty: Number(e.target.value) } : x)))} /></td><td><Input type="number" className="w-20" value={l.freeQty} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, freeQty: Number(e.target.value) } : x)))} /></td><td><Input type="date" value={l.expiryDate} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, expiryDate: e.target.value } : x)))} /></td><td><Input value={l.batchNo} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, batchNo: e.target.value } : x)))} /></td>{can('cost.edit') && <td><Input type="number" step="0.01" className="w-28" value={l.unitCost} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, unitCost: e.target.value } : x)))} /></td>}<td className="whitespace-nowrap"><button type="button" className="mr-2 text-xs text-brand underline" title="Same item, different expiry date" onClick={() => setLines([...lines.slice(0, i + 1), { ...l, qty: 0, freeQty: 0, expiryDate: '', batchNo: '' }, ...lines.slice(i + 1)])}>+ another expiry</button><button className="text-red-600" onClick={() => setLines(lines.filter((_, k) => k !== i))}>✕</button></td></tr>)}</tbody></table>
      <p className="mt-2 text-xs text-slate-500">If one item arrives with different expiry dates, use “+ another expiry” and enter the quantity for each date. Each date becomes its own batch, shown everywhere the item appears.</p>
      <Button className="mt-3" disabled={!f.supplierId || !lines.length || m.isPending} onClick={() => m.mutate()}>Create draft</Button><ErrorBox error={m.error} />
    </Card>}
    <DataTable exportName="ReceivingRegister" data={q.data ?? []} onRowClick={(r) => nav(`/receiving/${r.id}`)} columns={[{ header: 'Date', accessorKey: 'docDate', cell: (c) => fmtDate(c.getValue()) }, { header: 'Control #', accessorKey: 'controlNo' }, { header: 'Supplier', accessorFn: (r) => r.supplier.name ? `${r.supplier.code} — ${r.supplier.name}` : r.supplier.code }, { header: 'Ref', accessorKey: 'supplierRef' }, { header: 'Lines', accessorFn: (r) => r.lines.length }, { header: 'Status', accessorKey: 'status', cell: (c) => <Badge tone={statusTone(String(c.getValue()))}>{String(c.getValue())}</Badge> }]} />
  </div>;
}

export function ReceivingDetailPage() {
  const { id } = useParams(); const qc = useQueryClient(); const { can, me } = useAuth();
  const q = useQuery({ queryKey: ['receiving', id], queryFn: () => api.get<Rcv>(`/api/receiving/${id}`) });
  const approvals = useQuery({ queryKey: ['approvals-doc', id], queryFn: () => api.get<{ id: string; status: string; type: string }[]>(`/api/approvals/document/ReceivingDoc/${id}`) });
  const [costs, setCosts] = useState<Record<string, string>>({});
  const inv = () => { void qc.invalidateQueries({ queryKey: ['receiving', id] }); void qc.invalidateQueries({ queryKey: ['approvals-doc', id] }); void qc.invalidateQueries({ queryKey: ['approvals-count'] }); };
  const submit = useMutation({ mutationFn: () => api.post(`/api/receiving/${id}/submit`), onSuccess: inv });
  const setCost = useMutation({ mutationFn: () => api.post(`/api/receiving/${id}/costs`, { costs: Object.entries(costs).filter(([, v]) => v !== '').map(([lineId, v]) => ({ lineId, unitCost: Number(v) })) }), onSuccess: inv });
  const decide = useMutation({ mutationFn: (decision: 'APPROVE' | 'REJECT') => api.post(`/api/approvals/${approvals.data?.find((a) => a.status === 'PENDING')?.id}/decide`, { decision }), onSuccess: inv });
  const [editing, setEditing] = useState(false); const [msg, setMsg] = useState('');
  const rights = useEditRights(q.data ?? { status: '' }, 'receiving.create');
  const d = q.data; if (!d) return null;
  const pending = approvals.data?.find((a) => a.status === 'PENDING');
  const draft = d.status === 'DRAFT';
  return <div className="mx-auto max-w-4xl space-y-4">
    <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">{d.controlNo}</h1><Badge tone={statusTone(d.status)}>{d.status}</Badge>{d.isConsignmentIn && <Badge tone="purple">consignment-in</Badge>}<span className="ml-auto flex flex-wrap gap-2">{rights.canEdit && !editing && <Button size="sm" onClick={() => { setEditing(true); setMsg(''); }}>{rights.own ? 'Edit draft' : 'Propose edit'}</Button>}<Button size="sm" variant="outline" onClick={() => api.download(`/api/reports/forms/supplier-form/${d.id}.pdf`, `${d.controlNo}${draft ? '-DRAFT' : ''}.pdf`)}>{draft ? 'Print draft' : 'Print'}</Button><Button size="sm" variant="outline" onClick={() => api.download(`/api/reports/forms/supplier-form/${d.id}.xlsx`, `${d.controlNo}${draft ? '-DRAFT' : ''}.xlsx`)}>xlsx</Button></span></div>
    <p className="text-sm text-slate-600">Prepared by <b>{d.preparedByName ?? '—'}</b>{draft ? ' · Draft: check it on paper, edit if needed, then submit.' : ''}</p>
    {msg && <p className="rounded bg-green-50 p-2 text-sm text-green-800">{msg}</p>}
    {editing && <ReceivingEditor doc={d} own={rights.own} preparedByName={d.preparedByName} onClose={(m) => { setEditing(false); if (m) setMsg(m); }} />}
    <EditRequests kind="receiving" id={d.id} />
    <Card><dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">{[['Date', fmtDate(d.docDate)], ['Supplier', d.supplier.name ? `${d.supplier.code} — ${d.supplier.name}` : d.supplier.code], ['Supplier ref', d.supplierRef ?? '—'], ['Received at', d.location.name]].map(([k, v]) => <div key={k}><dt className="text-xs uppercase text-slate-500">{k}</dt><dd>{v}</dd></div>)}</dl></Card>
    <Card title="Lines"><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Product</th><th className="num">Qty</th><th className="num">Free</th><th>Expiry</th><th>Batch</th>{can('cost.view') && <><th className="num">Std cost</th><th className="num">Cost</th></>}</tr></thead><tbody>{d.lines.map((l) => <tr key={l.id} className="border-t"><td>{l.product.name}{l.isNewProduct && <Badge tone="blue">new</Badge>}{l.costUnchanged && <Badge tone="green">unchanged</Badge>}</td><td className="num">{l.qty}</td><td className="num">{l.freeQty}</td><td>{fmtDate(l.expiryDate)}</td><td>{l.batchNo}</td>{can('cost.view') && <><td className="num">{l.currentStandardCost != null ? peso(l.currentStandardCost) : '—'}</td><td className="num">{d.status === 'SUBMITTED' && can('cost.edit') ? <Input type="number" step="0.01" className="w-28" placeholder={l.unitCost ?? l.currentStandardCost ?? ''} value={costs[l.id] ?? ''} onChange={(e) => setCosts({ ...costs, [l.id]: e.target.value })} /> : l.unitCost != null ? peso(l.unitCost) : '—'}</td></>}</tr>)}</tbody></table>
      <div className="mt-3 flex flex-wrap gap-2">
        {d.status === 'DRAFT' && can('receiving.create') && (d.preparedBy === me?.id || !me?.locationScoped) && <Button onClick={() => submit.mutate()}>Submit for cost approval</Button>}
        {d.status === 'SUBMITTED' && can('cost.edit') && <Button variant="outline" onClick={() => setCost.mutate()} disabled={!Object.keys(costs).length}>Save costs</Button>}
        {d.status === 'SUBMITTED' && pending && can(`approval.act.${pending.type}`) && <><Button onClick={() => decide.mutate('APPROVE')}>{d.lines.every((l) => l.costUnchanged) ? 'Confirm all unchanged & approve' : 'Approve'}</Button><Button variant="danger" onClick={() => decide.mutate('REJECT')}>Reject</Button></>}
      </div>
      <ErrorBox error={submit.error || setCost.error || decide.error} />
    </Card>
    <Attachments type="ReceivingDoc" id={d.id} />
    <History entityType="ReceivingDoc" id={d.id} />
  </div>;
}
