import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, fmtDate, peso } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, Select } from '@/components/ui/primitives';
import { Segmented } from '@/components/ui/widgets';
import { Photo, PhotoRow } from '@/components/Photo';
import { OutletMap, type Pin } from '@/components/OutletMap';

export interface OutletRow {
  id: string; name: string; outletType: string; address: string | null; city: string | null; area: { id: string; name: string } | null; agentKey: string; agentName: string; shares: { agentKey: string; agentName: string }[];
  contactName: string | null; phone: string | null; email: string | null; notes: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED'; stage: string; lat: number | null; lng: number | null; rejectReason: string | null;
  photoId: string | null; photoCount: number; pendingChanges: number; lastOrder: string | null; orderCount: number; orders3m: number; sales3m: number; lastVisit: string | null;
}
interface Detail extends OutletRow {
  photos: { id: string; createdAt: string }[];
  visits: { id: string; date: string; agent: string; status: string; note: string | null; visitedAt: string | null; lat: number | null; lng: number | null; shelfStatus: string | null; competitors: string | null; photos: { id: string; createdAt: string }[] }[];
  orders: { id: string; drSiNo: string; date: string; branch: string; agent: string | null; amount: number; balance: number; paymentMode: string }[];
  changes: { id: string; changes: Record<string, { from: unknown; to: unknown }>; status: string; requestedByName: string; createdAt: string; reason: string | null }[];
}
interface Area { id: string; name: string; notes: string | null; agentKey: string | null; agentName: string | null; active: boolean; outlets: number; pending: number }
interface AgentP { key: string; name: string }

export const STAGE: Record<string, string> = { PROSPECT: 'Prospect', VISITED: 'Visited', SAMPLE_GIVEN: 'Sample given', FIRST_ORDER: 'First order', REGULAR: 'Regular customer' };
const STAGE_TONE: Record<string, 'slate' | 'blue' | 'amber' | 'green' | 'purple'> = { PROSPECT: 'slate', VISITED: 'blue', SAMPLE_GIVEN: 'amber', FIRST_ORDER: 'green', REGULAR: 'purple' };
const FIELD: Record<string, string> = { name: 'Name', outletType: 'Type', address: 'Address', city: 'City', contactName: 'Contact person', phone: 'Phone', email: 'Email', notes: 'Notes', areaId: 'Area' };
const TYPES = ['GYM', 'STORE', 'PHARMACY', 'OTHER'];
const qs = (o: Record<string, string | undefined>) => { const p = Object.entries(o).filter(([, v]) => v); return p.length ? `?${p.map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&')}` : ''; };

const downloadTemplate = () => {
  const csv = 'Name,Type,Address,City,Contact person,Phone,Email,Notes\nIron Temple Gym,GYM,123 Sample St.,Quezon City,Juan Dela Cruz,09171234567,juan@example.com,Opens 6am\n';
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'GWS-outlets-template.csv'; a.click(); URL.revokeObjectURL(a.href);
};

/** Outlets / gyms of the agents: upload, pictures and contact details, approval by the Sales Manager, areas, map and pipeline. */
export function OutletsPage() {
  const { can } = useAuth(); const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const manager = can('outlet.manage'); const viewAll = manager || can('outlet.view.all'); const agent = can('agent.self');
  const [tab, setTab] = useState<'list' | 'pending' | 'changes' | 'areas' | 'map' | 'pipeline'>(sp.get('status') === 'PENDING' ? 'pending' : sp.get('changes') ? 'changes' : 'list');
  const [f, setF] = useState({ agentKey: '', areaId: '', stage: '', search: '' });
  const [open, setOpen] = useState<string | null>(sp.get('id')); const [adding, setAdding] = useState(false); const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const agents = useQuery({ queryKey: ['field-agents'], queryFn: () => api.get<AgentP[]>('/api/field/agents'), enabled: viewAll });
  const areas = useQuery({ queryKey: ['field-areas'], queryFn: () => api.get<Area[]>('/api/field/areas') });
  const status = tab === 'pending' ? 'PENDING' : 'APPROVED';
  const list = useQuery({ queryKey: ['outlets', f, status, tab], queryFn: () => api.get<OutletRow[]>(`/api/field/outlets${qs({ ...f, status: tab === 'list' || tab === 'pending' ? (tab === 'pending' ? 'PENDING' : undefined) : status })}`), enabled: tab === 'list' || tab === 'pending' });
  const changes = useQuery({ queryKey: ['outlet-changes'], queryFn: () => api.get<{ id: string; changes: Detail['changes'][0]['changes']; requestedByName: string; createdAt: string; outlet: { id: string; name: string; agentName: string } }[]>('/api/field/outlets/changes'), enabled: manager });
  const pins = useQuery({ queryKey: ['outlet-map', f.agentKey, f.areaId], queryFn: () => api.get<Pin[]>(`/api/field/outlets/map${qs({ agentKey: f.agentKey, areaId: f.areaId })}`), enabled: tab === 'map' });
  const pipeline = useQuery({ queryKey: ['outlet-pipeline'], queryFn: () => api.get<{ stages: string[]; agents: ({ agentKey: string; agentName: string; total: number } & Record<string, number | string>)[] }>('/api/field/outlets/pipeline'), enabled: tab === 'pipeline' });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['outlets'] }); void qc.invalidateQueries({ queryKey: ['outlet-changes'] }); void qc.invalidateQueries({ queryKey: ['field-areas'] }); void qc.invalidateQueries({ queryKey: ['outlet-detail'] }); };
  const upload = useMutation({ mutationFn: (file: File) => api.upload<{ message: string; skipped: string[]; errors: string[] }>(`/api/field/outlets/import${qs({ agentKey: f.agentKey })}`, file), onSuccess: (r) => { setMsg([r.message, r.skipped.length ? `Skipped: ${r.skipped.slice(0, 8).join(', ')}${r.skipped.length > 8 ? '…' : ''}` : '', ...r.errors.slice(0, 5)].filter(Boolean).join(' · ')); refresh(); } });
  const [sel, setSel] = useState<string[]>([]); const [reason, setReason] = useState('');
  const decide = useMutation({ mutationFn: (action: 'APPROVE' | 'REJECT') => api.post('/api/field/outlets/decide', { ids: sel, action, reason: reason || undefined }), onSuccess: () => { setSel([]); setReason(''); refresh(); } });
  const decideChange = useMutation({ mutationFn: (v: { id: string; action: 'APPROVE' | 'REJECT'; reason?: string }) => api.post(`/api/field/outlets/changes/${v.id}`, { action: v.action, reason: v.reason }), onSuccess: refresh });
  const pending = list.data?.filter((o) => o.status === 'PENDING') ?? [];
  const pinPick = useCallback((id: string) => setOpen(id), []);
  const tabs: [typeof tab, string][] = [['list', 'Outlets'], ...(manager ? [['pending', 'Waiting for approval'] as [typeof tab, string], ['changes', `Change requests${changes.data?.length ? ` (${changes.data.length})` : ''}`] as [typeof tab, string]] : agent ? [['pending', 'Waiting for approval'] as [typeof tab, string]] : []), ['areas', 'Areas'], ['map', 'Map'], ['pipeline', 'Pipeline']];
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Outlets</h1>
      {(agent || manager) && <><Button onClick={() => setAdding(true)}>+ Add an outlet</Button><Button variant="outline" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>{upload.isPending ? 'Uploading…' : 'Upload Excel / CSV'}</Button><Button variant="ghost" onClick={downloadTemplate}>Template</Button>
        <input ref={fileRef} type="file" hidden accept=".xlsx,.csv" onChange={(e) => { const file = e.target.files?.[0]; if (file) { setMsg(''); upload.mutate(file); } e.target.value = ''; }} /></>}
    </div>
    {msg && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{msg}</p>}<ErrorBox error={upload.error} />
    <Segmented value={tab} onChange={(t) => { setTab(t); setSp({}); }} options={tabs} />
    {(tab === 'list' || tab === 'map' || tab === 'pending') && <div className="grid gap-2 md:grid-cols-4">
      <Input placeholder="Search name, address, contact, agent…" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
      {viewAll && <Select value={f.agentKey} onChange={(e) => setF({ ...f, agentKey: e.target.value })}><option value="">All agents</option>{agents.data?.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}</Select>}
      <Select value={f.areaId} onChange={(e) => setF({ ...f, areaId: e.target.value })}><option value="">All areas</option>{areas.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
      {tab === 'list' && <Select value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}><option value="">All stages</option>{Object.entries(STAGE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}
    </div>}
    {tab === 'list' && (list.data?.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{list.data.map((o) => <OutletCard key={o.id} o={o} onOpen={() => setOpen(o.id)} />)}</div> : <Card><Empty>{agent ? 'No outlets yet. Add one, or upload your Excel / CSV list; the Sales Manager approves them.' : 'No outlets found.'}</Empty></Card>)}
    {tab === 'pending' && <Card title="Waiting for the Sales Manager's approval">
      {manager && pending.length > 0 && <div className="mb-3 flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" onClick={() => setSel(sel.length === pending.length ? [] : pending.map((p) => p.id))}>{sel.length === pending.length ? 'Untick all' : 'Tick all'}</Button><Button size="sm" disabled={!sel.length || decide.isPending} onClick={() => decide.mutate('APPROVE')}>Approve {sel.length || ''}</Button><Input className="max-w-xs" placeholder="Reason (needed to reject)" value={reason} onChange={(e) => setReason(e.target.value)} /><Button size="sm" variant="danger" disabled={!sel.length || !reason.trim() || decide.isPending} onClick={() => decide.mutate('REJECT')}>Reject</Button></div>}
      <ErrorBox error={decide.error} />
      {pending.length ? <ul className="divide-y">{pending.map((o) => <li key={o.id} className="flex items-center gap-3 py-2">{manager && <input type="checkbox" className="h-5 w-5" checked={sel.includes(o.id)} onChange={() => setSel(sel.includes(o.id) ? sel.filter((x) => x !== o.id) : [...sel, o.id])} />}<Photo id={o.photoId} className="h-12 w-12" /><button className="flex-1 text-left" onClick={() => setOpen(o.id)}><div className="font-medium">{o.name} <span className="text-xs text-slate-500">· {o.outletType}</span></div><div className="text-xs text-slate-500">{[o.address, o.city].filter(Boolean).join(', ')} · {o.agentName}{o.contactName ? ` · ${o.contactName}` : ''}{o.phone ? ` · ${o.phone}` : ''}</div></button></li>)}</ul> : <Empty>Nothing is waiting.</Empty>}
      {agent && !manager && <p className="mt-2 text-xs text-slate-500">An outlet can be tagged on a sale or put in your itinerary only after the Sales Manager approves it. A rejected outlet shows the reason on its card (Outlets tab).</p>}
    </Card>}
    {tab === 'changes' && manager && <Card title="Changes the agents asked for (the Owner is told of every change that is approved)">
      {changes.data?.length ? <ul className="divide-y">{changes.data.map((c) => <ChangeRow key={c.id} c={c} onDecide={(action, r) => decideChange.mutate({ id: c.id, action, reason: r })} />)}</ul> : <Empty>No change requests.</Empty>}<ErrorBox error={decideChange.error} />
    </Card>}
    {tab === 'areas' && <AreasTab areas={areas.data ?? []} agents={agents.data ?? []} manager={manager} onSaved={refresh} />}
    {tab === 'map' && <Card title="Where the outlets are">{pins.data ? <><p className="mb-2 text-xs text-slate-500">{pins.data.length} outlets with a location (from the first visit's GPS or typed). Needs internet for the map.</p><OutletMap pins={pins.data} onPick={pinPick} /></> : <Empty>Loading…</Empty>}</Card>}
    {tab === 'pipeline' && <Card title="Pipeline: how far each agent's outlets have come">{pipeline.data?.agents.length ? <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Agent</th>{pipeline.data.stages.map((s) => <th key={s} className="num">{STAGE[s]}</th>)}<th className="num">Total</th></tr></thead><tbody>{pipeline.data.agents.map((a) => <tr key={a.agentKey} className="border-t"><td className="py-2 font-medium">{a.agentName}</td>{pipeline.data!.stages.map((s) => <td key={s} className="num">{a[s] as number}</td>)}<td className="num font-semibold">{a.total}</td></tr>)}</tbody></table> : <Empty>No approved outlets yet.</Empty>}<p className="mt-2 text-xs text-slate-500">An outlet moves up by itself: Visited after a reported visit, First order when a sale is tagged to it, Regular after 3 orders in 90 days. Sample given is set by the agent.</p></Card>}
    {adding && <AddOutlet agents={agents.data ?? []} areas={areas.data ?? []} manager={manager} onClose={() => setAdding(false)} onDone={() => { setAdding(false); refresh(); }} />}
    {open && <OutletDetailModal id={open} onClose={() => { setOpen(null); refresh(); }} agents={agents.data ?? []} areas={areas.data ?? []} />}
  </div>;
}

function OutletCard({ o, onOpen }: { o: OutletRow; onOpen: () => void }) {
  return <button onClick={onOpen} className="flex gap-3 rounded-2xl bg-white p-3 text-left shadow-soft transition hover:shadow-md">
    <Photo id={o.photoId} className="h-20 w-20 shrink-0" big={false} />
    <div className="min-w-0 flex-1">
      <div className="truncate font-semibold text-navy">{o.name}</div>
      <div className="truncate text-xs text-slate-500">{[o.outletType, o.city].filter(Boolean).join(' · ')}{o.area ? ` · ${o.area.name}` : ''}</div>
      <div className="truncate text-xs text-slate-600">{o.contactName ?? '—'}{o.phone ? ` · ${o.phone}` : ''}</div>
      <div className="mt-1 flex flex-wrap gap-1"><Badge tone={o.status === 'APPROVED' ? 'green' : o.status === 'PENDING' ? 'amber' : 'red'}>{o.status === 'APPROVED' ? 'Approved' : o.status === 'PENDING' ? 'Waiting' : 'Rejected'}</Badge><Badge tone={STAGE_TONE[o.stage] ?? 'slate'}>{STAGE[o.stage] ?? o.stage}</Badge>{o.pendingChanges > 0 && <Badge tone="amber">change asked</Badge>}</div>
      <div className="mt-1 text-[11px] text-slate-500">{o.agentName}{o.shares.length ? ` + ${o.shares.map((s) => s.agentName).join(', ')}` : ''}{o.lastOrder ? ` · last order ${fmtDate(o.lastOrder)}` : ''}</div>
      {o.status === 'REJECTED' && <div className="text-xs text-red-700">Not approved: {o.rejectReason}</div>}
    </div>
  </button>;
}

function ChangeRow({ c, onDecide }: { c: { id: string; changes: Record<string, { from: unknown; to: unknown }>; requestedByName: string; outlet: { name: string } }; onDecide: (a: 'APPROVE' | 'REJECT', reason?: string) => void }) {
  const [r, setR] = useState('');
  return <li className="py-3"><div className="font-medium">{c.outlet.name} <span className="text-xs text-slate-500">asked by {c.requestedByName}</span></div>
    <ul className="my-1 text-sm">{Object.entries(c.changes).map(([k, v]) => <li key={k}>{FIELD[k] ?? k}: <span className="text-slate-500 line-through">{String(v.from ?? '—')}</span> → <b>{String(v.to ?? '—')}</b></li>)}</ul>
    <div className="flex flex-wrap items-center gap-2"><Button size="sm" onClick={() => onDecide('APPROVE')}>Approve</Button><Input className="max-w-xs" placeholder="Reason (to reject)" value={r} onChange={(e) => setR(e.target.value)} /><Button size="sm" variant="danger" disabled={!r.trim()} onClick={() => onDecide('REJECT', r)}>Reject</Button></div></li>;
}

function AddOutlet({ agents, areas, manager, onClose, onDone }: { agents: AgentP[]; areas: Area[]; manager: boolean; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', outletType: 'GYM', address: '', city: '', contactName: '', phone: '', email: '', notes: '', agentKey: '', areaId: '' }); const [photo, setPhoto] = useState<File | null>(null); const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const save = useMutation({ mutationFn: async () => { const o = await api.post<{ id: string }>('/api/field/outlets', { ...f, email: f.email || null, areaId: f.areaId || null, agentKey: f.agentKey || undefined, lat: gps?.lat ?? null, lng: gps?.lng ?? null }); if (photo) await api.upload(`/api/attachments/Outlet/${o.id}`, photo); return o; }, onSuccess: onDone });
  const here = () => navigator.geolocation?.getCurrentPosition((p) => setGps({ lat: p.coords.latitude, lng: p.coords.longitude }), () => undefined, { enableHighAccuracy: true });
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  return <Modal title="Add an outlet / gym" onClose={onClose} wide>
    <div className="grid gap-3 md:grid-cols-2">
      <Field label="Name of the outlet *"><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
      <Field label="Type"><Select value={f.outletType} onChange={(e) => set('outletType', e.target.value)}>{TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
      <Field label="Address"><Input value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
      <Field label="City"><Input value={f.city} onChange={(e) => set('city', e.target.value)} /></Field>
      <Field label="Contact person"><Input value={f.contactName} onChange={(e) => set('contactName', e.target.value)} /></Field>
      <Field label="Contact number"><Input inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
      <Field label="Email"><Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
      <Field label="Area"><Select value={f.areaId} onChange={(e) => set('areaId', e.target.value)}><option value="">— my area —</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
      {manager && <Field label="Agent *"><Select value={f.agentKey} onChange={(e) => set('agentKey', e.target.value)}><option value="">— choose —</option>{agents.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}</Select></Field>}
      <Field label="Notes"><Input value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      <Field label="Picture of the outlet"><input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></Field>
      <Field label="Location"><Button type="button" variant="outline" size="sm" onClick={here}>{gps ? `Saved (${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)})` : 'Use my location now'}</Button></Field>
    </div>
    <ErrorBox error={save.error} />
    <div className="mt-4 flex gap-2"><Button disabled={!f.name.trim() || (manager && !f.agentKey) || save.isPending} onClick={() => save.mutate()}>{manager ? 'Add (approved)' : 'Send for approval'}</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
    {!manager && <p className="mt-2 text-xs text-slate-500">The Sales Manager approves it before it can be tagged on a sale or put in your itinerary.</p>}
  </Modal>;
}

function OutletDetailModal({ id, onClose, agents, areas }: { id: string; onClose: () => void; agents: AgentP[]; areas: Area[] }) {
  const { can } = useAuth(); const qc = useQueryClient();
  const manager = can('outlet.manage');
  const q = useQuery({ queryKey: ['outlet-detail', id], queryFn: () => api.get<Detail>(`/api/field/outlets/${id}`) });
  const o = q.data;
  const [edit, setEdit] = useState<Record<string, string> | null>(null); const [info, setInfo] = useState('');
  const again = () => { void qc.invalidateQueries({ queryKey: ['outlet-detail', id] }); void qc.invalidateQueries({ queryKey: ['outlets'] }); };
  const change = useMutation({ mutationFn: () => api.post<{ applied: boolean; message?: string }>(`/api/field/outlets/${id}/change`, Object.fromEntries(Object.entries(edit!).map(([k, v]) => [k, k === 'email' ? v || null : v]))), onSuccess: (r) => { setInfo(r.applied ? 'Saved. The Owner was told of the change.' : r.message ?? 'Sent for approval.'); setEdit(null); again(); } });
  const stage = useMutation({ mutationFn: (s: string) => api.post(`/api/field/outlets/${id}/stage`, { stage: s }), onSuccess: again });
  const share = useMutation({ mutationFn: (v: { agentKey: string; on: boolean }) => api.post(`/api/field/outlets/${id}/share`, v), onSuccess: again });
  const move = useMutation({ mutationFn: (v: { agentKey?: string; areaId?: string | null }) => api.post('/api/field/outlets/reassign', { ids: [id], ...v }), onSuccess: again });
  const del = useMutation({ mutationFn: () => api.post<{ requested: boolean }>(`/api/field/outlets/${id}/delete`, {}), onSuccess: () => { setInfo('Removal sent to the Owner (no orders in the last 3 months).'); again(); } });
  const photoUp = useMutation({ mutationFn: (f: File) => api.upload(`/api/attachments/Outlet/${id}`, f), onSuccess: again });
  const [shareKey, setShareKey] = useState('');
  const set = (k: string, v: string) => setEdit({ ...edit!, [k]: v });
  const startEdit = () => setEdit({ name: o!.name, outletType: o!.outletType, address: o!.address ?? '', city: o!.city ?? '', contactName: o!.contactName ?? '', phone: o!.phone ?? '', email: o!.email ?? '', notes: o!.notes ?? '' });
  const approved = o?.status === 'APPROVED';
  return <Modal title={o?.name ?? 'Outlet'} onClose={onClose} wide>
    <ErrorBox error={q.error} />
    {o && <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><Badge tone={approved ? 'green' : o.status === 'PENDING' ? 'amber' : 'red'}>{approved ? 'Approved' : o.status === 'PENDING' ? 'Waiting for approval' : 'Rejected'}</Badge><Badge tone={STAGE_TONE[o.stage] ?? 'slate'}>{STAGE[o.stage] ?? o.stage}</Badge>
        <span className="text-sm text-slate-600">{o.agentName}{o.shares.length ? ` (shared with ${o.shares.map((s) => s.agentName).join(', ')})` : ''}{o.area ? ` · ${o.area.name}` : ''}</span></div>
      {o.status === 'REJECTED' && <p className="rounded-xl bg-red-50 p-2 text-sm text-red-800">Not approved: {o.rejectReason}. Correct the details and add it again, or ask the Sales Manager.</p>}
      <div className="flex flex-wrap gap-2">{o.photos.map((p) => <Photo key={p.id} id={p.id} className="h-24 w-24" caption={o.name} />)}{!o.photos.length && <Photo id={null} className="h-24 w-24" />}
        <label className="flex h-24 w-24 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-center text-xs text-slate-500">{photoUp.isPending ? '…' : '+ picture'}<input type="file" hidden accept="image/*" capture="environment" onChange={(e) => { const f = e.target.files?.[0]; if (f) photoUp.mutate(f); e.target.value = ''; }} /></label></div>
      {edit ? <div className="grid gap-3 md:grid-cols-2">
        {([['name', 'Name'], ['address', 'Address'], ['city', 'City'], ['contactName', 'Contact person'], ['phone', 'Contact number'], ['email', 'Email'], ['notes', 'Notes']] as const).map(([k, l]) => <Field key={k} label={l}><Input value={edit[k]} onChange={(e) => set(k, e.target.value)} /></Field>)}
        <Field label="Type"><Select value={edit.outletType} onChange={(e) => set('outletType', e.target.value)}>{TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
        <div className="md:col-span-2 flex items-center gap-2"><Button disabled={change.isPending} onClick={() => change.mutate()}>{manager || !approved ? 'Save' : 'Send change for approval'}</Button><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>{!manager && approved && <span className="text-xs text-slate-500">The Sales Manager approves it; the Owner is told of the change.</span>}</div>
      </div> : <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">{[['Type', o.outletType], ['Address', [o.address, o.city].filter(Boolean).join(', ')], ['Contact person', o.contactName], ['Contact number', o.phone], ['Email', o.email], ['Notes', o.notes], ['Location', o.lat != null ? `${o.lat.toFixed(5)}, ${o.lng!.toFixed(5)}` : '—']].map(([k, v]) => <div key={k as string}><dt className="text-xs uppercase text-slate-500">{k}</dt><dd>{v || '—'}</dd></div>)}</dl>}
      <ErrorBox error={change.error} />{info && <p className="rounded-xl bg-emerald-50 p-2 text-sm text-emerald-800">{info}</p>}
      {!edit && o.status !== 'REJECTED' && <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={startEdit}>{manager || !approved ? 'Edit details' : 'Ask for a change'}</Button>
        {approved && <Select className="max-w-44" value={o.stage} onChange={(e) => stage.mutate(e.target.value)}>{Object.entries(STAGE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}
        {manager && <>
          <Select className="max-w-44" value={o.area?.id ?? ''} onChange={(e) => move.mutate({ areaId: e.target.value || null })}><option value="">No area</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          <Select className="max-w-44" value="" onChange={(e) => e.target.value && move.mutate({ agentKey: e.target.value })}><option value="">Move to agent…</option>{agents.filter((a) => a.key !== o.agentKey).map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}</Select>
          <Button size="sm" variant="danger" disabled={del.isPending} onClick={() => { if (confirm(`Ask the Owner to remove ${o.name}? It must have no orders in the last 3 months.`)) del.mutate(); }}>Remove outlet</Button></>}
      </div>}
      {manager && approved && <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-2 text-sm"><span className="text-slate-600">Share with another agent:</span>
        <Select className="max-w-44" value={shareKey} onChange={(e) => setShareKey(e.target.value)}><option value="">— choose —</option>{agents.filter((a) => a.key !== o.agentKey && !o.shares.some((s) => s.agentKey === a.key)).map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}</Select>
        <Button size="sm" variant="outline" disabled={!shareKey} onClick={() => { share.mutate({ agentKey: shareKey, on: true }); setShareKey(''); }}>Share</Button>
        {o.shares.map((s) => <button key={s.agentKey} className="rounded-full bg-white px-2 py-0.5 text-xs shadow-soft" onClick={() => share.mutate({ agentKey: s.agentKey, on: false })}>{s.agentName} ✕</button>)}</div>}
      <ErrorBox error={del.error ?? share.error ?? move.error ?? stage.error} />
      {o.changes.some((c) => c.status === 'PENDING') && <p className="rounded-xl bg-amber-50 p-2 text-sm text-amber-800">A change is waiting for the Sales Manager.</p>}
      {approved && <>
        <Card title={`Orders tagged to this outlet (${o.orderCount})`}>{o.orders.length ? <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Date</th><th>DR / SI</th><th>Branch</th><th className="num">Amount</th><th className="num">Unpaid</th></tr></thead><tbody>{o.orders.map((s) => <tr key={s.id} className="border-t"><td className="py-1.5">{fmtDate(s.date)}</td><td>{can('report.sales.all') || can('sale.create') ? <Link className="text-brand underline" to={`/sales/${s.id}`}>{s.drSiNo}</Link> : s.drSiNo}</td><td>{s.branch}</td><td className="num">{peso(s.amount)}</td><td className="num">{s.balance > 0 ? peso(s.balance) : '—'}</td></tr>)}</tbody></table> : <Empty>No orders yet. The sales associate tags this outlet on the sale.</Empty>}</Card>
        <Card title="Visits">{o.visits.length ? <ul className="divide-y">{o.visits.map((v) => <li key={v.id} className="py-2 text-sm"><div className="flex flex-wrap items-center gap-2"><b>{fmtDate(v.date)}</b><Badge tone={v.status === 'VISITED' ? 'green' : 'red'}>{v.status === 'VISITED' ? 'Visited' : 'Missed'}</Badge><span className="text-xs text-slate-500">{v.agent}{v.visitedAt ? ` · ${new Date(v.visitedAt).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' })}` : ''}</span>{v.lat != null && <a className="text-xs text-brand underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${v.lat},${v.lng}`}>map</a>}</div>{(v.note || v.shelfStatus || v.competitors) && <div className="text-xs text-slate-600">{[v.shelfStatus?.replace(/_/g, ' ').toLowerCase(), v.competitors ? `competitors: ${v.competitors}` : null, v.note].filter(Boolean).join(' · ')}</div>}<PhotoRow photos={v.photos} /></li>)}</ul> : <Empty>No visits reported yet.</Empty>}</Card></>}
    </div>}
  </Modal>;
}

function AreasTab({ areas, agents, manager, onSaved }: { areas: Area[]; agents: AgentP[]; manager: boolean; onSaved: () => void }) {
  const [f, setF] = useState<{ id?: string; name: string; agentKey: string; notes: string }>({ name: '', agentKey: '', notes: '' });
  const save = useMutation({ mutationFn: () => api.post('/api/field/areas', { id: f.id, name: f.name, agentKey: f.agentKey || null, notes: f.notes || null }), onSuccess: () => { setF({ name: '', agentKey: '', notes: '' }); onSaved(); } });
  const month = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
  const perf = useQuery({ queryKey: ['area-perf', month], queryFn: () => api.get<{ areas: { areaId: string; sales: number; orders: number; ordering: number; outlets: number; agentTarget: number | null; achievedPct: number | null }[] }>(`/api/field/areas/performance?month=${month}`), enabled: manager || undefined });
  return <div className="space-y-4">
    <Card title="Areas and who covers them">{areas.length ? <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Area</th><th>Agent</th><th className="num">Outlets</th><th className="num">Waiting</th><th className="num">Sales this month</th>{manager && <th />}</tr></thead><tbody>{areas.map((a) => { const p = perf.data?.areas.find((x) => x.areaId === a.id); return <tr key={a.id} className="border-t"><td className="py-2 font-medium">{a.name}{a.notes && <div className="text-xs font-normal text-slate-500">{a.notes}</div>}</td><td>{a.agentName ?? <span className="text-slate-400">not assigned</span>}</td><td className="num">{a.outlets}</td><td className="num">{a.pending || '—'}</td><td className="num">{p ? `${peso(p.sales)}${p.achievedPct != null ? ` (${p.achievedPct}% of the agent's target)` : ''}` : '—'}</td>{manager && <td><Button size="sm" variant="ghost" onClick={() => setF({ id: a.id, name: a.name, agentKey: a.agentKey ?? '', notes: a.notes ?? '' })}>Edit</Button></td>}</tr>; })}</tbody></table> : <Empty>No areas yet.</Empty>}</Card>
    {manager && <Card title={f.id ? 'Change area' : 'New area'}><div className="grid gap-3 md:grid-cols-4"><Field label="Area name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Quezon City North" /></Field><Field label="Agent"><Select value={f.agentKey} onChange={(e) => setF({ ...f, agentKey: e.target.value })}><option value="">— not assigned —</option>{agents.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}</Select></Field><Field label="Note" className="md:col-span-2"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div><div className="mt-3 flex gap-2"><Button disabled={f.name.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>{f.id ? 'Save area' : 'Add area'}</Button>{f.id && <Button variant="ghost" onClick={() => setF({ name: '', agentKey: '', notes: '' })}>Cancel</Button>}</div><ErrorBox error={save.error} /><p className="mt-2 text-xs text-slate-500">The agent is told, and so is the Owner. An agent needs an Agent account (Sales Targets → link the agent) to be picked here.</p></Card>}
  </div>;
}
