import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, fmtDate, peso } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, Select, Stat, Textarea } from '@/components/ui/primitives';
import { Toggle } from '@/components/ui/widgets';
import { DataTable } from '@/components/ui/table';

export const TIER_TONE: Record<string, 'slate' | 'blue' | 'amber'> = { BRONZE: 'slate', SILVER: 'blue', GOLD: 'amber' };
export const GOALS: [string, string][] = [['MUSCLE_GAIN', 'Build muscle'], ['WEIGHT_LOSS', 'Lose weight'], ['ENDURANCE', 'Endurance / sports'], ['GENERAL_HEALTH', 'General health'], ['STRENGTH', 'Strength'], ['OTHER', 'Other']];
export const HEARD: [string, string][] = [['FACEBOOK', 'Facebook'], ['TIKTOK', 'TikTok'], ['INSTAGRAM', 'Instagram'], ['GYM', 'My gym / coach'], ['FRIEND', 'A friend'], ['WALK_IN', 'Walked by the store'], ['SHOPEE_LAZADA', 'Shopee / Lazada'], ['OTHER', 'Other']];
export const CHANNELS: [string, string][] = [['SMS', 'SMS'], ['EMAIL', 'Email'], ['WHATSAPP', 'WhatsApp'], ['VIBER', 'Viber'], ['MESSENGER', 'Messenger']];
export const label = (list: [string, string][], k: string | null | undefined) => list.find(([x]) => x === k)?.[1] ?? k ?? '';

interface Voucher { id: string; code: string; kind: 'AMOUNT' | 'PERCENT'; value: number; minPurchase: number; source: string; note: string | null; expiresOn: string; used: boolean; expired: boolean; discountApplied: number | null }
const vText = (v: { kind: string; value: number }) => (v.kind === 'PERCENT' ? `${v.value}% off` : `${peso(v.value)} off`);

/** Tier, points, vouchers, contact log and fitness profile of one member (inside the member window). */
export function MemberExtras({ id }: { id: string }) {
  const { can } = useAuth(); const qc = useQueryClient(); const manage = can('member.manage');
  const st = useQuery({ queryKey: ['member-standing', id], queryFn: () => api.get<{ tier: string; points: number; spent12m: number; nextTier: string | null; toNextTier: number | null } | null>(`/api/members/${id}/standing`) });
  const vs = useQuery({ queryKey: ['member-vouchers', id], queryFn: () => api.get<Voucher[]>(`/api/members/${id}/vouchers`) });
  const notes = useQuery({ queryKey: ['member-notes', id], queryFn: () => api.get<{ id: string; kind: string; text: string; createdByName: string | null; createdAt: string }[]>(`/api/members/${id}/notes`) });
  const rep = useQuery({ queryKey: ['member-repl', id], queryFn: () => api.get<{ id: string; ticketNo: string; status: string; drSiNo: string; date: string; qty: number }[]>(`/api/members/${id}/replacements`) });
  const sug = useQuery({ queryKey: ['member-sug', id], queryFn: () => api.get<{ usual: { name: string; qty: number }[]; alsoBuy: { name: string; together: number }[] }>(`/api/members/${id}/suggestions`) });
  const [v, setV] = useState({ kind: 'AMOUNT', value: '', validDays: '', minPurchase: '', note: '' }); const [pts, setPts] = useState({ points: '', reason: '' }); const [note, setNote] = useState({ kind: 'CALL', text: '' });
  const again = () => { for (const k of ['member-standing', 'member-vouchers', 'member-notes']) void qc.invalidateQueries({ queryKey: [k, id] }); void qc.invalidateQueries({ queryKey: ['members'] }); };
  const issue = useMutation({ mutationFn: () => api.post(`/api/members/${id}/vouchers`, { kind: v.kind, value: Number(v.value), validDays: v.validDays ? Number(v.validDays) : undefined, minPurchase: v.minPurchase ? Number(v.minPurchase) : undefined, note: v.note || undefined }), onSuccess: () => { setV({ kind: 'AMOUNT', value: '', validDays: '', minPurchase: '', note: '' }); again(); } });
  const adjust = useMutation({ mutationFn: () => api.post(`/api/members/${id}/points`, { points: Number(pts.points), reason: pts.reason }), onSuccess: () => { setPts({ points: '', reason: '' }); again(); } });
  const addNote = useMutation({ mutationFn: () => api.post(`/api/members/${id}/notes`, note), onSuccess: () => { setNote({ kind: 'CALL', text: '' }); again(); } });
  const s = st.data;
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Stat label="Tier" value={s ? <Badge tone={TIER_TONE[s.tier] ?? 'slate'}>{s.tier}</Badge> : '—'} sub={s?.nextTier ? `${peso(s.toNextTier)} more to ${s.nextTier}` : 'Top tier'} />
      <Stat label="Points" value={s?.points ?? 0} sub="1 point per ₱100 (Owner can change)" /><Stat label="Spent, last 12 months" value={peso(s?.spent12m ?? 0)} />
      <Stat label="Vouchers ready" value={(vs.data ?? []).filter((x) => !x.used && !x.expired).length} />
    </div>
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Vouchers">
        {vs.data?.length ? <ul className="divide-y text-sm">{vs.data.map((x) => <li key={x.id} className="flex flex-wrap items-center gap-2 py-1.5"><b className="font-mono">{x.code}</b><span>{vText(x)}</span>{x.minPurchase > 0 && <span className="text-xs text-slate-500">min {peso(x.minPurchase)}</span>}<span className="text-xs text-slate-500">{x.source.toLowerCase()}{x.note ? ` · ${x.note}` : ''}</span><span className="ml-auto">{x.used ? <Badge tone="slate">used {peso(x.discountApplied ?? 0)}</Badge> : x.expired ? <Badge tone="red">expired</Badge> : <Badge tone="green">until {fmtDate(x.expiresOn)}</Badge>}</span></li>)}</ul> : <Empty>No vouchers yet.</Empty>}
        {manage && <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3 md:grid-cols-5"><Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}><option value="AMOUNT">₱ off</option><option value="PERCENT">% off</option></Select><Input type="number" min={1} placeholder="Value" value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} /><Input type="number" min={0} placeholder="Min. spend" value={v.minPurchase} onChange={(e) => setV({ ...v, minPurchase: e.target.value })} /><Input type="number" min={1} placeholder="Valid days" value={v.validDays} onChange={(e) => setV({ ...v, validDays: e.target.value })} /><Button size="sm" disabled={!Number(v.value) || issue.isPending} onClick={() => issue.mutate()}>Give voucher</Button></div>}
        <ErrorBox error={issue.error} />
      </Card>
      <Card title="Points">
        <p className="text-sm text-slate-600">Points come from purchases tagged to the member. The member can turn points into a voucher on their member page.</p>
        {manage && <div className="mt-3 grid grid-cols-3 gap-2"><Input type="number" placeholder="+ or − points" value={pts.points} onChange={(e) => setPts({ ...pts, points: e.target.value })} /><Input className="col-span-2" placeholder="Reason (required)" value={pts.reason} onChange={(e) => setPts({ ...pts, reason: e.target.value })} /><Button size="sm" disabled={!Number(pts.points) || pts.reason.trim().length < 3 || adjust.isPending} onClick={() => adjust.mutate()}>Adjust points</Button></div>}
        <ErrorBox error={adjust.error} />
        {sug.data && (sug.data.usual.length > 0) && <div className="mt-3 border-t pt-2 text-sm"><div className="text-xs font-semibold uppercase text-slate-500">Usually buys</div><p>{sug.data.usual.slice(0, 5).map((u) => `${u.name} (${u.qty})`).join(', ')}</p>{sug.data.alsoBuy.length > 0 && <><div className="mt-1 text-xs font-semibold uppercase text-slate-500">Members who buy these also take</div><p>{sug.data.alsoBuy.map((a) => a.name).join(', ')}</p></>}</div>}
      </Card>
    </div>
    <Card title="Contact log (calls, messages, complaints)">
      {manage && <div className="mb-3 grid gap-2 md:grid-cols-[9rem_1fr_auto]"><Select value={note.kind} onChange={(e) => setNote({ ...note, kind: e.target.value })}><option value="CALL">Call</option><option value="MESSAGE">Message</option><option value="COMPLAINT">Complaint</option><option value="NOTE">Note</option></Select><Input placeholder="What was said or done" value={note.text} onChange={(e) => setNote({ ...note, text: e.target.value })} /><Button size="sm" disabled={note.text.trim().length < 2 || addNote.isPending} onClick={() => addNote.mutate()}>Add</Button></div>}
      <ErrorBox error={addNote.error} />
      {notes.data?.length ? <ul className="divide-y text-sm">{notes.data.map((n) => <li key={n.id} className="py-1.5"><Badge tone={n.kind === 'COMPLAINT' ? 'red' : n.kind === 'CALL' ? 'blue' : 'slate'}>{n.kind.toLowerCase()}</Badge> <span>{n.text}</span> <span className="text-xs text-slate-500">· {n.createdByName ?? 'system'} · {fmtDate(n.createdAt)}</span></li>)}</ul> : <Empty>Nothing logged yet.</Empty>}
    </Card>
    {rep.data && rep.data.length > 0 && <Card title="Replacement tickets on this member's purchases"><ul className="divide-y text-sm">{rep.data.map((r) => <li key={r.id} className="py-1.5"><b>{r.ticketNo}</b> · {r.drSiNo} · {r.qty} pc · <Badge>{r.status}</Badge> <span className="text-xs text-slate-500">{fmtDate(r.date)}</span></li>)}</ul></Card>}
  </div>;
}

/** Fitness profile fields (shared by the staff edit form). */
export function ProfileFields({ f, set }: { f: Record<string, string | boolean>; set: (k: string, v: string) => void }) {
  return <>
    <Field label="Main goal"><Select value={String(f.goal ?? '')} onChange={(e) => set('goal', e.target.value)}><option value="">—</option>{GOALS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
    <Field label="Gym / coach"><Input value={String(f.gym ?? '')} onChange={(e) => set('gym', e.target.value)} /></Field>
    <Field label="Training days"><Input placeholder="e.g. Mon-Wed-Fri" value={String(f.trainingDays ?? '')} onChange={(e) => set('trainingDays', e.target.value)} /></Field>
    <Field label="Monthly budget"><Input placeholder="e.g. ₱3,000" value={String(f.budget ?? '')} onChange={(e) => set('budget', e.target.value)} /></Field>
    <Field label="Dietary notes / allergies"><Input value={String(f.dietary ?? '')} onChange={(e) => set('dietary', e.target.value)} /></Field>
    <Field label="Favorite flavors"><Input value={String(f.flavorLikes ?? '')} onChange={(e) => set('flavorLikes', e.target.value)} /></Field>
    <Field label="Flavors they dislike"><Input value={String(f.flavorDislikes ?? '')} onChange={(e) => set('flavorDislikes', e.target.value)} /></Field>
    <Field label="Heard about us from"><Select value={String(f.heardFrom ?? '')} onChange={(e) => set('heardFrom', e.target.value)}><option value="">—</option>{HEARD.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
    <Field label="Best way to reach"><Select value={String(f.preferredChannel ?? '')} onChange={(e) => set('preferredChannel', e.target.value)}><option value="">—</option>{CHANNELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
    <Field label="Best time"><Select value={String(f.bestTime ?? '')} onChange={(e) => set('bestTime', e.target.value)}><option value="">—</option><option value="MORNING">Morning</option><option value="AFTERNOON">Afternoon</option><option value="EVENING">Evening</option></Select></Field>
    <Field label="Messenger / Viber name or number"><Input value={String(f.messengerHandle ?? '')} onChange={(e) => set('messengerHandle', e.target.value)} /></Field>
  </>;
}

/** The best members, and who has not been called in a month. */
export function TopSpenders() {
  const { can } = useAuth(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['top-spenders'], queryFn: () => api.get<{ id: string; memberNo: string; fullName: string; phone: string | null; tier: string; spent12m: number; orders: number; lastPurchase: string | null; favoriteProduct: string | null; lastContact: string | null; daysSinceContact: number | null; needsCall: boolean }[]>('/api/member-program/top-spenders?limit=30') });
  const [call, setCall] = useState<{ id: string; name: string } | null>(null); const [text, setText] = useState('');
  const log = useMutation({ mutationFn: () => api.post(`/api/members/${call!.id}/notes`, { kind: 'CALL', text }), onSuccess: () => { setCall(null); setText(''); void qc.invalidateQueries({ queryKey: ['top-spenders'] }); } });
  return <Card title="Top spenders (last 12 months)">
    <p className="mb-2 text-sm text-slate-600">Your best customers. “Call due” means nobody logged a call or message in the last 30 days: call or message them, then press “Log a call”.</p>
    <ErrorBox error={q.error} />
    {q.data?.length ? <DataTable columnSearch exportName="TopSpenders" data={q.data} columns={[
      { header: 'Member', accessorFn: (r) => `${r.fullName} (${r.memberNo})` }, { header: 'Tier', accessorKey: 'tier', cell: (c) => <Badge tone={TIER_TONE[String(c.getValue())] ?? 'slate'}>{String(c.getValue())}</Badge> }, { header: 'Phone', accessorFn: (r) => r.phone ?? '' },
      { header: 'Spent (12 mo)', accessorKey: 'spent12m', cell: (c) => peso(c.getValue()) }, { header: 'Orders', accessorKey: 'orders' }, { header: 'Last purchase', accessorFn: (r) => r.lastPurchase ?? '' }, { header: 'Favorite', accessorFn: (r) => r.favoriteProduct ?? '' },
      { header: 'Last contact', accessorFn: (r) => (r.lastContact ? `${fmtDate(r.lastContact)} (${r.daysSinceContact} d ago)` : 'never'), cell: (c) => <span className={c.row.original.needsCall ? 'font-semibold text-red-700' : ''}>{String(c.getValue())}{c.row.original.needsCall ? ' · call due' : ''}</span> },
      ...(can('member.manage') ? [{ header: '', id: 'act', cell: (c: { row: { original: { id: string; fullName: string } } }) => <Button size="sm" variant="outline" onClick={() => setCall({ id: c.row.original.id, name: c.row.original.fullName })}>Log a call</Button> }] : []),
    ]} /> : <Empty>No member has purchases tagged to them yet.</Empty>}
    {call && <Modal title={`Log a call: ${call.name}`} onClose={() => setCall(null)}><Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="What was said (e.g. thanked for loyalty, offered 10% voucher…)" /><ErrorBox error={log.error} /><div className="mt-3 flex gap-2"><Button disabled={text.trim().length < 2 || log.isPending} onClick={() => log.mutate()}>Save</Button><Button variant="ghost" onClick={() => setCall(null)}>Cancel</Button></div></Modal>}
  </Card>;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** When customers buy, where members come from, and how many sales carry a member. */
export function Insights() {
  const [membersOnly, setMembersOnly] = useState(false); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const hm = useQuery({ queryKey: ['heatmap', membersOnly, from, to], queryFn: () => api.get<{ from: string; to: string; total: number; cells: { dow: number; hour: number; orders: number; amount: number }[]; byBranch: { branch: string; orders: number; amount: number }[] }>(`/api/member-program/heatmap?${membersOnly ? 'membersOnly=1&' : ''}${from ? `from=${from}&` : ''}${to ? `to=${to}` : ''}`) });
  const acq = useQuery({ queryKey: ['acquisition'], queryFn: () => api.get<Record<'heardFrom' | 'goal' | 'gym' | 'preferred' | 'tier' | 'source', { label: string; members: number; buyers: number; spent: number; avgSpent: number }[]> & { total: number }>('/api/member-program/acquisition') });
  const cap = useQuery({ queryKey: ['capture'], queryFn: () => api.get<{ from: string; to: string; targetPct: number; branches: { branch: string; sales: number; tagged: number; pct: number; met: boolean }[]; associates: { associate: string; branch: string; sales: number; tagged: number; pct: number; met: boolean }[] }>('/api/member-program/capture') });
  const cells = hm.data?.cells ?? []; const max = Math.max(1, ...cells.map((c) => c.orders)); const hours = [...new Set(cells.map((c) => c.hour))]; const lo = Math.min(8, ...hours), hi = Math.max(21, ...hours);
  const at = (d: number, h: number) => cells.find((c) => c.dow === d && c.hour === h);
  const table = (title: string, rows?: { label: string; members: number; buyers: number; spent: number; avgSpent: number }[], names?: [string, string][]) => <Card title={title}>{rows?.length ? <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1 pr-3">Group</th><th className="num pr-3">Members</th><th className="num pr-3">Bought</th><th className="num pr-3">Spent</th><th className="num">Per member</th></tr></thead><tbody>{rows.map((r) => <tr key={r.label} className="border-t"><td className="py-1 pr-3">{names ? label(names, r.label) : r.label}</td><td className="num pr-3">{r.members}</td><td className="num pr-3">{r.buyers}</td><td className="num pr-3">{peso(r.spent)}</td><td className="num">{peso(r.avgSpent)}</td></tr>)}</tbody></table> : <Empty />}</Card>;
  return <div className="space-y-4">
    <Card title="When customers buy (day and hour, Manila time)">
      <div className="mb-3 flex flex-wrap items-end gap-3"><Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field><label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={membersOnly} onChange={(e) => setMembersOnly(e.target.checked)} /> Members only</label><span className="pb-2 text-sm text-slate-500">{hm.data ? `${hm.data.total} sales, ${hm.data.from} to ${hm.data.to} (last 90 days when blank)` : ''}</span></div>
      <ErrorBox error={hm.error} />
      <div className="overflow-x-auto"><table className="text-xs"><thead><tr><th />{Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((h) => <th key={h} className="px-1 font-normal text-slate-500">{h}</th>)}</tr></thead><tbody>{DOW.map((d, i) => <tr key={d}><td className="pr-2 font-semibold text-slate-600">{d}</td>{Array.from({ length: hi - lo + 1 }, (_, k) => lo + k).map((h) => { const c = at(i, h); const a = c ? 0.12 + 0.88 * (c.orders / max) : 0; return <td key={h} title={c ? `${d} ${h}:00 · ${c.orders} sales · ${peso(c.amount)}` : ''} className="h-8 w-8 min-w-8 rounded text-center" style={{ background: c ? `rgba(225, 29, 72, ${a})` : '#f1f5f9', color: a > 0.55 ? '#fff' : '#475569' }}>{c?.orders ?? ''}</td>; })}</tr>)}</tbody></table></div>
      <p className="mt-2 text-xs text-slate-500">Darker = more sales. Use it to time promos, SMS blasts and staff coverage.</p>
    </Card>
    <Card title="Sales tagged to a member, against the target">
      <p className="mb-2 text-sm text-slate-600">Share of sales where the counter scanned or picked the member. Target: <b>{cap.data?.targetPct ?? 30}%</b> ({cap.data?.from} to {cap.data?.to}).</p>
      <div className="grid gap-4 md:grid-cols-2">
        <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Branch</th><th className="num">Sales</th><th className="num">With member</th><th className="num">%</th></tr></thead><tbody>{cap.data?.branches.map((b) => <tr key={b.branch} className="border-t"><td className="py-1">{b.branch}</td><td className="num">{b.sales}</td><td className="num">{b.tagged}</td><td className={`num font-semibold ${b.met ? 'text-emerald-700' : 'text-red-700'}`}>{b.pct}%</td></tr>)}</tbody></table>
        <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Sales associate</th><th className="num">Sales</th><th className="num">With member</th><th className="num">%</th></tr></thead><tbody>{cap.data?.associates.map((b) => <tr key={`${b.associate}${b.branch}`} className="border-t"><td className="py-1">{b.associate} <span className="text-xs text-slate-500">{b.branch}</span></td><td className="num">{b.sales}</td><td className="num">{b.tagged}</td><td className={`num font-semibold ${b.met ? 'text-emerald-700' : 'text-red-700'}`}>{b.pct}%</td></tr>)}</tbody></table>
      </div>
    </Card>
    <div className="grid gap-4 md:grid-cols-2">{table('Where members heard about us', acq.data?.heardFrom, HEARD)}{table('Members by goal', acq.data?.goal, GOALS)}{table('Members by gym / outlet', acq.data?.gym)}{table('Members by tier', acq.data?.tier)}{table('Best way to reach them', acq.data?.preferred, CHANNELS)}{table('How they joined', acq.data?.source)}</div>
  </div>;
}

/** What members say after a purchase. */
export function Feedback() {
  const [days, setDays] = useState('90');
  const q = useQuery({ queryKey: ['feedback', days], queryFn: () => api.get<{ responses: number; average: number | null; distribution: { stars: number; count: number }[]; byBranch: { branch: string; average: number | null; responses: number }[]; products: { productId: string; sku: string; product: string; yes: number; no: number; votes: number; wouldBuyAgainPct: number; disappointing: boolean }[]; latest: { id: string; date: string; member: string; memberNo: string; branch: string; drSiNo: string; rating: number; comment: string | null; low: boolean }[] }>(`/api/member-program/feedback?days=${days}`) });
  const d = q.data;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-3"><Field label="Period"><Select value={days} onChange={(e) => setDays(e.target.value)}><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option></Select></Field><p className="pb-2 text-sm text-slate-600">Members rate a purchase from the link we send them (or from My purchases on their member page). A low rating creates a complaint note and tells the Sales Manager.</p></div>
    <ErrorBox error={q.error} />
    {d && <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Responses" value={d.responses} /><Stat label="Average rating" value={d.average ? `${d.average} / 5` : '—'} />{d.distribution.filter((x) => x.stars <= 2 || x.stars === 5).map((x) => <Stat key={x.stars} label={`${x.stars} star`} value={x.count} />).slice(0, 2)}</div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="By branch">{d.byBranch.length ? <ul className="divide-y text-sm">{d.byBranch.map((b) => <li key={b.branch} className="flex py-1.5"><span className="flex-1">{b.branch}</span><span className="font-semibold">{b.average} / 5</span><span className="ml-3 text-xs text-slate-500">{b.responses} rating(s)</span></li>)}</ul> : <Empty />}</Card>
        <Card title="Would buy again?">{d.products.length ? <ul className="divide-y text-sm">{d.products.map((p) => <li key={p.productId} className="flex py-1.5"><span className="flex-1">{p.product}</span><span className={`font-semibold ${p.disappointing ? 'text-red-700' : ''}`}>{p.wouldBuyAgainPct}% yes</span><span className="ml-3 text-xs text-slate-500">{p.votes} vote(s){p.disappointing ? ' · look into it' : ''}</span></li>)}</ul> : <Empty />}</Card>
      </div>
      <Card title="Latest comments">{d.latest.length ? <ul className="divide-y text-sm">{d.latest.map((r) => <li key={r.id} className="py-1.5"><Badge tone={r.low ? 'red' : r.rating >= 4 ? 'green' : 'amber'}>{r.rating} / 5</Badge> <b>{r.member}</b> <span className="text-xs text-slate-500">{r.memberNo} · {r.branch} · {r.drSiNo} · {fmtDate(r.date)}</span>{r.comment && <p className="ml-1 text-slate-700">“{r.comment}”</p>}</li>)}</ul> : <Empty>No ratings yet.</Empty>}</Card>
    </>}
  </div>;
}

interface Offer { id: string; productId: string; sku: string; product: string; price: number; startsOn: string; endsOn: string | null; active: boolean; note: string | null }
/** Member prices: a lower price for tagged members, applied by the counter by itself. */
export function Offers() {
  const qc = useQueryClient(); const manage = useAuth().can('member.manage');
  const q = useQuery({ queryKey: ['member-offers'], queryFn: () => api.get<Offer[]>('/api/member-program/offers') });
  const [text, setText] = useState(''); const [pick, setPick] = useState<{ id: string; name: string } | null>(null); const [f, setF] = useState({ price: '', startsOn: '', endsOn: '', note: '' });
  const prods = useQuery({ queryKey: ['offer-prod', text], queryFn: () => api.get<{ id: string; sku: string; name: string }[]>(`/api/products?search=${encodeURIComponent(text)}&take=8`), enabled: text.trim().length >= 2 && !pick });
  const save = useMutation({ mutationFn: (o: { id?: string; productId: string; price: number; startsOn?: string; endsOn?: string | null; active?: boolean; note?: string | null }) => api.post('/api/member-program/offers', o), onSuccess: () => { setPick(null); setText(''); setF({ price: '', startsOn: '', endsOn: '', note: '' }); void qc.invalidateQueries({ queryKey: ['member-offers'] }); } });
  return <Card title="Member prices">
    <p className="mb-3 text-sm text-slate-600">A lower price for Wheysted members. At the counter, when a member is picked and no price is typed, the member price is used by itself (no special-price approval needed). Non-members still pay the normal price.</p>
    {manage && <div className="mb-4 grid gap-2 md:grid-cols-6">
      <div className="relative md:col-span-2">{pick ? <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm">{pick.name}<button className="ml-auto text-red-600" onClick={() => setPick(null)}>✕</button></div> : <Input placeholder="Search the item…" value={text} onChange={(e) => setText(e.target.value)} />}{!pick && prods.data && prods.data.length > 0 && <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border bg-white text-sm shadow-lg">{prods.data.map((p) => <li key={p.id}><button className="w-full px-3 py-2 text-left hover:bg-slate-50" onClick={() => { setPick({ id: p.id, name: `${p.sku} · ${p.name}` }); setText(''); }}>{p.sku} · {p.name}</button></li>)}</ul>}</div>
      <Input type="number" min={1} placeholder="Member price" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /><Input type="date" title="Starts" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} /><Input type="date" title="Ends (optional)" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} />
      <Button disabled={!pick || !Number(f.price) || save.isPending} onClick={() => save.mutate({ productId: pick!.id, price: Number(f.price), startsOn: f.startsOn || undefined, endsOn: f.endsOn || null, note: f.note || null })}>Add</Button>
    </div>}
    <ErrorBox error={save.error ?? q.error} />
    {q.data?.length ? <DataTable columnSearch data={q.data} columns={[{ header: 'SKU', accessorKey: 'sku' }, { header: 'Item', accessorKey: 'product' }, { header: 'Member price', accessorKey: 'price', cell: (c) => peso(c.getValue()) }, { header: 'From', accessorKey: 'startsOn' }, { header: 'Until', accessorFn: (r) => r.endsOn ?? 'no end' }, { header: 'Active', accessorFn: (r) => (r.active ? 'yes' : 'no'), cell: (c) => (manage ? <Toggle checked={c.row.original.active} onChange={(v) => save.mutate({ id: c.row.original.id, productId: c.row.original.productId, price: c.row.original.price, active: v })} /> : String(c.getValue())) }]} /> : <Empty>No member prices yet.</Empty>}
  </Card>;
}

/** What customers asked for and we did not have. */
export function LostSales() {
  const [days, setDays] = useState('30');
  const q = useQuery({ queryKey: ['lost-sales', days], queryFn: () => api.get<{ total: number; items: { productId: string | null; item: string; requests: number; qty: number; branches: string; last: string }[]; recent: { id: string; item: string; qty: number; branch: string; note: string | null; date: string }[] }>(`/api/member-program/lost-sales?days=${days}`) });
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-3"><Field label="Period"><Select value={days} onChange={(e) => setDays(e.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></Select></Field><p className="pb-2 text-sm text-slate-600">Counter staff log an item a customer asked for and we did not have (New Sale → “Item we didn't have”). Most-asked first: buy or restock these.</p></div>
    <ErrorBox error={q.error} />
    <Card title={`Asked for, not available (${q.data?.total ?? 0} request(s))`}>{q.data?.items.length ? <DataTable columnSearch exportName="LostSales" data={q.data.items} columns={[{ header: 'Item', accessorKey: 'item' }, { header: 'Times asked', accessorKey: 'requests' }, { header: 'Pieces', accessorKey: 'qty' }, { header: 'Branches', accessorKey: 'branches' }, { header: 'Last asked', accessorKey: 'last' }]} /> : <Empty>Nothing logged.</Empty>}</Card>
  </div>;
}

/** The Owner's rules: points, tiers, vouchers and the automatic messages. */
export function ProgramSettings() {
  const qc = useQueryClient(); const manage = useAuth().can('member.manage');
  const q = useQuery({ queryKey: ['member-program'], queryFn: () => api.get<Record<string, number | boolean | string>>('/api/member-program/settings') });
  const [f, setF] = useState<Record<string, number | boolean | string> | null>(null); const cur = f ?? q.data; const [info, setInfo] = useState('');
  const save = useMutation({ mutationFn: () => api.post('/api/member-program/settings', f), onSuccess: () => { setInfo('Saved.'); setF(null); void qc.invalidateQueries({ queryKey: ['member-program'] }); } });
  const run = useMutation({ mutationFn: () => api.post<Record<string, number>>('/api/member-program/run-automation'), onSuccess: (r) => setInfo(`Ran now: ${r.birthday} birthday, ${r.anniversary} anniversary, ${r.reorder} re-order, ${r.winback} win-back, ${r.survey} survey, ${r.backInStock} back-in-stock message(s) sent${r.notConfigured ? `; ${r.notConfigured} could not be sent because email / SMS is not set up` : ''}.`) });
  if (!cur) return <Empty>Loading…</Empty>;
  const set = (k: string, v: number | boolean | string) => { setInfo(''); setF({ ...cur, [k]: v }); };
  const num = (k: string, lab: string, hint?: string) => <Field label={lab} hint={hint}><Input type="number" min={0} disabled={!manage} value={Number(cur[k])} onChange={(e) => set(k, Number(e.target.value))} /></Field>;
  const tog = (k: string, lab: string) => <label className="flex items-center gap-3 text-sm"><Toggle checked={!!cur[k]} disabled={!manage} onChange={(v) => set(k, v)} />{lab}</label>;
  return <div className="space-y-4">
    <Card title="Points and tiers">
      <div className="grid gap-3 md:grid-cols-4">{num('pesoPerPoint', '₱ spent for 1 point')}{num('pointValue', 'Peso value of 1 point')}{num('minRedeemPoints', 'Least points to redeem')}{num('voucherValidDays', 'Voucher valid for (days)')}{num('silverFrom', 'Silver tier from (₱ in 12 months)')}{num('goldFrom', 'Gold tier from (₱ in 12 months)')}{num('referralValue', 'Referral voucher (₱, each)', 'Given to both when a referred member makes a first purchase')}{num('captureTargetPct', 'Sales with a member: target %')}</div>
    </Card>
    <Card title="Automatic messages (sent every morning at 9:00 Manila time)">
      <p className="mb-3 text-sm text-slate-600">Each goes by SMS or email, whichever the member prefers and agreed to, and never twice. Email / SMS must be set up in api/.env first. Messages are off until you turn them on.</p>
      <div className="grid gap-3 md:grid-cols-2">
        {tog('backInStockAuto', 'Back in stock: tell members who pressed “tell me when available”')}{tog('reorderAuto', 'Re-order reminder when a product they bought should be finished')}
        {tog('birthdayAuto', 'Birthday message with a voucher')}{tog('anniversaryAuto', 'Member anniversary message with a voucher')}
        {tog('winbackAuto', 'Win-back voucher for members who stopped buying (46+ days)')}{tog('surveyAuto', 'Ask for a rating a few days after a purchase')}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <Field label="Birthday voucher type"><Select disabled={!manage} value={String(cur.birthdayKind)} onChange={(e) => set('birthdayKind', e.target.value)}><option value="AMOUNT">₱ off</option><option value="PERCENT">% off</option></Select></Field>{num('birthdayValue', 'Birthday voucher value')}{num('anniversaryValue', 'Anniversary voucher (₱)')}{num('winbackValue', 'Win-back voucher (₱)')}{num('winbackMinPurchase', 'Win-back needs a purchase of (₱)')}{num('surveyDays', 'Rating request after (days)')}{num('surveyLowRating', 'Rating counted as low (stars or less)')}
      </div>
    </Card>
    <ErrorBox error={save.error ?? run.error} />{info && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{info}</p>}
    {manage && <div className="flex flex-wrap gap-2"><Button disabled={!f || save.isPending} onClick={() => save.mutate()}>Save rules</Button><Button variant="outline" disabled={run.isPending} onClick={() => { if (confirm('Send today\'s automatic messages now? Only the ones switched on above go out, and nobody gets the same message twice.')) run.mutate(); }}>Run the automatic messages now</Button></div>}
  </div>;
}

interface Resv { id: string; member: string; memberNo: string; phone: string | null; product: string; sku: string; qty: number; branch: string; status: string; note: string | null; date: string }
/** Items members reserved on their member page, to be prepared at the branch. */
export function ReservationsPage() {
  const qc = useQueryClient(); const [status, setStatus] = useState('');
  const q = useQuery({ queryKey: ['reservations', status], queryFn: () => api.get<Resv[]>(`/api/member-program/reservations${status ? `?status=${status}` : ''}`), refetchInterval: 30000 });
  const set = useMutation({ mutationFn: (x: { id: string; status: string }) => api.post(`/api/member-program/reservations/${x.id}`, { status: x.status }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['reservations'] }) });
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Member Reservations</h1><Select className="max-w-48" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Open (requested / ready)</option><option value="PICKED_UP">Picked up</option><option value="CANCELLED">Cancelled</option></Select></div>
    <p className="text-sm text-slate-600">Members reserve items on their member page and choose a branch to pick up. Prepare the item, press <b>Ready</b> (the member is told by SMS / email), then <b>Picked up</b> when they collect it and record the sale with their member card.</p>
    <ErrorBox error={q.error ?? set.error} />
    <Card>{q.data?.length ? <DataTable columnSearch data={q.data} columns={[{ header: 'Requested', accessorKey: 'date' }, { header: 'Member', accessorFn: (r) => `${r.member} (${r.memberNo})` }, { header: 'Phone', accessorFn: (r) => r.phone ?? '' }, { header: 'Item', accessorFn: (r) => `${r.sku} · ${r.product}` }, { header: 'Qty', accessorKey: 'qty' }, { header: 'Branch', accessorKey: 'branch' }, { header: 'Note', accessorFn: (r) => r.note ?? '' }, { header: 'Status', accessorKey: 'status', cell: (c) => <Badge tone={c.getValue() === 'READY' ? 'green' : c.getValue() === 'REQUESTED' ? 'amber' : 'slate'}>{String(c.getValue())}</Badge> }, { header: '', id: 'act', cell: (c) => <div className="flex gap-1">{c.row.original.status === 'REQUESTED' && <Button size="sm" onClick={() => set.mutate({ id: c.row.original.id, status: 'READY' })}>Ready</Button>}{['REQUESTED', 'READY'].includes(c.row.original.status) && <><Button size="sm" variant="outline" onClick={() => set.mutate({ id: c.row.original.id, status: 'PICKED_UP' })}>Picked up</Button><Button size="sm" variant="ghost" onClick={() => { if (confirm('Cancel this reservation?')) set.mutate({ id: c.row.original.id, status: 'CANCELLED' }); }}>Cancel</Button></>}</div> }]} /> : <Empty>No reservations.</Empty>}</Card>
  </div>;
}
