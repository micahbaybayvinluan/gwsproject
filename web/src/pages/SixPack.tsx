import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Attachments } from '@/components/Attachments';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Select, Stat } from '@/components/ui/primitives';

interface Summary {
  perCard: number; value: number; from: string; to: string;
  today: { stickers: number; dr: number; cards: number; amount: string }; period: { stickers: number; dr: number; cards: number; amount: string; legacy: number };
  nearCard: { name: string; phone: string; left: number }[];
  stickers: { id: string; date: string; branch: string; drSiNo: string; customer: string; phone: string; stickers: number; by: string }[];
  redemptions: { id: string; controlNo: string; date: string; branch: string; customer: string; phone: string; email: string | null; address: string | null; amount: string; legacyCardNo: string | null; by: string }[];
}
interface Cust { name: string | null; email: string | null; address: string | null; earned: number; used: number; left: number; cardsReady: number; perCard: number }

/** 6-Pack Card (owner request 2026-09-30): stickers come from the DR tick box; six stickers make a ₱300 card, booked as the branch's "6-Pack Card" expense from the cash on hand. */
export function SixPackPage() {
  const { me, can } = useAuth(); const qc = useQueryClient();
  const all = can('sixpack.view.all'); const [locationId, setLocationId] = useState(all ? '' : me!.locations[0]?.id ?? '');
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/locations'), enabled: all });
  // period and search (owner request 2026-10-02): the lists below can be searched by customer, mobile, email, DR / SI, card number, branch or associate
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [text, setText] = useState(''); const [search, setSearch] = useState('');
  useEffect(() => { const t = setTimeout(() => setSearch(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const qs = new URLSearchParams({ ...(locationId ? { locationId } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), ...(search ? { search } : {}) }).toString();
  const sum = useQuery({ queryKey: ['six-pack', locationId, from, to, search], queryFn: () => api.get<Summary>(`/api/six-pack/summary${qs ? `?${qs}` : ''}`) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['six-pack'] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); };
  const s = sum.data;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">6-Pack Card</h1>{all && <Field label="Branch"><Select value={locationId} onChange={(e) => setLocationId(e.target.value)}><option value="">All branches</option>{locations.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>}</div>
    <Card><ol className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
      <li><b>1.</b> On the DR, tick <b>“6-Pack sticker given”</b> and type the customer’s full name and mobile number. One sticker is recorded for each supplement on the DR.</li>
      <li><b>2.</b> At {s?.perCard ?? 6} stickers (from any branch) the customer gets a {s ? peso(s.value) : '₱300'} card.</li>
      <li><b>3.</b> Redeem it here: complete the customer’s data; the {s ? peso(s.value) : '₱300'} becomes the branch’s <b>6-Pack Card</b> expense, paid from the cash on hand.</li>
    </ol></Card>
    <div className="grid gap-3 md:grid-cols-4"><Field label="Stickers and cards from"><Input type="date" value={from || s?.from || ''} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><Input type="date" value={to || s?.to || ''} onChange={(e) => setTo(e.target.value)} /></Field><Field label="Search the stickers given and cards redeemed" className="md:col-span-2"><Input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Customer, mobile, email, DR / SI, card number, branch, associate…" /></Field></div>
    {s && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Stickers today" value={s.today.stickers} sub={`${s.today.dr} DR with stickers`} /><Stat label="Cards redeemed today" value={s.today.cards} sub={peso(s.today.amount)} tone={s.today.cards ? 'amber' : undefined} />
      <Stat label={`Stickers ${s.from} to ${s.to}`} value={s.period.stickers} sub={`${s.period.dr} DR`} /><Stat label="Cards redeemed in the period" value={s.period.cards} sub={`${peso(s.period.amount)}${s.period.legacy ? ` · ${s.period.legacy} old paper card${s.period.legacy === 1 ? '' : 's'}` : ''}`} tone={s.period.legacy ? 'red' : undefined} />
    </div>}
    {can('sixpack.override') && <Override locations={locations.data ?? []} />}
    {can('sixpack.issue') && <Redeem perCard={s?.perCard ?? 6} value={s?.value ?? 300} locationId={locationId || me!.locations[0]?.id} onDone={refresh} />}
    {s && s.nearCard.length > 0 && <Card title="Customers close to a card"><ul className="grid gap-x-6 text-sm sm:grid-cols-2">{s.nearCard.map((c) => <li key={c.phone} className="flex justify-between border-b py-1"><span>{c.name} <span className="text-xs text-slate-500">{c.phone}</span></span><Badge tone={c.left >= s.perCard ? 'green' : 'amber'}>{c.left} / {s.perCard}</Badge></li>)}</ul></Card>}
    {s && <Card title="Cards redeemed">{s.redemptions.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1 pr-3">Card</th><th className="pr-3">Date</th><th className="pr-3">Branch</th><th className="pr-3">Customer</th><th className="pr-3">Contact</th><th className="num pr-3">Amount</th><th className="pr-3">By</th><th /></tr></thead>
      <tbody>{s.redemptions.map((r) => <tr key={r.id} className="border-t align-top"><td className="py-1.5 pr-3 font-medium">{r.controlNo}{r.legacyCardNo && <div><Badge tone="red">old card {r.legacyCardNo}</Badge></div>}</td><td className="pr-3">{r.date}</td><td className="pr-3">{r.branch}</td><td className="pr-3">{r.customer}<div className="text-xs text-slate-500">{r.address}</div></td><td className="pr-3 text-xs">{r.phone}<div>{r.email}</div></td><td className="num pr-3">{peso(r.amount)}</td><td className="pr-3">{r.by}</td><td>{(can('sale.void') || can('sale.edit.postclose')) && <VoidButton id={r.id} onDone={refresh} />}</td></tr>)}</tbody></table></div> : <Empty>None in this period.</Empty>}</Card>}
    {s && <Card title="Stickers given">{s.stickers.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1 pr-3">Date</th><th className="pr-3">Branch</th><th className="pr-3">DR / SI</th><th className="pr-3">Customer</th><th className="pr-3">Mobile</th><th className="num pr-3">Stickers</th><th className="pr-3">Given by</th></tr></thead>
      <tbody>{s.stickers.map((r) => <tr key={r.id} className="border-t"><td className="py-1.5 pr-3">{r.date}</td><td className="pr-3">{r.branch}</td><td className="pr-3">{r.drSiNo}</td><td className="pr-3">{r.customer}</td><td className="pr-3">{r.phone}</td><td className="num pr-3">{r.stickers}</td><td className="pr-3">{r.by}</td></tr>)}</tbody></table></div> : <Empty>None in this period.</Empty>}</Card>}
  </div>;
}

function VoidButton({ id, onDone }: { id: string; onDone: () => void }) {
  const m = useMutation({ mutationFn: (reason: string) => api.post(`/api/six-pack/redemptions/${id}/void`, { reason }), onSuccess: onDone });
  return <><Button size="sm" variant="outline" disabled={m.isPending} onClick={() => { const r = window.prompt('Why is this card voided?'); if (r && r.trim().length >= 3) m.mutate(r.trim()); }}>Void</Button><ErrorBox error={m.error} /></>;
}

function Redeem({ perCard, value, locationId, onDone }: { perCard: number; value: number; locationId?: string; onDone: () => void }) {
  const [f, setF] = useState({ phone: '', name: '', email: '', address: '', legacy: false, legacyNo: '' });
  const [draftId] = useState(() => crypto.randomUUID()); const [proofId, setProofId] = useState<string | null>(null);
  const [cust, setCust] = useState<Cust | null>(null); const [done, setDone] = useState<string | null>(null);
  const look = useMutation({ mutationFn: () => api.get<Cust>(`/api/six-pack/customer?phone=${encodeURIComponent(f.phone)}`), onSuccess: (c) => { setCust(c); setF((x) => ({ ...x, name: x.name || c.name || '', email: x.email || c.email || '', address: x.address || c.address || '' })); } });
  const go = useMutation({ mutationFn: () => api.post<{ controlNo: string }>('/api/six-pack/redeem', { locationId, customerName: f.name, phone: f.phone, email: f.email, address: f.address, legacyCardNo: f.legacy ? f.legacyNo : null, proofAttachmentId: f.legacy ? proofId : null }), onSuccess: (r) => { setDone(r.controlNo); setCust(null); setF({ phone: '', name: '', email: '', address: '', legacy: false, legacyNo: '' }); setProofId(null); onDone(); } });
  const complete = f.name.trim().length >= 3 && f.phone.replace(/\D/g, '').length >= 10 && /^\S+@\S+\.\S+$/.test(f.email) && f.address.trim().length >= 5;
  const ok = f.legacy ? f.legacyNo.trim().length > 0 && !!proofId : !!cust && cust.left >= perCard;
  return <Card title="Redeem a card">
    <div className="grid gap-3 md:grid-cols-4">
      <Field label="Customer mobile number"><div className="flex gap-1"><Input value={f.phone} onChange={(e) => { setF({ ...f, phone: e.target.value }); setCust(null); }} placeholder="09xx xxx xxxx" /><Button variant="outline" disabled={look.isPending || f.phone.replace(/\D/g, '').length < 10} onClick={() => look.mutate()}>Find</Button></div></Field>
      <Field label="Full name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <Field label="Address"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
    </div>
    {cust && <p className={`mt-2 rounded border p-2 text-sm ${cust.left >= perCard ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>{cust.name ? <b>{cust.name}</b> : 'New customer'}: <b>{cust.left}</b> sticker{cust.left === 1 ? '' : 's'} available ({cust.earned} earned, {cust.used} used). {cust.left >= perCard ? `Ready for ${cust.cardsReady} card${cust.cardsReady === 1 ? '' : 's'}.` : `${perCard - cust.left} more needed for a card.`}</p>}
    <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.legacy} onChange={(e) => setF({ ...f, legacy: e.target.checked })} /> The customer brings an <b>old paper card</b> (from before GWS-ERP): type its number and attach a photo. The auditors and the Owner are told.</label>
    {f.legacy && <div className="mt-2 grid gap-3 md:grid-cols-2"><Field label="Old card number"><Input value={f.legacyNo} onChange={(e) => setF({ ...f, legacyNo: e.target.value })} /></Field><Attachments type="SixPackRedemption" id={draftId} title="Photo of the card" uploadLabel="Attach photo" onUploaded={(a) => setProofId(a.id)} /></div>}
    <div className="mt-3 flex flex-wrap items-center gap-3"><Button disabled={!complete || !ok || go.isPending} onClick={() => go.mutate()}>Redeem {peso(value)} card</Button><span className="text-xs text-slate-500">The {peso(value)} is booked as the branch’s 6-Pack Card expense from the cash on hand, tagged to this customer. Date {today()}.</span></div>
    {!complete && <p className="mt-1 text-xs text-amber-700">Complete the customer data first: name, mobile number, email and address.</p>}
    {done && <p className="mt-2 text-sm text-emerald-700">Card {done} recorded. Give the customer their {peso(value)} discount.</p>}
    <ErrorBox error={go.error ?? look.error} />
  </Card>;
}

/** Head Auditor: the customer cannot be tagged (data missing) → ask the Owner to allow the card anyway (owner request 2026-09-30). */
function Override({ locations }: { locations: { id: string; name: string }[] }) {
  const [f, setF] = useState({ locationId: '', customerName: '', phone: '', email: '', address: '', reason: '' });
  const m = useMutation({ mutationFn: () => api.post('/api/six-pack/override', { locationId: f.locationId, customerName: f.customerName || null, phone: f.phone || null, email: f.email || null, address: f.address || null, reason: f.reason }), onSuccess: () => setF({ locationId: '', customerName: '', phone: '', email: '', address: '', reason: '' }) });
  return <Card title="Customer cannot be tagged? Ask the Owner to allow the card">
    <p className="mb-3 text-sm text-slate-600">If the customer's data is missing, a card can still be given with <b>your request and the Owner's approval</b>. Fill in what is known and the reason. Once the Owner approves, the ₱300 is booked as the branch's 6-Pack Card expense and marked as an override for the auditors.</p>
    <div className="grid gap-3 md:grid-cols-3">
      <Field label="Branch"><Select value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}><option value="">—</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
      <Field label="Customer name (if known)"><Input value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} /></Field>
      <Field label="Mobile (if known)"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <Field label="Email (if known)"><Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <Field label="Address (if known)"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
      <Field label="Why can't the customer be tagged? (required)"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
    </div>
    <div className="mt-3 flex items-center gap-3"><Button disabled={!f.locationId || f.reason.trim().length < 5 || m.isPending} onClick={() => m.mutate()}>Send to the Owner</Button>{m.isSuccess && <span className="text-sm text-emerald-700">Sent. The Owner decides in My Approvals.</span>}</div>
    <ErrorBox error={m.error} />
  </Card>;
}
