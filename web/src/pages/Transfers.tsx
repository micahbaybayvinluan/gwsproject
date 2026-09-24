import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Field, Input, Select, statusTone } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';
import { Attachments } from '@/components/Attachments';

interface Tr { id: string; controlNo: string; docDate: string; status: string; transferType: string; notes: string | null; fromLocation: { id: string; name: string; type: string }; toLocation: { id: string; name: string; type: string }; lines: { id: string; qtySent: number; qtyReceived: number | null; discrepancyNote: string | null; checkerRemarks: string | null; product: { name: string; sku: string }; batch: { batchNo: string | null; expiryDate: string | null } }[] }

/** §7.3 Pull-Out (sender) / Transfer-In (receiver): one document, two views. */
export function TransfersPage() {
  const nav = useNavigate(); const { me, can } = useAuth(); const qc = useQueryClient(); const [sp] = useSearchParams();
  const [direction, setDirection] = useState(sp.get('direction') ?? '');
  const q = useQuery({ queryKey: ['transfers', direction], queryFn: () => api.get<Tr[]>(`/api/transfers${direction ? `?direction=${direction}` : ''}`) });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; type: string; code: string }[]>('/api/locations') });
  const wh = locations.data?.find((l) => l.type === 'WAREHOUSE'); const own = me!.locations[0];
  const [f, setF] = useState({ fromLocationId: '', toLocationId: '', transferType: 'RESTOCK', returnReason: '', notes: '' });
  const [lines, setLines] = useState<{ productId: string; name: string; qty: number }[]>([]); const [search, setSearch] = useState('');
  const from = f.fromLocationId || (me!.locationScoped ? wh?.id ?? '' : ''); const to = f.toLocationId || (me!.locationScoped ? own?.id ?? '' : '');
  const products = useQuery({ queryKey: ['products', search], queryFn: () => api.get<{ id: string; name: string; sku: string }[]>(`/api/products?search=${encodeURIComponent(search)}&take=20`), enabled: search.length >= 2 });
  const avail = useQuery({ queryKey: ['wh-avail', lines.map((l) => l.productId).join()], queryFn: () => api.get<{ productId: string; qty: number }[]>(`/api/stock/warehouse-availability?productIds=${lines.map((l) => l.productId).join(',')}`), enabled: lines.length > 0 });
  const m = useMutation({ mutationFn: () => api.post<{ id: string }>('/api/transfers', { fromLocationId: from, toLocationId: to, transferType: f.transferType, returnReason: f.returnReason || undefined, notes: f.notes, lines: lines.map((l) => ({ productId: l.productId, qty: l.qty })) }), onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['transfers'] }); nav(`/transfers/${r.id}`); } });
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-xl font-semibold">Transfers (Pull-Out / Transfer-In)</h1><Field label="View"><Select value={direction} onChange={(e) => setDirection(e.target.value)}><option value="">All</option><option value="out">Outgoing (Pull-Out)</option><option value="in">Incoming (Transfer-In)</option></Select></Field></div>
    {can('transfer.create') && <Card title={me!.locationScoped ? 'Request stock from warehouse / send from my branch' : 'New transfer'}>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="From"><Select value={from} onChange={(e) => setF({ ...f, fromLocationId: e.target.value })}><option value="">—</option>{locations.data?.filter((l) => !me!.locationScoped || l.type === 'WAREHOUSE' || me!.locations.some((x) => x.id === l.id) || l.code === 'V-CUSTRET').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        <Field label="To"><Select value={to} onChange={(e) => setF({ ...f, toLocationId: e.target.value })}><option value="">—</option>{locations.data?.filter((l) => l.type !== 'VIRTUAL' || l.code === 'V-CUSTRET').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        <Field label="Type"><Select value={f.transferType} onChange={(e) => setF({ ...f, transferType: e.target.value })}>{['RESTOCK', 'RETURN', 'REPLACEMENT', 'INTERNAL', 'CONSIGNMENT_OUT', 'CONSIGNMENT_RETURN'].map((t) => <option key={t}>{t}</option>)}</Select></Field>
        {f.transferType === 'RETURN' && <Field label="Return reason"><Select value={f.returnReason} onChange={(e) => setF({ ...f, returnReason: e.target.value })}><option value="">—</option>{['clumped', 'damaged', 'wrong item', 'expired', 'other'].map((r) => <option key={r}>{r}</option>)}</Select></Field>}
        <Field label="Notes" className="md:col-span-4"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <div className="mt-3"><Input placeholder="Add product…" value={search} onChange={(e) => setSearch(e.target.value)} />{search.length >= 2 && <ul className="max-h-48 divide-y overflow-auto rounded border bg-white">{products.data?.map((p) => <li key={p.id}><button className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setLines([...lines, { productId: p.id, name: p.name, qty: 1 }]); setSearch(''); }}>{p.name} <span className="text-xs text-slate-500">{p.sku}</span></button></li>)}</ul>}</div>
      <table className="mt-3 w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Product</th><th>Qty</th><th>Warehouse available</th><th /></tr></thead><tbody>{lines.map((l, i) => <tr key={i} className="border-t"><td>{l.name}</td><td><Input type="number" className="w-24" value={l.qty} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, qty: Number(e.target.value) } : x)))} /></td><td>{avail.data?.find((a) => a.productId === l.productId)?.qty ?? 0}</td><td><button className="text-red-600" onClick={() => setLines(lines.filter((_, k) => k !== i))}>✕</button></td></tr>)}</tbody></table>
      <p className="mt-2 text-xs text-slate-500">Batches are assigned first-expiry-first-out; the receiver sees batch and expiry.</p>
      <Button className="mt-3" disabled={!from || !to || !lines.length || m.isPending} onClick={() => m.mutate()}>Create draft</Button><ErrorBox error={m.error} />
    </Card>}
    <DataTable exportName="TransferRegister" data={q.data ?? []} onRowClick={(r) => nav(`/transfers/${r.id}`)} columns={[{ header: 'Date', accessorKey: 'docDate', cell: (c) => fmtDate(c.getValue()) }, { header: 'Control #', accessorKey: 'controlNo' }, { header: 'From', accessorFn: (r) => r.fromLocation.name }, { header: 'To', accessorFn: (r) => r.toLocation.name }, { header: 'Type', accessorKey: 'transferType' }, { header: 'Lines', accessorFn: (r) => r.lines.length }, { header: 'Status', accessorKey: 'status', cell: (c) => <Badge tone={statusTone(String(c.getValue()))}>{String(c.getValue())}</Badge> }]} />
  </div>;
}

export function TransferDetailPage() {
  const { id } = useParams(); const qc = useQueryClient(); const { me, can } = useAuth();
  const q = useQuery({ queryKey: ['transfer', id], queryFn: () => api.get<Tr>(`/api/transfers/${id}`) });
  const [recv, setRecv] = useState<Record<string, { qty: string; note: string }>>({});
  const inv = () => { void qc.invalidateQueries({ queryKey: ['transfer', id] }); void qc.invalidateQueries({ queryKey: ['transfers'] }); void qc.invalidateQueries({ queryKey: ['approvals-count'] }); };
  const submit = useMutation({ mutationFn: () => api.post(`/api/transfers/${id}/submit`), onSuccess: inv });
  const confirm = useMutation({ mutationFn: () => api.post(`/api/transfers/${id}/confirm`, { lines: (q.data?.lines ?? []).map((l) => ({ lineId: l.id, qtyReceived: Number(recv[l.id]?.qty ?? l.qtySent), discrepancyNote: recv[l.id]?.note || undefined })) }), onSuccess: inv });
  const resolve = useMutation({ mutationFn: (resolution: string) => api.post(`/api/transfers/${id}/resolve`, { resolution }), onSuccess: inv });
  const d = q.data; if (!d) return null;
  const isReceiver = me!.locations.some((l) => l.id === d.toLocation.id) || !me!.locationScoped;
  return <div className="mx-auto max-w-4xl space-y-4">
    <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">{d.controlNo}</h1><Badge tone={statusTone(d.status)}>{d.status}</Badge><Badge>{d.transferType}</Badge><span className="ml-auto flex gap-2"><Button size="sm" variant="outline" onClick={() => api.download(`/api/reports/forms/pull-out/${d.id}.pdf`, `PullOut-${d.controlNo}.pdf`)}>Pull-Out form</Button><Button size="sm" variant="outline" onClick={() => api.download(`/api/reports/forms/transfer-in/${d.id}.pdf`, `TransferIn-${d.controlNo}.pdf`)}>Transfer-In form</Button></span></div>
    <Card><dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">{[['Date', fmtDate(d.docDate)], ['From', d.fromLocation.name], ['Trans. To', d.toLocation.name], ['Notes', d.notes ?? '—']].map(([k, v]) => <div key={k}><dt className="text-xs uppercase text-slate-500">{k}</dt><dd>{v}</dd></div>)}</dl></Card>
    <Card title="Lines">
      <table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Items</th><th>Batch / expiry</th><th className="num">Qty out</th><th>Received qty</th><th>Remarks</th></tr></thead><tbody>{d.lines.map((l) => <tr key={l.id} className="border-t"><td>{l.product.name}</td><td className="text-xs text-slate-500">{l.batch.batchNo ?? '—'} {fmtDate(l.batch.expiryDate)}</td><td className="num">{l.qtySent}</td><td>{d.status === 'APPROVED' && isReceiver && can('transfer.confirm') ? <Input type="number" min={0} max={l.qtySent} className="w-24" value={recv[l.id]?.qty ?? l.qtySent} onChange={(e) => setRecv({ ...recv, [l.id]: { qty: e.target.value, note: recv[l.id]?.note ?? '' } })} /> : <span className="num">{l.qtyReceived ?? '—'}</span>}</td><td>{d.status === 'APPROVED' && isReceiver ? <Input placeholder="discrepancy note" value={recv[l.id]?.note ?? ''} onChange={(e) => setRecv({ ...recv, [l.id]: { qty: recv[l.id]?.qty ?? String(l.qtySent), note: e.target.value } })} /> : l.discrepancyNote ?? l.checkerRemarks ?? ''}</td></tr>)}</tbody></table>
      <div className="mt-3 flex flex-wrap gap-2">
        {d.status === 'DRAFT' && can('transfer.create') && <Button onClick={() => submit.mutate()}>Submit for approval</Button>}
        {d.status === 'APPROVED' && isReceiver && can('transfer.confirm') && <Button onClick={() => confirm.mutate()}>Confirm receipt</Button>}
        {d.status === 'DISCREPANCY' && can('transfer.resolve_discrepancy') && <><span className="self-center text-sm">Resolve shortfall:</span><Button variant="outline" onClick={() => resolve.mutate('TO_SENDER')}>Back to sender</Button><Button variant="outline" onClick={() => resolve.mutate('TO_RECEIVER')}>Give to receiver</Button><Button variant="danger" onClick={() => resolve.mutate('WRITEOFF')}>Write off</Button></>}
      </div>
      <ErrorBox error={submit.error || confirm.error || resolve.error} />
    </Card>
    <Attachments type="TransferDoc" id={d.id} />
  </div>;
}
