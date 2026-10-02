import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate, peso } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, Select, Stat } from '@/components/ui/primitives';
import { Segmented } from '@/components/ui/widgets';
import { DataTable } from '@/components/ui/table';
import { QrCode } from '@/components/QrCode';
import { Feedback, GOALS, Insights, LostSales, MemberExtras, Offers, ProgramSettings, ProfileFields, TIER_TONE, TopSpenders, label, HEARD, CHANNELS } from './MemberProgram';

interface Row { id: string; memberNo: string; fullName: string; phone: string | null; email: string | null; birthday: string | null; source: string; status: string; emailOptIn: boolean; smsOptIn: boolean; hasPortal: boolean; joined: string; orders: number; spent: number; avgOrder: number; firstPurchase: string | null; lastPurchase: string | null; daysSince: number | null; ordersPerMonth: number; favoriteProduct: string | null; favoriteBrand: string | null; favoriteCategory: string | null; topBranch: string | null; segments: string[]; tier: string; points: number; spent12m: number; goal: string | null; gym: string | null; heardFrom: string | null; preferredChannel: string | null; bestTime: string | null; outletName: string | null; messengerHandle: string | null }
interface Detail extends Row { trainingDays: string | null; budget: string | null; dietary: string | null; flavorLikes: string | null; flavorDislikes: string | null; referralNo?: string | null; notes: string | null; qr: string; consentAt: string | null; lastLoginAt: string | null; purchases: { id: string; date: string; drSiNo: string; branch: string; total: number; paymentMode: string; items: { name: string; qty: number; price: number; amount: number; freebie: boolean }[] }[]; favorites: { name: string; qty: number; times: number; amount: number }[]; monthly: { month: string; total: number; orders: number }[] }
interface Who { memberId: string | null; memberNo: string | null; name: string | null; phone: string | null; email: string | null; times: number; qty: number; spent: number; lastBought: string; items: string }

const SEG: Record<string, { label: string; tone: 'purple' | 'green' | 'blue' | 'amber' | 'red' | 'slate' }> = { VIP: { label: 'VIP', tone: 'purple' }, FREQUENT: { label: 'Frequent', tone: 'green' }, NEW: { label: 'New', tone: 'blue' }, AT_RISK: { label: 'At risk', tone: 'amber' }, LAPSED: { label: 'Lapsed', tone: 'red' }, NEVER: { label: 'Never bought', tone: 'slate' }, BIRTHDAY: { label: 'Birthday month', tone: 'blue' } };

/** Wheysted members: who they are, what and how often they buy, the QR card, and who bought a given item. */
export function MembersPage() {
  const { can } = useAuth(); const qc = useQueryClient(); const manage = can('member.manage');
  const [tab, setTab] = useState<'members' | 'item' | 'top' | 'insights' | 'feedback' | 'offers' | 'lost' | 'program'>('members'); const [segment, setSegment] = useState(''); const [open, setOpen] = useState<string | null>(null); const [msg, setMsg] = useState('');
  const list = useQuery({ queryKey: ['members'], queryFn: () => api.get<Row[]>('/api/members') });
  const segs = useQuery({ queryKey: ['member-segments'], queryFn: () => api.get<{ key: string; label: string }[]>('/api/members/segments') });
  const rows = useMemo(() => (list.data ?? []).filter((r) => !segment || r.segments.includes(segment)).sort((a, b) => b.spent - a.spent), [list.data, segment]);
  const all = list.data ?? [];
  const count = (k: string) => all.filter((r) => r.segments.includes(k)).length;
  const imp = useMutation({ mutationFn: () => api.post<{ message: string }>('/api/members/import-from-sales'), onSuccess: (r) => { setMsg(r.message); void qc.invalidateQueries({ queryKey: ['members'] }); } });
  const [adding, setAdding] = useState(false);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Wheysted Members</h1>
      {manage && <><Button onClick={() => setAdding(true)}>+ New member</Button><Button variant="outline" disabled={imp.isPending} onClick={() => { if (confirm('Make members from the customers in your sales (name + mobile or email)? Their past purchases will be put on their accounts.')) { setMsg(''); imp.mutate(); } }}>Make members from my sales</Button></>}
      {can('member.blast') && <Link className="text-sm text-brand underline" to="/campaigns">Email & SMS campaigns</Link>}</div>
    {msg && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{msg}</p>}<ErrorBox error={imp.error} />
    <Segmented value={tab} onChange={setTab} options={[['members', 'Members'], ['item', 'Who bought this item'], ['top', 'Top spenders'], ['insights', 'Insights'], ['feedback', 'Feedback'], ['offers', 'Member prices'], ['lost', 'Lost sales'], ['program', 'Program rules']]} />
    {tab === 'members' && <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5"><Stat label="Members" value={all.length} /><Stat label="VIP" value={count('VIP')} /><Stat label="Frequent buyers" value={count('FREQUENT')} /><Stat label="At risk / lapsed" value={count('AT_RISK') + count('LAPSED')} tone={count('AT_RISK') + count('LAPSED') ? 'amber' : undefined} /><Stat label="New (30 days)" value={count('NEW')} /></div>
      <div className="flex flex-wrap items-end gap-3"><Field label="Show"><Select value={segment} onChange={(e) => setSegment(e.target.value)}><option value="">All members</option>{segs.data?.map((s) => <option key={s.key} value={s.key}>{s.label} ({count(s.key)})</option>)}</Select></Field><p className="pb-2 text-xs text-slate-500">Click any column title to sort (for example by amount spent, orders, days since the last purchase, or favorite item). Under each title you can filter by that column.</p></div>
      <ErrorBox error={list.error} />
      <DataTable columnSearch exportName="WheystedMembers" onRowClick={(r) => setOpen(r.id)} data={rows} columns={[
        { header: 'Member no.', accessorKey: 'memberNo' }, { header: 'Name', accessorKey: 'fullName' }, { header: 'Phone', accessorFn: (r) => r.phone ?? '' }, { header: 'Email', accessorFn: (r) => r.email ?? '' },
        { header: 'Orders', accessorKey: 'orders' }, { header: 'Spent', accessorKey: 'spent', cell: (c) => peso(c.getValue()) }, { header: 'Avg order', accessorKey: 'avgOrder', cell: (c) => peso(c.getValue()) },
        { header: 'Orders / month', accessorKey: 'ordersPerMonth' }, { header: 'Last purchase', accessorFn: (r) => r.lastPurchase ?? '' }, { header: 'Days since', accessorFn: (r) => (r.daysSince == null ? '' : r.daysSince) },
        { header: 'Favorite item', accessorFn: (r) => r.favoriteProduct ?? '' }, { header: 'Favorite brand', accessorFn: (r) => r.favoriteBrand ?? '' }, { header: 'Favorite category', accessorFn: (r) => r.favoriteCategory ?? '' }, { header: 'Main branch', accessorFn: (r) => r.topBranch ?? '' },
        { header: 'Segments', accessorFn: (r) => r.segments.map((s) => SEG[s]?.label ?? s).join(', '), cell: (c) => <div className="flex flex-wrap gap-1">{c.row.original.segments.map((s) => <Badge key={s} tone={SEG[s]?.tone ?? 'slate'}>{SEG[s]?.label ?? s}</Badge>)}</div> },
        { header: 'Tier', accessorKey: 'tier', cell: (c) => <Badge tone={TIER_TONE[String(c.getValue())] ?? 'slate'}>{String(c.getValue())}</Badge> }, { header: 'Points', accessorKey: 'points' }, { header: 'Goal', accessorFn: (r) => label(GOALS, r.goal) }, { header: 'Gym / outlet', accessorFn: (r) => r.outletName ?? r.gym ?? '' }, { header: 'Heard from', accessorFn: (r) => label(HEARD, r.heardFrom) }, { header: 'Best contact', accessorFn: (r) => label(CHANNELS, r.preferredChannel) },
        { header: 'Joined', accessorKey: 'joined' }, { header: 'Online account', accessorFn: (r) => (r.hasPortal ? 'yes' : 'no') }, { header: 'Birthday', accessorFn: (r) => r.birthday ?? '' },
      ]} />
      {!all.length && !list.isLoading && <Card><Empty>No members yet. Add one at the counter (New Sale → Wheysted member), press “+ New member”, or let customers sign up on the Wheysted page.</Empty></Card>}
    </>}
    {tab === 'item' && <WhoBought />}
    {tab === 'top' && <TopSpenders />}{tab === 'insights' && <Insights />}{tab === 'feedback' && <Feedback />}{tab === 'offers' && <Offers />}{tab === 'lost' && <LostSales />}{tab === 'program' && <ProgramSettings />}
    {open && <MemberModal id={open} onClose={() => setOpen(null)} />}
    {adding && <AddMember onClose={() => setAdding(false)} onDone={(id) => { setAdding(false); void qc.invalidateQueries({ queryKey: ['members'] }); setOpen(id); }} />}
  </div>;
}

function AddMember({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const [f, setF] = useState({ fullName: '', phone: '', email: '', birthday: '' });
  const save = useMutation({ mutationFn: () => api.post<{ id: string }>('/api/members', { fullName: f.fullName, phone: f.phone || null, email: f.email || null, birthday: f.birthday || null }), onSuccess: (m) => onDone(m.id) });
  return <Modal title="New Wheysted member" onClose={onClose}><div className="grid gap-3"><Field label="Full name *"><Input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field><Field label="Mobile number *"><Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field><Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field><Field label="Birthday"><Input type="date" value={f.birthday} onChange={(e) => setF({ ...f, birthday: e.target.value })} /></Field></div><ErrorBox error={save.error} /><div className="mt-3 flex gap-2"><Button disabled={f.fullName.trim().length < 2 || (f.phone.replace(/\D/g, '').length < 10 && !f.email) || save.isPending} onClick={() => save.mutate()}>Create</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div></Modal>;
}

/** Search an item (or type part of its name) and see which customers bought it. */
function WhoBought() {
  const [text, setText] = useState(''); const [productId, setProductId] = useState(''); const [productName, setProductName] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const prods = useQuery({ queryKey: ['wb-prod', text], queryFn: () => api.get<{ id: string; sku: string; name: string }[]>(`/api/products?search=${encodeURIComponent(text)}&take=12`), enabled: text.trim().length >= 2 && !productId });
  const search = productId || text.trim().length >= 2 ? (productId ? `productId=${productId}` : `search=${encodeURIComponent(text.trim())}`) : '';
  const q = useQuery({ queryKey: ['members-who', search, from, to], queryFn: () => api.get<Who[]>(`/api/members/who-bought?${search}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`), enabled: !!search && (!!productId || text.trim().length >= 3) });
  const { can } = useAuth();
  return <Card title="Which customers bought this item?">
    <div className="grid gap-3 md:grid-cols-4">
      <Field label="Item (name, SKU or brand)" className="md:col-span-2"><div className="relative"><Input value={productId ? productName : text} onChange={(e) => { setProductId(''); setText(e.target.value); }} placeholder="e.g. whey, creatine, Prothin…" />{!productId && (prods.data?.length ?? 0) > 0 && text.trim().length >= 2 && <ul className="absolute z-20 mt-1 max-h-56 w-full divide-y overflow-auto rounded-xl border bg-white text-sm shadow-lg">{prods.data!.map((p) => <li key={p.id}><button type="button" className="w-full px-3 py-2 text-left hover:bg-slate-50" onClick={() => { setProductId(p.id); setProductName(`${p.sku} · ${p.name}`); }}>{p.sku} · {p.name}</button></li>)}</ul>}</div></Field>
      <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
    </div>
    <p className="mt-1 text-xs text-slate-500">Pick one item from the list, or type part of a name to include every matching item. Members and also customers who only left a number or name at the counter are listed, most quantity first.</p>
    <ErrorBox error={q.error} />
    {q.data && (q.data.length ? <div className="mt-3"><DataTable columnSearch exportName="WhoBoughtItem" data={q.data} columns={[{ header: 'Member no.', accessorFn: (r) => r.memberNo ?? '— not a member' }, { header: 'Customer', accessorFn: (r) => r.name ?? '' }, { header: 'Phone', accessorFn: (r) => r.phone ?? '' }, { header: 'Email', accessorFn: (r) => r.email ?? '' }, { header: 'Times', accessorKey: 'times' }, { header: 'Quantity', accessorKey: 'qty' }, { header: 'Amount', accessorKey: 'spent', cell: (c) => peso(c.getValue()) }, { header: 'Last bought', accessorKey: 'lastBought', cell: (c) => fmtDate(c.getValue()) }, { header: 'Items', accessorKey: 'items' }]} />
      {can('member.blast') && productId && <p className="mt-2 text-sm"><Link className="text-brand underline" to={`/campaigns?productId=${productId}&name=${encodeURIComponent(productName)}`}>Send an email / SMS to the members who bought this item →</Link></p>}</div> : <Empty>Nobody has bought it (with a number or name) in this period.</Empty>)}
  </Card>;
}

function MemberModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuth(); const qc = useQueryClient(); const manage = can('member.manage');
  const q = useQuery({ queryKey: ['member', id], queryFn: () => api.get<Detail>(`/api/members/${id}`) });
  const m = q.data; const [edit, setEdit] = useState<Record<string, string | boolean> | null>(null); const [info, setInfo] = useState('');
  const again = () => { void qc.invalidateQueries({ queryKey: ['member', id] }); void qc.invalidateQueries({ queryKey: ['members'] }); };
  const save = useMutation({ mutationFn: () => api.post(`/api/members/${id}`, { fullName: edit!.fullName, phone: edit!.phone || null, email: edit!.email || null, birthday: edit!.birthday || null, notes: edit!.notes || null, emailOptIn: edit!.emailOptIn, smsOptIn: edit!.smsOptIn, ...Object.fromEntries(['goal', 'gym', 'trainingDays', 'budget', 'dietary', 'flavorLikes', 'flavorDislikes', 'heardFrom', 'preferredChannel', 'bestTime', 'messengerHandle'].map((k) => [k, edit![k] || null])) }), onSuccess: () => { setEdit(null); again(); } });
  const status = useMutation({ mutationFn: (s: string) => api.post(`/api/members/${id}`, { status: s }), onSuccess: again });
  const link = useMutation({ mutationFn: () => api.post<{ linked: number }>(`/api/members/${id}/link-past-sales`), onSuccess: (r) => { setInfo(`${r.linked} past sale(s) were put on this account.`); again(); } });
  const reset = useMutation({ mutationFn: () => api.post(`/api/members/${id}/reset-portal`), onSuccess: () => { setInfo('Online password cleared: the customer signs up again with the member number.'); again(); } });
  const max = Math.max(1, ...(m?.monthly.map((x) => x.total) ?? [1]));
  const startEdit = () => setEdit({ fullName: m!.fullName, phone: m!.phone ?? '', email: m!.email ?? '', birthday: m!.birthday ?? '', notes: m!.notes ?? '', emailOptIn: m!.emailOptIn, smsOptIn: m!.smsOptIn, goal: m!.goal ?? '', gym: m!.gym ?? '', trainingDays: m!.trainingDays ?? '', budget: m!.budget ?? '', dietary: m!.dietary ?? '', flavorLikes: m!.flavorLikes ?? '', flavorDislikes: m!.flavorDislikes ?? '', heardFrom: m!.heardFrom ?? '', preferredChannel: m!.preferredChannel ?? '', bestTime: m!.bestTime ?? '', messengerHandle: m!.messengerHandle ?? '' });
  return <Modal title={m ? `${m.fullName} · ${m.memberNo}` : 'Member'} onClose={onClose} wide>
    <ErrorBox error={q.error} />
    {m && <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="rounded-2xl border p-3 text-center"><QrCode value={m.qr} size={150} /><div className="mt-1 text-xs font-semibold text-navy">{m.memberNo}</div><Button size="sm" variant="outline" className="mt-1" onClick={() => printCard(m)}>Print card</Button></div>
        <div className="min-w-60 flex-1">
          <div className="flex flex-wrap gap-1">{m.segments.map((s) => <Badge key={s} tone={SEG[s]?.tone ?? 'slate'}>{SEG[s]?.label ?? s}</Badge>)}{m.status === 'BLOCKED' && <Badge tone="red">Blocked</Badge>}{m.hasPortal ? <Badge tone="green">Online account</Badge> : <Badge>No online account</Badge>}</div>
          {edit ? <div className="mt-2 grid gap-2 md:grid-cols-2">
            <Field label="Name"><Input value={String(edit.fullName)} onChange={(e) => setEdit({ ...edit, fullName: e.target.value })} /></Field><Field label="Mobile"><Input value={String(edit.phone)} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Email"><Input value={String(edit.email)} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field><Field label="Birthday"><Input type="date" value={String(edit.birthday)} onChange={(e) => setEdit({ ...edit, birthday: e.target.value })} /></Field>
            <Field label="Notes" className="md:col-span-2"><Input value={String(edit.notes)} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
            <ProfileFields f={edit} set={(k, v) => setEdit({ ...edit, [k]: v })} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!edit.emailOptIn} onChange={(e) => setEdit({ ...edit, emailOptIn: e.target.checked })} /> Agrees to emails</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!edit.smsOptIn} onChange={(e) => setEdit({ ...edit, smsOptIn: e.target.checked })} /> Agrees to SMS</label>
            <div className="flex gap-2 md:col-span-2"><Button disabled={save.isPending} onClick={() => save.mutate()}>Save</Button><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button></div></div>
          : <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm md:grid-cols-2">{[['Mobile', m.phone], ['Email', m.email], ['Goal', label(GOALS, m.goal) || null], ['Gym / outlet', m.outletName ?? m.gym], ['Training days', m.trainingDays], ['Budget', m.budget], ['Dietary', m.dietary], ['Likes', m.flavorLikes], ['Dislikes', m.flavorDislikes], ['Heard from', label(HEARD, m.heardFrom) || null], ['Best contact', [label(CHANNELS, m.preferredChannel), m.bestTime?.toLowerCase(), m.messengerHandle].filter(Boolean).join(' · ') || null], ['Birthday', m.birthday ? fmtDate(m.birthday) : null], ['Joined', `${fmtDate(m.joined)} (${m.source.toLowerCase()})`], ['Emails', m.emailOptIn ? 'agrees' : 'no'], ['SMS', m.smsOptIn ? 'agrees' : 'no'], ['Last sign-in', m.lastLoginAt ? fmtDate(m.lastLoginAt) : '—'], ['Notes', m.notes]].map(([k, v]) => <div key={k as string}><dt className="inline text-xs uppercase text-slate-500">{k}: </dt><dd className="inline">{v || '—'}</dd></div>)}</dl>}
          {manage && !edit && <div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={startEdit}>Edit</Button><Button size="sm" variant="outline" disabled={link.isPending} onClick={() => link.mutate()}>Put past sales with this number on the account</Button>{m.hasPortal && <Button size="sm" variant="outline" onClick={() => { if (confirm('Clear the online password? The customer signs up again with the member number.')) reset.mutate(); }}>Reset online password</Button>}<Button size="sm" variant={m.status === 'ACTIVE' ? 'danger' : 'outline'} onClick={() => status.mutate(m.status === 'ACTIVE' ? 'BLOCKED' : 'ACTIVE')}>{m.status === 'ACTIVE' ? 'Block' : 'Unblock'}</Button></div>}
          <ErrorBox error={save.error ?? status.error ?? link.error ?? reset.error} />{info && <p className="mt-1 text-sm text-emerald-700">{info}</p>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5"><Stat label="Orders" value={m.orders} /><Stat label="Spent" value={peso(m.spent)} /><Stat label="Average order" value={peso(m.avgOrder)} /><Stat label="Orders / month" value={m.ordersPerMonth} /><Stat label="Last purchase" value={m.lastPurchase ? fmtDate(m.lastPurchase) : '—'} sub={m.daysSince != null ? `${m.daysSince} days ago` : undefined} /></div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="What they buy most">{m.favorites.length ? <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Item</th><th className="num">Qty</th><th className="num">Times</th><th className="num">Amount</th></tr></thead><tbody>{m.favorites.map((f) => <tr key={f.name} className="border-t"><td className="py-1.5">{f.name}</td><td className="num">{f.qty}</td><td className="num">{f.times}</td><td className="num">{peso(f.amount)}</td></tr>)}</tbody></table> : <Empty>No purchases yet.</Empty>}<p className="mt-1 text-xs text-slate-500">Favorite brand: {m.favoriteBrand ?? '—'} · category: {m.favoriteCategory ?? '—'} · main branch: {m.topBranch ?? '—'}</p></Card>
        <Card title="Spending by month">{m.monthly.length ? <div className="flex h-36 gap-2">{m.monthly.map((x) => <div key={x.month} className="flex h-full flex-1 flex-col items-center gap-1" title={`${x.month}: ${peso(x.total)} (${x.orders} orders)`}><div className="flex w-full flex-1 items-end"><div className="w-full rounded-t-lg bg-gradient-to-t from-rose-600 to-orange-400" style={{ height: `${Math.max(4, (x.total / max) * 100)}%` }} /></div><span className="text-[10px] text-slate-500">{x.month.slice(2)}</span></div>)}</div> : <Empty>No purchases yet.</Empty>}</Card>
      </div>
      <MemberExtras id={id} />
      <Card title={`Purchases (${m.purchases.length})`}>{m.purchases.length ? <ul className="divide-y">{m.purchases.map((p) => <li key={p.id} className="py-2 text-sm"><div className="flex flex-wrap gap-2"><b>{fmtDate(p.date)}</b><span>{p.drSiNo}</span><span className="text-slate-500">{p.branch}</span><span className="ml-auto font-semibold">{peso(p.total)}</span></div><div className="text-xs text-slate-600">{p.items.map((i) => `${i.qty}× ${i.name}${i.freebie ? ' (free)' : ''}`).join(' · ')}</div></li>)}</ul> : <Empty>No purchases yet. Tag the member on the sale (New Sale → Wheysted member).</Empty>}</Card>
    </div>}
  </Modal>;
}

/** A printable member card with the QR code. */
function printCard(m: Detail) {
  void import('qrcode').then(async (QR) => {
    const url = await QR.toDataURL(m.qr, { margin: 1, width: 240 });
    const w = window.open('', '_blank', 'width=480,height=360'); if (!w) return;
    w.document.write(`<html><head><title>${m.memberNo}</title><style>body{font-family:Arial,sans-serif;margin:0;display:flex;justify-content:center;padding:24px}.c{width:340px;border:2px solid #c8102e;border-radius:18px;padding:18px;text-align:center}h1{margin:0;font-size:18px;color:#0b1f3a;letter-spacing:.04em}h1 b{color:#c8102e}p{margin:4px 0}.n{font-size:20px;font-weight:700}</style></head><body><div class="c"><h1>GET <b>WHEY</b>STED · MEMBER</h1><img src="${url}" width="200" height="200"/><p class="n">${m.fullName.replace(/</g, '&lt;')}</p><p>${m.memberNo}</p><p style="font-size:11px;color:#64748b">Show this card at the counter. See your purchases online: sign in on the Wheysted member page.</p></div><script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  });
}
