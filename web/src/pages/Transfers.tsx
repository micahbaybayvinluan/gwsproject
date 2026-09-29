import { ApprovalTimeline } from '@/components/ApprovalTimeline';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Field, Input, Select, statusTone } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';
import { Attachments } from '@/components/Attachments';
import { CorrectionRequest, EditRequests, History, TransferEditor, useEditRights } from '@/components/DocEdits';

interface Tr { pendingReceipt?: unknown; id: string; controlNo: string; docDate: string; status: string; transferType: string; notes: string | null; preparedBy?: string; preparedByName?: string | null; receivedByName?: string | null; fromLocation: { id: string; name: string; type: string }; toLocation: { id: string; name: string; type: string }; lines: { id: string; qtySent: number; qtyReceived: number | null; discrepancyNote: string | null; checkerRemarks: string | null; product: { name: string; sku: string }; batch: { batchNo: string | null; expiryDate: string | null } }[] }

/** §7.3 Pull-Out (sender) / Transfer-In (receiver): one document, two views. */
export function TransfersPage() {
  const nav = useNavigate(); const { me, can } = useAuth(); const qc = useQueryClient(); const [sp] = useSearchParams();
  const [direction, setDirection] = useState(sp.get('direction') ?? '');
  const q = useQuery({ queryKey: ['transfers', direction], queryFn: () => api.get<Tr[]>(`/api/transfers${direction ? `?direction=${direction}` : ''}`) });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; type: string; code: string }[]>('/api/locations') });
  const own = me!.locations[0];
  const [f, setF] = useState({ fromLocationId: '', toLocationId: '', transferType: 'RESTOCK', returnReason: '', notes: '' });
  const [lines, setLines] = useState<{ productId: string; name: string; qty: number }[]>([]); const [search, setSearch] = useState('');
  // Warehouse staff send from their warehouse to any branch / franchise / consignee; branch staff request from the warehouse to their branch.
  const warehouseUser = me!.locations.some((l) => l.type === 'WAREHOUSE');
  // a branch account always sends from its own branch ("From" is fixed); only "To" is chosen
  const from = me!.locationScoped ? own?.id ?? '' : f.fromLocationId; const to = f.toLocationId || (sp.get('to') && sp.get('to') !== from ? sp.get('to')! : '');
  const products = useQuery({ queryKey: ['products', search], queryFn: () => api.get<{ id: string; name: string; sku: string }[]>(`/api/products?search=${encodeURIComponent(search)}&take=20`), enabled: search.length >= 2 });
  const avail = useQuery({ queryKey: ['wh-avail', lines.map((l) => l.productId).join()], queryFn: () => api.get<{ productId: string; qty: number }[]>(`/api/stock/warehouse-availability?productIds=${lines.map((l) => l.productId).join(',')}`), enabled: lines.length > 0 });
  const m = useMutation({ mutationFn: () => api.post<{ id: string }>('/api/transfers', { fromLocationId: from, toLocationId: to, transferType: f.transferType, returnReason: f.returnReason || undefined, notes: f.notes, lines: lines.map((l) => ({ productId: l.productId, qty: l.qty })) }), onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['transfers'] }); nav(`/transfers/${r.id}`); } });
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Transfers & Pull-outs</h1><Field label="View"><Select value={direction} onChange={(e) => setDirection(e.target.value)}><option value="">All</option><option value="out">Outgoing (Pull-Out)</option><option value="in">Incoming (Transfer-In)</option></Select></Field></div>
    {me!.locationScoped && !warehouseUser && (can('transfer.confirm') || can('transfer.create')) && <StockRequestCard />}
    {can('transfer.create') && <Card title={warehouseUser ? 'Send stock from the warehouse (to a branch, franchise or consignee)' : me!.locationScoped ? `Pull-out from ${own?.name ?? 'my branch'} (return to warehouse or send to another branch)` : 'New transfer'}>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="From">{me!.locationScoped ? <div className="flex min-h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-medium" data-testid="from-fixed">{own?.name ?? '—'}</div> : <Select value={from} onChange={(e) => setF({ ...f, fromLocationId: e.target.value })}><option value="">—</option>{locations.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>}</Field>
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
  // items that arrived but are not on the form (or more than the form says)
  const [extras, setExtras] = useState<{ productId: string; name: string; qty: number; note: string }[]>([]);
  const inv = () => { void qc.invalidateQueries({ queryKey: ['transfer', id] }); void qc.invalidateQueries({ queryKey: ['transfers'] }); void qc.invalidateQueries({ queryKey: ['approvals-count'] }); void qc.invalidateQueries({ queryKey: ['history'] }); };
  const submit = useMutation({ mutationFn: () => api.post(`/api/transfers/${id}/submit`), onSuccess: inv });
  const confirm = useMutation({ mutationFn: () => api.post(`/api/transfers/${id}/confirm`, { lines: (q.data?.lines ?? []).map((l) => { const r = recv[l.id]; return r?.checked ? { lineId: l.id, checked: true } : { lineId: l.id, qtyReceived: r?.qty === '' || r?.qty == null ? undefined : Number(r.qty), discrepancyNote: r?.note || undefined }; }), extras: extras.map((e) => ({ productId: e.productId, qty: e.qty, note: e.note || undefined })) }), onSuccess: () => { setExtras([]); inv(); void qc.invalidateQueries({ queryKey: ['transfer-diff', id] }); } });
  const resolve = useMutation({ mutationFn: (resolution: string) => api.post(`/api/transfers/${id}/resolve`, { resolution }), onSuccess: inv });
  const [editing, setEditing] = useState(false); const [msg, setMsg] = useState('');
  const isSender = !!q.data && (!me!.locationScoped || me!.locations.some((l) => l.id === q.data!.fromLocation.id) || q.data.preparedBy === me!.id);
  const rights = useEditRights(q.data ?? { status: '' }, 'transfer.create', isSender);
  const diff = useQuery({ queryKey: ['transfer-diff', id], queryFn: () => api.get<Diff | null>(`/api/transfers/${id}/discrepancy`), enabled: !!q.data && ['DISCREPANCY', 'RESOLVED'].includes(q.data.status) });
  const d = q.data; if (!d) return null;
  const draft = d.status === 'DRAFT'; const sfx = draft ? '-DRAFT' : '';
  const isReceiver = me!.locations.some((l) => l.id === d.toLocation.id) || !me!.locationScoped;
  const receiving = d.status === 'APPROVED' && !d.pendingReceipt && isReceiver && can('transfer.confirm');
  const allTicked = d.lines.length > 0 && d.lines.every((l) => recv[l.id]?.checked);
  const lineReady = (l: Tr['lines'][number]) => { const r = recv[l.id]; if (r?.checked) return true; if (!r || r.qty === '') return false; return Number(r.qty) >= l.qtySent || !!r.note.trim(); };
  const setLine = (lineId: string, patch: Partial<{ checked: boolean; qty: string; note: string }>) => setRecv((cur) => ({ ...cur, [lineId]: { ...{ checked: false, qty: '', note: '' }, ...cur[lineId], ...patch } }));
  return <div className="mx-auto max-w-4xl space-y-4">
    <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold tracking-tight text-navy">{d.controlNo}</h1><Badge tone={statusTone(d.status)}>{d.status}</Badge>{!!d.pendingReceipt && <Badge tone="amber">Received · waiting for the In-Charge</Badge>}<Badge>{d.transferType}</Badge><span className="ml-auto flex flex-wrap gap-2">
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
        {receiving && <ExtraItems extras={extras} setExtras={setExtras} />}
        {receiving && <><Button disabled={!d.lines.every(lineReady) || confirm.isPending} onClick={() => confirm.mutate()}>Confirm receipt</Button><span className="text-xs text-slate-500">{d.lines.filter(lineReady).length} of {d.lines.length} lines done</span></>}
        {d.status === 'DISCREPANCY' && can('transfer.resolve_discrepancy') && !diff.data && <><span className="self-center text-sm">Resolve shortfall:</span><Button variant="outline" onClick={() => resolve.mutate('TO_SENDER')}>Back to sender</Button><Button variant="outline" onClick={() => resolve.mutate('TO_RECEIVER')}>Give to receiver</Button><Button variant="danger" onClick={() => resolve.mutate('WRITEOFF')}>Write off</Button></>}
      </div>
      <ErrorBox error={submit.error || confirm.error || resolve.error} />
    </Card>
    {diff.data && <DiscrepancyPanel diff={diff.data} transferId={d.id} fromName={d.fromLocation.name} fromId={d.fromLocation.id} toName={d.toLocation.name} onChange={() => { inv(); void qc.invalidateQueries({ queryKey: ['transfer-diff', id] }); }} />}
    <Attachments type="TransferDoc" id={d.id} />
    {!draft && d.status !== 'VOIDED' && can('revision.request') && <CorrectionRequest documentType="TransferDoc" documentId={d.id} fields={[{ key: 'notes', label: 'Notes / remarks', current: d.notes }]} />}
    <ApprovalTimeline documentType="TransferDoc" documentId={d.id} />
    <History entityType="TransferDoc" id={d.id} />
  </div>;
}

/** Branch staff ask the warehouse for stock; the warehouse prepares the transfer and the branch only receives it (owner request 2026-09-26). */
function StockRequestCard() {
  const [items, setItems] = useState<{ productId: string; name: string; qty: number }[]>([]); const [search, setSearch] = useState(''); const [notes, setNotes] = useState('');
  const products = useQuery({ queryKey: ['products', search], queryFn: () => api.get<{ id: string; name: string; sku: string }[]>(`/api/products?search=${encodeURIComponent(search)}&take=20`), enabled: search.length >= 2 });
  const m = useMutation({ mutationFn: () => api.post<{ items: string }>('/api/transfers/request-stock', { items: items.map((i) => ({ productId: i.productId, qty: i.qty })), notes: notes || undefined }), onSuccess: () => { setItems([]); setNotes(''); } });
  return <Card title="Request stock from the warehouse">
    <p className="mb-2 text-sm text-slate-600">The warehouse is notified and prepares the transfer. You do not make a form: the Transfer-In copy appears under Incoming for you to check and receive.</p>
    <Input placeholder="Add product…" value={search} onChange={(e) => setSearch(e.target.value)} />{search.length >= 2 && <ul className="max-h-48 divide-y overflow-auto rounded border bg-white">{products.data?.map((p) => <li key={p.id}><button className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setItems([...items, { productId: p.id, name: p.name, qty: 1 }]); setSearch(''); }}>{p.name} <span className="text-xs text-slate-500">{p.sku}</span></button></li>)}</ul>}
    {items.length > 0 && <table className="mt-2 w-full text-sm"><tbody>{items.map((l, i) => <tr key={i} className="border-t"><td>{l.name}</td><td><Input type="number" min={1} className="w-24" value={l.qty} onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, qty: Number(e.target.value) } : x)))} /></td><td><button className="text-red-600" onClick={() => setItems(items.filter((_, k) => k !== i))}>✕</button></td></tr>)}</tbody></table>}
    <Field label="Notes" className="mt-2"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    <Button className="mt-2" disabled={!items.length || items.some((i) => !(i.qty > 0)) || m.isPending} onClick={() => m.mutate()}>Send request to the warehouse</Button>
    {m.isSuccess && <p className="mt-2 text-sm text-emerald-700">Request sent: {m.data.items}</p>}<ErrorBox error={m.error} />
  </Card>;
}

/** Receiving: items that arrived but are not on the form (or more than the form says). */
function ExtraItems({ extras, setExtras }: { extras: { productId: string; name: string; qty: number; note: string }[]; setExtras: (x: { productId: string; name: string; qty: number; note: string }[]) => void }) {
  const [open, setOpen] = useState(false); const [search, setSearch] = useState('');
  const products = useQuery({ queryKey: ['products', search], queryFn: () => api.get<{ id: string; name: string; sku: string }[]>(`/api/products?search=${encodeURIComponent(search)}&take=15`), enabled: search.length >= 2 });
  if (!open && !extras.length) return <button className="w-full text-left text-sm text-brand underline" onClick={() => setOpen(true)}>+ An item arrived that is not on the form (or more than the form says)</button>;
  return <div className="w-full rounded-xl border border-amber-200 bg-amber-50 p-3">
    <div className="mb-2 text-sm font-semibold text-amber-900">Items received but not on the form</div>
    <Input placeholder="Type the product name or SKU…" value={search} onChange={(e) => setSearch(e.target.value)} />
    {search.length >= 2 && <ul className="mt-1 max-h-40 divide-y overflow-auto rounded border bg-white text-sm">{products.data?.map((p) => <li key={p.id}><button className="w-full px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => { if (!extras.some((x) => x.productId === p.id)) setExtras([...extras, { productId: p.id, name: p.name, qty: 1, note: '' }]); setSearch(''); }}>{p.name} <span className="text-xs text-slate-500">{p.sku}</span></button></li>)}</ul>}
    {extras.length > 0 && <table className="mt-2 w-full text-sm [&_td]:px-2 [&_td]:py-1"><tbody>{extras.map((x, i) => <tr key={x.productId} className="border-t border-amber-200"><td>{x.name}</td><td><Input type="number" min={1} className="w-20" value={x.qty} onChange={(e) => setExtras(extras.map((y, k) => (k === i ? { ...y, qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) } : y)))} /></td><td><Input placeholder="note (e.g. wrong item packed)" value={x.note} onChange={(e) => setExtras(extras.map((y, k) => (k === i ? { ...y, note: e.target.value } : y)))} /></td><td><button className="text-red-600" onClick={() => setExtras(extras.filter((_, k) => k !== i))}>✕</button></td></tr>)}</tbody></table>}
  </div>;
}

interface Diff { id: string; status: 'HEAD_AUDITOR' | 'SENDER' | 'ADMIN' | 'RESOLVED'; controlNo: string; lines: { productId: string; name: string; onForm: number; received: number; short: number; extra: number; note?: string | null }[]; senderDueAt: string | null; history: { step: string; byName: string; decision: string; note?: string | null; at: string }[]; outcome: string | null; outcomeLabel: string | null; adjustmentForms: { id: string; controlNo: string; fromLocation: { name: string }; toLocation: { name: string } }[]; pendingRequestId: string | null; canAct: boolean; senderDays: number; chargeFormId: string | null }

/** The difference between the form and what arrived, and its steps: Head Auditor → sending branch (2 days) → Owner if they disagree. */
function DiscrepancyPanel({ diff, transferId, fromName, fromId, toName, onChange }: { diff: Diff; transferId: string; fromName: string; fromId: string; toName: string; onChange: () => void }) {
  const { me } = useAuth(); const [note, setNote] = useState(''); const [staffIds, setStaffIds] = useState<string[]>([]); const [charge, setCharge] = useState(false);
  const decide = useMutation({ mutationFn: (decision: 'APPROVE' | 'REJECT') => api.post(`/api/approvals/${diff.pendingRequestId}/decide`, { decision, note: note || undefined }), onSuccess: () => { setNote(''); onChange(); } });
  const owner = useMutation({ mutationFn: (outcome: string) => api.post(`/api/transfers/${transferId}/discrepancy/decide`, { outcome, note: note || undefined, employeeIds: outcome === 'LOST_CHARGE' ? staffIds : undefined }), onSuccess: onChange });
  const staff = useQuery({ queryKey: ['staff', fromId], queryFn: () => api.get<{ id: string; fullName: string }[]>(`/api/staff?locationId=${fromId}`), enabled: charge });
  const steps: { key: Diff['status']; label: string }[] = [{ key: 'HEAD_AUDITOR', label: '1. Head Auditor reviews' }, { key: 'SENDER', label: `2. ${fromName} confirms (${diff.senderDays} days)` }, { key: 'ADMIN', label: '3. Owner decides (if they disagree)' }, { key: 'RESOLVED', label: 'Done' }];
  const at = steps.findIndex((x) => x.key === diff.status);
  const isOwnerStep = diff.status === 'ADMIN' && me!.roleKey === 'ADMIN';
  return <Card title={<span className="flex items-center gap-2">Difference between the form and what arrived <Badge tone={diff.status === 'RESOLVED' ? 'green' : 'amber'}>{diff.status === 'RESOLVED' ? 'Settled' : 'Open'}</Badge></span>}>
    <ol className="mb-3 flex flex-wrap gap-2 text-xs">{steps.map((x, i) => <li key={x.key} className={`rounded-full px-3 py-1 font-semibold ${i < at ? 'bg-emerald-100 text-emerald-800' : i === at ? 'bg-navy text-white' : 'bg-slate-100 text-slate-500'}`}>{x.label}</li>)}</ol>
    <table className="w-full text-sm [&_td]:px-2 [&_td]:py-1 [&_th]:px-2"><thead className="text-left text-xs text-slate-500"><tr><th>Item</th><th className="text-right">On the form</th><th className="text-right">Received</th><th className="text-right">Difference</th><th>Note</th></tr></thead><tbody>{diff.lines.map((l) => <tr key={l.productId} className="border-t"><td>{l.name}</td><td className="text-right">{l.onForm}</td><td className="text-right">{l.received}</td><td className="text-right font-semibold">{l.short ? <span className="text-red-700">{l.short} short</span> : null}{l.extra ? <span className="text-amber-700">{l.extra} extra</span> : null}</td><td className="text-xs text-slate-600">{l.note}</td></tr>)}</tbody></table>
    {diff.status === 'SENDER' && diff.senderDueAt && <p className="mt-2 text-sm text-amber-800">{fromName} must answer by <b>{new Date(diff.senderDueAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}</b>; after that the Owner decides.</p>}
    {diff.canAct && diff.status !== 'ADMIN' && <div className="mt-3 rounded-xl border bg-slate-50 p-3">
      <p className="mb-2 text-sm">{diff.status === 'HEAD_AUDITOR' ? <>Is the difference real? <b>Confirm</b> sends it to {fromName} to confirm. <b>Receiver miscounted</b> gives {toName} the items as on the form.</> : <>{toName} did not receive what the form says, and the Head Auditor confirmed it. <b>Agree</b>: an adjustment form ({diff.controlNo}-002) is made automatically. <b>Disagree</b>: the Owner decides.</>}</p>
      <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={diff.status === 'SENDER' ? 'e.g. found it on the shelf / we packed all items' : 'what you checked'} /></Field>
      <div className="mt-2 flex flex-wrap gap-2"><Button onClick={() => decide.mutate('APPROVE')} disabled={decide.isPending}>{diff.status === 'HEAD_AUDITOR' ? 'Confirm the difference' : 'Agree'}</Button><Button variant="outline" onClick={() => decide.mutate('REJECT')} disabled={decide.isPending || (diff.status === 'SENDER' && !note.trim())}>{diff.status === 'HEAD_AUDITOR' ? 'Receiver miscounted' : 'Disagree (explain in the note)'}</Button></div>
    </div>}
    {isOwnerStep && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3">
      <p className="mb-2 text-sm font-semibold text-red-900">Your decision</p>
      <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button onClick={() => owner.mutate('RETURN_TO_SENDER')}>Difference stands: adjustment form back to {fromName}</Button>
        <Button variant="outline" onClick={() => owner.mutate('RECEIVED_AS_SENT')}>{toName} received it after all</Button>
        <Button variant="outline" onClick={() => owner.mutate('LOST_COMPANY')}>Lost: company expense</Button>
        <Button variant="danger" onClick={() => setCharge(!charge)}>Lost: charge to staff…</Button>
      </div>
      {charge && <div className="mt-2 flex flex-wrap items-center gap-3">{staff.data?.map((e) => <label key={e.id} className="inline-flex items-center gap-1 text-sm"><input type="checkbox" checked={staffIds.includes(e.id)} onChange={(ev) => setStaffIds(ev.target.checked ? [...staffIds, e.id] : staffIds.filter((x) => x !== e.id))} />{e.fullName}</label>)}<Button size="sm" variant="danger" disabled={!staffIds.length} onClick={() => owner.mutate('LOST_CHARGE')}>Charge the ticked staff</Button></div>}
    </div>}
    <ErrorBox error={decide.error ?? owner.error} />
    {diff.outcomeLabel && <p className="mt-3 text-sm font-semibold text-emerald-800">{diff.outcomeLabel}</p>}
    {diff.adjustmentForms.length > 0 && <div className="mt-1 flex flex-wrap gap-2 text-sm">Adjustment forms: {diff.adjustmentForms.map((f) => <Link key={f.id} className="text-brand underline" to={`/transfers/${f.id}`}>{f.controlNo} ({f.fromLocation.name} → {f.toLocation.name})</Link>)}</div>}
    <ul className="mt-3 space-y-1 border-t pt-2 text-xs text-slate-600">{diff.history.map((h, i) => <li key={i}>{new Date(h.at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })} · <b>{h.byName}</b> · {h.decision}{h.note ? ` — “${h.note}”` : ''}</li>)}</ul>
  </Card>;
}
