import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Field, Input, Select, statusTone } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';
import { Attachments } from '@/components/Attachments';
import { EditRequests, History, TransferEditor, useEditRights } from '@/components/DocEdits';

interface Tr { id: string; controlNo: string; docDate: string; status: string; transferType: string; notes: string | null; preparedBy?: string; preparedByName?: string | null; receivedByName?: string | null; fromLocation: { id: string; name: string; type: string }; toLocation: { id: string; name: string; type: string }; lines: { id: string; qtySent: number; qtyReceived: number | null; discrepancyNote: string | null; checkerRemarks: string | null; product: { name: string; sku: string }; batch: { batchNo: string | null; expiryDate: string | null } }[] }

/** §7.3 Pull-Out (sender) / Transfer-In (receiver): one document, two views. */
export function TransfersPage() {
  const nav = useNavigate(); const { me, can } = useAuth(); const qc = useQueryClient(); const [sp] = useSearchParams();
  const [direction, setDirection] = useState(sp.get('direction') ?? '');
  const q = useQuery({ queryKey: ['transfers', direction], queryFn: () => api.get<Tr[]>(`/api/transfers${direction ? `?direction=${direction}` : ''}`) });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; type: string; code: string }[]>('/api/locations') });
  const wh = locations.data?.find((l) => l.type === 'WAREHOUSE'); const own = me!.locations[0];
  const [f, setF] = useState({ fromLocationId: '', toLocationId: '', transferType: 'RESTOCK', returnReason: '', notes: '' });
  const [lines, setLines] = useState<{ productId: string; name: string; qty: number }[]>([]); const [search, setSearch] = useState('');
  // Warehouse staff send from their warehouse to any branch / franchise / consignee; branch staff request from the warehouse to their branch.
  const warehouseUser = me!.locations.some((l) => l.type === 'WAREHOUSE');
  const from = f.fromLocationId || (me!.locationScoped ? (warehouseUser ? own?.id : wh?.id) ?? '' : ''); const to = f.toLocationId || (me!.locationScoped && !warehouseUser ? own?.id ?? '' : '');
  const products = useQuery({ queryKey: ['products', search], queryFn: () => api.get<{ id: string; name: string; sku: string }[]>(`/api/products?search=${encodeURIComponent(search)}&take=20`), enabled: search.length >= 2 });
  const avail = useQuery({ queryKey: ['wh-avail', lines.map((l) => l.productId).join()], queryFn: () => api.get<{ productId: string; qty: number }[]>(`/api/stock/warehouse-availability?productIds=${lines.map((l) => l.productId).join(',')}`), enabled: lines.length > 0 });
  const m = useMutation({ mutationFn: () => api.post<{ id: string }>('/api/transfers', { fromLocationId: from, toLocationId: to, transferType: f.transferType, returnReason: f.returnReason || undefined, notes: f.notes, lines: lines.map((l) => ({ productId: l.productId, qty: l.qty })) }), onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['transfers'] }); nav(`/transfers/${r.id}`); } });
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-xl font-semibold">Transfers (Pull-Out / Transfer-In)</h1><Field label="View"><Select value={direction} onChange={(e) => setDirection(e.target.value)}><option value="">All</option><option value="out">Outgoing (Pull-Out)</option><option value="in">Incoming (Transfer-In)</option></Select></Field></div>
    {can('transfer.create') && <Card title={warehouseUser ? 'Send stock from the warehouse (to a branch, franchise or consignee)' : me!.locationScoped ? 'Request stock from warehouse / send from my branch' : 'New transfer'}>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="From"><Select value={from} onChange={(e) => setF({ ...f, fromLocationId: e.target.value })}><option value="">—</option>{locations.data?.filter((l) => !me!.locationScoped || l.type === 'WAREHOUSE' || me!.locations.some((x) => x.id === l.id) || l.code === 'V-CUSTRET').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        <Field label="To"><Select value={to} onChange={(e) => setF({ ...f, toLocationId: e.target.value })}><option value="">—</option>{locations.data?.filter((l) => (l.type !== 'VIRTUAL' || l.code === 'V-CUSTRET') && l.id !== from).map((l) => <option key={l.id} value={l.id}>{l.name}{l.type === 'FRANCHISE' ? ' (franchise)' : l.type === 'CONSIGNEE' ? ' (consignee)' : ''}</option>)}</Select></Field>
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
  // receiving side: a tick means "arrived exactly as sent"; an unticked line needs the quantity actually received (+ a note when short)
  const [recv, setRecv] = useState<Record<string, { checked: boolean; qty: string; note: string }>>({});
  const inv = () => { void qc.invalidateQueries({ queryKey: ['transfer', id] }); void qc.invalidateQueries({ queryKey: ['transfers'] }); void qc.invalidateQueries({ queryKey: ['approvals-count'] }); void qc.invalidateQueries({ queryKey: ['history'] }); };
  const submit = useMutation({ mutationFn: () => api.post(`/api/transfers/${id}/submit`), onSuccess: inv });
  const confirm = useMutation({ mutationFn: () => api.post(`/api/transfers/${id}/confirm`, { lines: (q.data?.lines ?? []).map((l) => { const r = recv[l.id]; return r?.checked ? { lineId: l.id, checked: true } : { lineId: l.id, qtyReceived: r?.qty === '' || r?.qty == null ? undefined : Number(r.qty), discrepancyNote: r?.note || undefined }; }) }), onSuccess: inv });
  const resolve = useMutation({ mutationFn: (resolution: string) => api.post(`/api/transfers/${id}/resolve`, { resolution }), onSuccess: inv });
  const [editing, setEditing] = useState(false); const [msg, setMsg] = useState('');
  const isSender = !!q.data && (!me!.locationScoped || me!.locations.some((l) => l.id === q.data!.fromLocation.id) || q.data.preparedBy === me!.id);
  const rights = useEditRights(q.data ?? { status: '' }, 'transfer.create', isSender);
  const d = q.data; if (!d) return null;
  const draft = d.status === 'DRAFT'; const sfx = draft ? '-DRAFT' : '';
  const isReceiver = me!.locations.some((l) => l.id === d.toLocation.id) || !me!.locationScoped;
  const receiving = d.status === 'APPROVED' && isReceiver && can('transfer.confirm');
  const allTicked = d.lines.length > 0 && d.lines.every((l) => recv[l.id]?.checked);
  const lineReady = (l: Tr['lines'][number]) => { const r = recv[l.id]; if (r?.checked) return true; if (!r || r.qty === '') return false; return Number(r.qty) >= l.qtySent || !!r.note.trim(); };
  const setLine = (lineId: string, patch: Partial<{ checked: boolean; qty: string; note: string }>) => setRecv((cur) => ({ ...cur, [lineId]: { ...{ checked: false, qty: '', note: '' }, ...cur[lineId], ...patch } }));
  return <div className="mx-auto max-w-4xl space-y-4">
    <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">{d.controlNo}</h1><Badge tone={statusTone(d.status)}>{d.status}</Badge><Badge>{d.transferType}</Badge><span className="ml-auto flex flex-wrap gap-2">
      {rights.canEdit && !editing && <Button size="sm" onClick={() => { setEditing(true); setMsg(''); }}>{rights.own ? 'Edit draft' : 'Propose edit'}</Button>}
      {isSender && <><Button size="sm" variant="outline" onClick={() => api.download(`/api/reports/forms/pull-out/${d.id}.pdf`, `PullOut-${d.controlNo}${sfx}.pdf`)}>{draft ? 'Print Pull-Out (draft)' : 'Pull-Out form'}</Button><Button size="sm" variant="outline" onClick={() => api.download(`/api/reports/forms/pull-out/${d.id}.xlsx`, `PullOut-${d.controlNo}${sfx}.xlsx`)}>xlsx</Button></>}
      <Button size="sm" variant="outline" onClick={() => api.download(`/api/reports/forms/transfer-in/${d.id}.pdf`, `TransferIn-${d.controlNo}${sfx}.pdf`)}>{draft ? 'Print Transfer-In (draft)' : isSender ? 'Transfer-In form' : 'Transfer-In copy'}</Button>
    </span></div>
    <p className="text-sm text-slate-600">Prepared by <b>{d.preparedByName ?? '—'}</b>{d.receivedByName ? <> · received by <b>{d.receivedByName}</b></> : null}{draft ? ' · Draft: print and check it, edit if needed, then submit for approval.' : ''}{!isSender && !draft ? ' · This is your copy from the sending location.' : ''}</p>
    {msg && <p className="rounded bg-green-50 p-2 text-sm text-green-800">{msg}</p>}
    {editing && <TransferEditor doc={d} own={rights.own} preparedByName={d.preparedByName} onClose={(m) => { setEditing(false); if (m) setMsg(m); }} />}
    <EditRequests kind="transfers" id={d.id} />
    <Card><dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">{[['Date', fmtDate(d.docDate)], ['From', d.fromLocation.name], ['Trans. To', d.toLocation.name], ['Notes', d.notes ?? '—']].map(([k, v]) => <div key={k}><dt className="text-xs uppercase text-slate-500">{k}</dt><dd>{v}</dd></div>)}</dl></Card>
    <Card title={receiving ? 'Accept the items: tick each line that arrived complete' : 'Lines'}>
      {receiving && <label className="mb-2 flex items-center gap-2 rounded-md bg-emerald-50 p-2 text-sm font-medium text-emerald-900"><input type="checkbox" data-testid="tick-all" checked={allTicked} onChange={(e) => setRecv(Object.fromEntries(d.lines.map((l) => [l.id, { checked: e.target.checked, qty: '', note: '' }])))} /> Tick all — everything arrived complete and correct</label>}
      <table className="w-full text-sm [&_td]:px-2 [&_td]:py-1 [&_th]:px-2"><thead className="text-left text-xs text-slate-500"><tr>{receiving && <th className="w-10">OK</th>}<th>Items</th><th>Batch / expiry</th><th className="num">Qty out</th><th className="num">Received qty</th><th>Remarks</th></tr></thead><tbody>{d.lines.map((l) => { const r = recv[l.id]; return <tr key={l.id} className={`border-t ${receiving && r?.checked ? 'bg-emerald-50' : ''}`}>
        {receiving && <td><input type="checkbox" aria-label={`${l.product.name} received complete`} checked={!!r?.checked} onChange={(e) => setLine(l.id, { checked: e.target.checked })} /></td>}
        <td>{l.product.name}</td><td className="text-xs text-slate-500">{l.batch.batchNo ?? '—'} {fmtDate(l.batch.expiryDate)}</td><td className="num">{l.qtySent}</td>
        <td>{receiving ? (r?.checked ? <span className="num block">{l.qtySent}</span> : <Input type="number" min={0} max={l.qtySent} className="w-24" placeholder="count" value={r?.qty ?? ''} onChange={(e) => setLine(l.id, { qty: e.target.value })} />) : <span className="num block">{l.qtyReceived ?? '—'}</span>}</td>
        <td>{receiving ? (r?.checked ? <span className="text-xs text-emerald-800">complete</span> : <Input placeholder="what is wrong (required if short)" value={r?.note ?? ''} onChange={(e) => setLine(l.id, { note: e.target.value })} />) : l.discrepancyNote ?? l.checkerRemarks ?? ''}</td>
      </tr>; })}</tbody></table>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {d.status === 'DRAFT' && isSender && can('transfer.create') && (d.preparedBy === me!.id || !me!.locationScoped) && <Button onClick={() => submit.mutate()}>Submit for approval</Button>}
        {receiving && <><Button disabled={!d.lines.every(lineReady) || confirm.isPending} onClick={() => confirm.mutate()}>Confirm receipt</Button><span className="text-xs text-slate-500">{d.lines.filter(lineReady).length} of {d.lines.length} lines done</span></>}
        {d.status === 'DISCREPANCY' && can('transfer.resolve_discrepancy') && <><span className="self-center text-sm">Resolve shortfall:</span><Button variant="outline" onClick={() => resolve.mutate('TO_SENDER')}>Back to sender</Button><Button variant="outline" onClick={() => resolve.mutate('TO_RECEIVER')}>Give to receiver</Button><Button variant="danger" onClick={() => resolve.mutate('WRITEOFF')}>Write off</Button></>}
      </div>
      <ErrorBox error={submit.error || confirm.error || resolve.error} />
    </Card>
    <Attachments type="TransferDoc" id={d.id} />
    <History entityType="TransferDoc" id={d.id} />
  </div>;
}
