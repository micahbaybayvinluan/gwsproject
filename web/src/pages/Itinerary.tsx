import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, fmtDate, peso, today } from '@/lib/api';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Select } from '@/components/ui/primitives';
import { PhotoRow } from '@/components/Photo';
import type { OutletRow } from './Outlets';

interface Stop { id: string; outletId: string; outlet: { id: string; name: string; address: string | null; city: string | null; contactName: string | null; phone: string | null }; status: 'PLANNED' | 'VISITED' | 'MISSED'; note: string | null; visitedAt: string | null; lat: number | null; lng: number | null; shelfStatus: string | null; competitors: string | null; photos: { id: string; createdAt: string }[] }
interface Day { id: string | null; date: string; notes: string | null; reportSubmittedAt: string | null; stops: Stop[]; claims: { id: string; kind: string; amount: number; note: string | null; status: string; receipts: { id: string; createdAt: string }[] }[] }
const SHELF: [string, string][] = [['', '— shelf check —'], ['ON_SHELF', 'GWS is on the shelf'], ['LOW_STOCK', 'GWS stock is low'], ['OUT_OF_STOCK', 'GWS is out of stock'], ['NOT_CARRIED', 'They do not carry GWS']];
const CLAIM: [string, string][] = [['FUEL', 'Fuel'], ['TRANSPORT', 'Transport / toll / parking'], ['MEAL', 'Meal'], ['OTHER', 'Other']];

/** Phone-first screen for the agent: plan the stores of the day, report each visit with a photo and the phone's location, claim fuel / transport. */
export function ItineraryPage() {
  const qc = useQueryClient();
  const [date, setDate] = useState(today());
  const day = useQuery({ queryKey: ['itinerary', date], queryFn: () => api.get<Day>(`/api/field/itinerary?date=${date}`) });
  const outlets = useQuery({ queryKey: ['outlets', 'approved-mine'], queryFn: () => api.get<OutletRow[]>('/api/field/outlets?status=APPROVED') });
  const [picking, setPicking] = useState(false); const [picked, setPicked] = useState<string[]>([]); const [search, setSearch] = useState(''); const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['itinerary', date] }); };
  const d = day.data; const locked = !!d?.reportSubmittedAt; const future = date > today(); const past = date < today();
  const plan = useMutation({ mutationFn: () => api.post('/api/field/itinerary/plan', { date, outletIds: picked }), onSuccess: () => { setPicking(false); refresh(); } });
  const importPlan = useMutation({ mutationFn: (f: File) => api.upload<{ days: number; stops: number; unmatched: string[]; past: string[]; message?: string }>('/api/field/itinerary/import', f), onSuccess: (r) => { setMsg(`${r.stops} stores planned over ${r.days} day(s).${r.unmatched.length ? ` Not in your approved outlets: ${r.unmatched.join(', ')}.` : ''}${r.past.length ? ` ${r.past.length} past rows skipped.` : ''}`); refresh(); } });
  const submit = useMutation({ mutationFn: () => api.post('/api/field/itinerary/submit', { date }), onSuccess: refresh });
  const startPick = () => { setPicked(d?.stops.map((s) => s.outletId) ?? []); setPicking(true); };
  const visited = d?.stops.filter((s) => s.status === 'VISITED').length ?? 0; const missed = d?.stops.filter((s) => s.status === 'MISSED').length ?? 0; const total = d?.stops.length ?? 0;
  const list = (outlets.data ?? []).filter((o) => !search || `${o.name} ${o.city ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="mx-auto max-w-2xl space-y-4">
    <div className="flex flex-wrap items-end gap-3"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">My Itinerary</h1><Field label="Day"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field></div>
    {d && <div className="grid grid-cols-3 gap-2 text-center"><div className="rounded-2xl bg-white p-3 shadow-soft"><div className="text-2xl font-extrabold text-navy">{total}</div><div className="text-xs text-slate-500">stores planned</div></div><div className="rounded-2xl bg-white p-3 shadow-soft"><div className="text-2xl font-extrabold text-emerald-600">{visited}</div><div className="text-xs text-slate-500">visited</div></div><div className="rounded-2xl bg-white p-3 shadow-soft"><div className="text-2xl font-extrabold text-red-600">{missed}</div><div className="text-xs text-slate-500">missed</div></div></div>}
    {locked && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">The report for this day was submitted. ✓</p>}
    {!locked && !past && <div className="flex flex-wrap gap-2"><Button size="lg" onClick={startPick}>{total ? 'Change the stores' : 'Plan the stores for this day'}</Button><Button size="lg" variant="outline" onClick={() => fileRef.current?.click()} disabled={importPlan.isPending}>Upload itinerary file</Button>
      <input ref={fileRef} type="file" hidden accept=".xlsx,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setMsg(''); importPlan.mutate(f); } e.target.value = ''; }} /></div>}
    {!locked && !past && <p className="text-xs text-slate-500">File columns: <b>Date</b> and <b>Outlet</b> (the outlet name as in your list), one row per store per day. Only your approved outlets can be planned; an outlet that is not listed must be uploaded under Outlets first and approved by the Sales Manager.</p>}
    {msg && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{msg}</p>}<ErrorBox error={plan.error ?? importPlan.error ?? day.error} />
    {picking && <Card title="Choose the stores to visit"><Input placeholder="Search your outlets…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <ul className="mt-2 max-h-80 divide-y overflow-y-auto">{list.map((o) => <li key={o.id}><label className="flex min-h-12 cursor-pointer items-center gap-3 py-1.5"><input type="checkbox" className="h-5 w-5" checked={picked.includes(o.id)} onChange={() => setPicked(picked.includes(o.id) ? picked.filter((x) => x !== o.id) : [...picked, o.id])} /><span className="flex-1"><span className="font-medium">{o.name}</span><span className="block text-xs text-slate-500">{[o.address, o.city].filter(Boolean).join(', ')}</span></span></label></li>)}{!list.length && <Empty>No approved outlets. Upload them under Outlets; the Sales Manager approves.</Empty>}</ul>
      <div className="mt-3 flex gap-2"><Button disabled={plan.isPending} onClick={() => plan.mutate()}>Save {picked.length} store{picked.length === 1 ? '' : 's'}</Button><Button variant="ghost" onClick={() => setPicking(false)}>Cancel</Button></div></Card>}
    {d?.stops.map((s) => <StopCard key={s.id} s={s} canReport={!locked && !future} onChanged={refresh} />)}
    {d && !d.stops.length && !picking && <Card><Empty>Nothing planned for this day.</Empty></Card>}
    {d && total > 0 && !locked && !future && <div><Button size="lg" className="w-full" disabled={submit.isPending} onClick={() => submit.mutate()}>Submit the report for this day</Button><ErrorBox error={submit.error} /></div>}
    {d && <Claims day={d} date={date} locked={false} onChanged={refresh} />}
  </div>;
}

function StopCard({ s, canReport, onChanged }: { s: Stop; canReport: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ note: '', shelf: '', competitors: '' }); const [err, setErr] = useState('');
  const photo = useMutation({ mutationFn: (file: File) => api.upload(`/api/attachments/ItineraryStop/${s.id}`, file), onSuccess: onChanged });
  const report = useMutation({
    mutationFn: async (status: 'VISITED' | 'MISSED') => {
      let pos: { lat: number; lng: number } | undefined;
      if (status === 'VISITED') pos = await new Promise<{ lat: number; lng: number }>((res, rej) => { if (!navigator.geolocation) return rej(new Error('This phone cannot give its location')); navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => rej(new Error('Allow location for this site in your phone settings, then try again')), { enableHighAccuracy: true, timeout: 15000 }); });
      return api.post(`/api/field/itinerary/stops/${s.id}/report`, { status, note: f.note || undefined, lat: pos?.lat, lng: pos?.lng, shelfStatus: f.shelf || undefined, competitors: f.competitors || undefined });
    },
    onSuccess: () => { setOpen(false); setErr(''); onChanged(); }, onError: (e) => setErr((e as Error).message),
  });
  const tone = s.status === 'VISITED' ? 'green' : s.status === 'MISSED' ? 'red' : 'amber';
  return <div className="rounded-2xl bg-white p-4 shadow-soft">
    <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><div className="font-semibold text-navy">{s.outlet.name}</div><div className="text-xs text-slate-500">{[s.outlet.address, s.outlet.city].filter(Boolean).join(', ')}</div>
      {(s.outlet.contactName || s.outlet.phone) && <div className="text-sm">{s.outlet.contactName} {s.outlet.phone && <a className="text-brand underline" href={`tel:${s.outlet.phone}`}>{s.outlet.phone}</a>}</div>}</div><Badge tone={tone}>{s.status === 'PLANNED' ? 'To visit' : s.status === 'VISITED' ? 'Visited' : 'Missed'}</Badge></div>
    {s.status !== 'PLANNED' && <div className="mt-2 text-xs text-slate-600">{s.visitedAt ? `at ${new Date(s.visitedAt).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' })}` : ''}{s.shelfStatus ? ` · ${SHELF.find(([k]) => k === s.shelfStatus)?.[1]}` : ''}{s.competitors ? ` · competitors: ${s.competitors}` : ''}{s.note ? ` · ${s.note}` : ''}</div>}
    {s.photos.length > 0 && <div className="mt-2"><PhotoRow photos={s.photos} className="h-20 w-20" /></div>}
    {canReport && s.status === 'PLANNED' && !open && <Button className="mt-3 w-full" size="lg" variant="outline" onClick={() => setOpen(true)}>Report this visit</Button>}
    {canReport && s.status === 'PLANNED' && open && <div className="mt-3 space-y-3 border-t pt-3">
      <label className="flex min-h-14 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-brand/40 bg-brand-soft text-sm font-semibold text-brand-dark">{photo.isPending ? 'Uploading…' : s.photos.length ? '+ Take another photo' : '📷 Take a photo of the store (required)'}<input type="file" hidden accept="image/*" capture="environment" onChange={(e) => { const file = e.target.files?.[0]; if (file) photo.mutate(file); e.target.value = ''; }} /></label>
      <Select value={f.shelf} onChange={(e) => setF({ ...f, shelf: e.target.value })}>{SHELF.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
      <Input placeholder="Competitor brands seen (optional)" value={f.competitors} onChange={(e) => setF({ ...f, competitors: e.target.value })} />
      <Input placeholder="Notes (needed if missed)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      <div className="grid grid-cols-2 gap-2"><Button size="lg" disabled={report.isPending || !s.photos.length} onClick={() => { setErr(''); report.mutate('VISITED'); }}>Visited ✓</Button><Button size="lg" variant="danger" disabled={report.isPending || !f.note.trim()} onClick={() => { setErr(''); report.mutate('MISSED'); }}>Missed</Button></div>
      {!s.photos.length && <p className="text-xs text-slate-500">Take the photo first. The visit also records your location and the time.</p>}
      <ErrorBox error={photo.error} />{err && <p role="alert" className="rounded-xl bg-red-50 p-2 text-sm text-red-700">{err}</p>}
    </div>}
  </div>;
}

function Claims({ day, date, locked, onChanged }: { day: Day; date: string; locked: boolean; onChanged: () => void }) {
  const [f, setF] = useState({ kind: 'FUEL', amount: '', note: '' }); const [receipt, setReceipt] = useState<File | null>(null);
  const add = useMutation({ mutationFn: async () => { const c = await api.post<{ id: string }>('/api/field/claims', { date, kind: f.kind, amount: Number(f.amount), note: f.note || undefined }); if (receipt) await api.upload(`/api/attachments/ItineraryClaim/${c.id}`, receipt); }, onSuccess: () => { setF({ kind: 'FUEL', amount: '', note: '' }); setReceipt(null); onChanged(); } });
  return <Card title="Fuel / transport / meal claims for this day">
    {day.claims.length > 0 && <ul className="mb-3 divide-y text-sm">{day.claims.map((c) => <li key={c.id} className="flex items-center gap-2 py-2"><span className="flex-1">{CLAIM.find(([k]) => k === c.kind)?.[1]} · {peso(c.amount)}{c.note ? ` · ${c.note}` : ''}</span><PhotoRow photos={c.receipts} className="h-10 w-10" /><Badge tone={c.status === 'APPROVED' ? 'green' : c.status === 'REJECTED' ? 'red' : 'amber'}>{c.status === 'PENDING' ? 'waiting' : c.status.toLowerCase()}</Badge></li>)}</ul>}
    {!locked && <div className="grid gap-2 md:grid-cols-4"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{CLAIM.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select><Input type="number" inputMode="decimal" min={0} placeholder="Amount ₱" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /><Input placeholder="Note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /><input type="file" accept="image/*" capture="environment" className="text-xs" onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} /></div>}
    {!locked && <Button className="mt-3" variant="outline" disabled={!(Number(f.amount) > 0) || add.isPending} onClick={() => add.mutate()}>Send claim to the Sales Manager</Button>}
    <ErrorBox error={add.error} /><p className="mt-2 text-xs text-slate-500">Photo of the receipt is optional. The Sales Manager approves; Accounting is then told to pay. {fmtDate(date)}</p>
  </Card>;
}
