import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate, peso } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, Select, Stat, Textarea } from '@/components/ui/primitives';
import { Segmented } from '@/components/ui/widgets';
import { DataTable } from '@/components/ui/table';

interface Restock { id: string; customer: string; phone: string | null; email: string | null; product: string; qty: number; store: string; dueDate: string; daysOver: number }
interface Birthday { memberId: string; memberNo: string; name: string; phone: string | null; preferredChannel: string | null; birthday: string; inDays: number; store: string; greeted: boolean; lastPurchase: string; orders: number }
interface Winback { memberId: string; memberNo: string; name: string; phone: string | null; preferredChannel: string | null; store: string; lastPurchase: string; daysSince: number; orders: number; spent: number }
export interface PromoRow { id: string; title: string; details: string; audience: string; startsOn: string; endsOn: string; status: string; state: string; daysLeft: number | null; createdByName: string | null; cancelReason: string | null; memoId: string | null; items: { productId: string; sku: string; product: string; promoPrice: number; regularPrice: number | null }[] }
interface Board { today: string; scope: string; restock: Restock[]; birthdays: Birthday[]; winback: Winback[]; reservations: number; promos: PromoRow[]; stats: { contactedThisMonth: number; boughtAgain: number; notBuying: number; cameBackOnTheirOwn: number } }
interface Opts { methods: { key: string; label: string }[]; outcomes: { key: string; label: string }[]; reasons: { key: string; label: string }[] }
interface Target { kind: 'RESTOCK' | 'BIRTHDAY' | 'WINBACK'; name: string; what: string; followUpId?: string; memberId?: string; phone?: string | null }

const tomorrow = () => new Date(Date.now() + 8 * 3600e3 + 86400e3).toISOString().slice(0, 10);
const when = (d: number) => (d === 0 ? 'today' : d === 1 ? 'tomorrow' : d > 1 ? `in ${d} days` : `${-d} day${d === -1 ? '' : 's'} ago`);
const chatLink = (phone: string | null, channel: string | null) => { const d = (phone ?? '').replace(/\D/g, ''); const n = d.startsWith('0') ? `63${d.slice(1)}` : d; return !n ? null : channel === 'VIBER' ? `viber://chat?number=%2B${n}` : `https://wa.me/${n}`; };

/** Record how a customer was approached and what came of it: bought again or not, and if not, why. */
function ResultModal({ t, onClose, onDone }: { t: Target; onClose: () => void; onDone: () => void }) {
  const opts = useQuery({ queryKey: ['cs-options'], queryFn: () => api.get<Opts>('/api/customer-service/options'), staleTime: 3600_000 });
  const birthday = t.kind === 'BIRTHDAY';
  const [f, setF] = useState({ method: 'CALL', outcome: birthday ? 'GREETED' : '', reason: '', note: '', recontactOn: '' });
  const save = useMutation({ mutationFn: () => api.post('/api/customer-service/contacts', { kind: t.kind, followUpId: t.followUpId ?? null, memberId: t.memberId ?? null, phone: t.phone ?? null, customerName: t.name, method: f.method, outcome: f.outcome, reason: f.outcome === 'NOT_BUYING' ? f.reason : null, note: f.note || null, recontactOn: ['NO_ANSWER', 'WILL_BUY'].includes(f.outcome) ? f.recontactOn || tomorrow() : null }), onSuccess: onDone });
  const outcomes = (opts.data?.outcomes ?? []).filter((o) => (birthday ? ['GREETED', 'NO_ANSWER', 'WRONG_NUMBER'].includes(o.key) : o.key !== 'GREETED'));
  const ok = f.outcome && (f.outcome !== 'NOT_BUYING' || (f.reason && (f.reason !== 'OTHER' || f.note.trim())));
  return <Modal title={`${t.name}: ${t.what}`} onClose={onClose}>
    <div className="grid gap-3">
      <Field label="How did you approach them?"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{opts.data?.methods.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</Select></Field>
      <div><div className="mb-1 text-sm font-semibold text-slate-700">What came of it?</div><div className="flex flex-wrap gap-2" role="group" aria-label="What came of it?">{outcomes.map((o) => <button key={o.key} type="button" onClick={() => setF({ ...f, outcome: o.key })} className={`rounded-xl border px-3 py-2 text-sm font-semibold ${f.outcome === o.key ? 'border-brand bg-brand text-white' : 'bg-white text-slate-700'}`}>{o.label}</button>)}</div></div>
      {f.outcome === 'NOT_BUYING' && <Field label="Why are they not buying again? *" hint="Pick the closest reason. The Sales Manager and Owner see these added up."><Select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}><option value="">— choose the reason —</option>{opts.data?.reasons.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</Select></Field>}
      {['NO_ANSWER', 'WILL_BUY'].includes(f.outcome) && <Field label={f.outcome === 'NO_ANSWER' ? 'Try again on' : 'Remind me to check on'}><Input type="date" value={f.recontactOn || tomorrow()} onChange={(e) => setF({ ...f, recontactOn: e.target.value })} /></Field>}
      <Field label={f.reason === 'OTHER' ? 'Note * (what did they say?)' : 'Note (optional)'} hint={f.reason === 'CHEAPER_ELSEWHERE' ? 'Where and at what price? This tells us if our price is off.' : undefined}><Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
    </div>
    <ErrorBox error={save.error} />
    <div className="mt-3 flex gap-2"><Button disabled={!ok || save.isPending} onClick={() => save.mutate()}>Save result</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
  </Modal>;
}

/** The branch to-do list: restock due, birthdays, members to win back, reservations and promos. */
export function CustomerServiceBoard({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['cs-board'], queryFn: () => api.get<Board>('/api/customer-service/board'), refetchInterval: 120_000 });
  const [t, setT] = useState<Target | null>(null); const b = q.data;
  const done = () => { setT(null); void qc.invalidateQueries({ queryKey: ['cs-board'] }); void qc.invalidateQueries({ queryKey: ['cs-log'] }); };
  const cap = compact ? 5 : 100;
  const phone = (p: string | null, ch: string | null) => <span className="whitespace-nowrap">{p ?? '—'}{chatLink(p, ch) && <> · <a className="text-brand underline" href={chatLink(p, ch)!} target="_blank" rel="noreferrer">chat</a></>}</span>;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!b) return <Card title="Customer Service"><Empty>Loading…</Empty></Card>;
  const open = b.restock.length + b.birthdays.filter((x) => !x.greeted).length + b.winback.length;
  return <Card title={<span>Customer Service <span className="ml-2 text-xs font-normal text-slate-500">{b.scope}</span></span>} actions={compact ? <Link className="text-sm text-brand underline" to="/customer-service">Open the full list</Link> : undefined}>
    <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
      <Stat label="To do now" value={open} tone={open ? 'amber' : 'green'} /><Stat label="Restock due" value={b.restock.length} /><Stat label="Birthdays (next 7 days)" value={b.birthdays.length} />
      <Stat label="Reservations to prepare" value={b.reservations} sub={<Link className="underline" to="/reservations">open</Link>} /><Stat label="This month" value={`${b.stats.boughtAgain} came back`} sub={`${b.stats.contactedThisMonth} approached · ${b.stats.notBuying} not buying`} />
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <section><h3 className="mb-1 text-sm font-bold text-navy">Restock due <span className="font-normal text-slate-500">(what they bought should be finished by now)</span></h3>
        {b.restock.length ? <ul className="divide-y text-sm">{b.restock.slice(0, cap).map((r) => <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"><div className="min-w-0 flex-1"><b>{r.customer}</b> · {r.qty}× {r.product}<div className="text-xs text-slate-500">{r.store} · due {fmtDate(r.dueDate)}{r.daysOver > 0 ? <span className="text-red-700"> ({r.daysOver} d late)</span> : ''} · {phone(r.phone, null)}</div></div><Button size="sm" variant="outline" onClick={() => setT({ kind: 'RESTOCK', name: r.customer, what: `${r.qty}× ${r.product}`, followUpId: r.id, phone: r.phone })}>Record result</Button></li>)}</ul> : <Empty>Nobody is due to restock.</Empty>}
        {compact && b.restock.length > cap && <p className="mt-1 text-xs text-slate-500">+ {b.restock.length - cap} more in the full list.</p>}
      </section>
      <section><h3 className="mb-1 text-sm font-bold text-navy">Birthdays of our regulars <span className="font-normal text-slate-500">(members who usually buy here)</span></h3>
        {b.birthdays.length ? <ul className="divide-y text-sm">{b.birthdays.slice(0, cap).map((x) => <li key={x.memberId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"><div className="min-w-0 flex-1"><b>{x.name}</b> <span className="text-xs text-slate-500">{x.memberNo}</span> <Badge tone={x.inDays === 0 ? 'red' : x.inDays < 0 ? 'slate' : 'blue'}>{x.inDays === 0 ? 'birthday today' : `${x.birthday} · ${when(x.inDays)}`}</Badge><div className="text-xs text-slate-500">{x.store} · {x.orders} orders · last {fmtDate(x.lastPurchase)} · {phone(x.phone, x.preferredChannel)}</div></div>{x.greeted ? <Badge tone="green">greeted</Badge> : <Button size="sm" variant="outline" onClick={() => setT({ kind: 'BIRTHDAY', name: x.name, what: 'birthday greeting', memberId: x.memberId, phone: x.phone })}>Greeted</Button>}</li>)}</ul> : <Empty>No birthdays in the next 7 days.</Empty>}
      </section>
      <section className="lg:col-span-2"><h3 className="mb-1 text-sm font-bold text-navy">Regulars we have not seen for a while <span className="font-normal text-slate-500">(46–180 days, best customers first)</span></h3>
        {b.winback.length ? <ul className="grid gap-x-6 divide-y text-sm lg:grid-cols-2 lg:divide-y-0">{b.winback.slice(0, compact ? 4 : 25).map((x) => <li key={x.memberId} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-2"><div className="min-w-0 flex-1"><b>{x.name}</b> <span className="text-xs text-slate-500">{x.memberNo}</span><div className="text-xs text-slate-500">{x.store} · last {fmtDate(x.lastPurchase)} ({x.daysSince} d) · {x.orders} orders · {peso(x.spent)} · {phone(x.phone, x.preferredChannel)}</div></div><Button size="sm" variant="outline" onClick={() => setT({ kind: 'WINBACK', name: x.name, what: 'come back to us', memberId: x.memberId, phone: x.phone })}>Record result</Button></li>)}</ul> : <Empty>Nobody to win back right now.</Empty>}
      </section>
    </div>
    {t && <ResultModal t={t} onClose={() => setT(null)} onDone={done} />}
  </Card>;
}

interface Log { id: string; date: string; kind: string; customer: string; phone: string | null; product: string; store: string; method: string; outcome: string; outcomeLabel: string; reasonLabel: string; note: string | null; by: string | null }
interface Reasons { days: number; approached: number; reached: number; boughtAgain: number; boughtAgainPct: number; notBuying: number; outcomes: { key: string; label: string; count: number }[]; reasons: { key: string; label: string; count: number }[]; byBranch: { branch: string; approached: number; boughtAgain: number; notBuying: number; topReason: string }[]; byProduct: { product: string; notBuying: number; topReason: string }[]; byStaff: { name: string; approached: number; boughtAgain: number }[]; latestNotes: { date: string; customer: string; reason: string; note: string }[] }

function ReasonsTab() {
  const [days, setDays] = useState('90');
  const q = useQuery({ queryKey: ['cs-reasons', days], queryFn: () => api.get<Reasons>(`/api/customer-service/reasons?days=${days}`) }); const d = q.data;
  const max = Math.max(1, ...(d?.reasons.map((r) => r.count) ?? [1]));
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-3"><Field label="Period"><Select value={days} onChange={(e) => setDays(e.target.value)}><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option></Select></Field><p className="pb-2 text-sm text-slate-600">Every customer the branches approached: how many came back, and the reasons the others gave.</p></div>
    <ErrorBox error={q.error} />
    {d && <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Approached" value={d.approached} /><Stat label="Reached (answered)" value={d.reached} /><Stat label="Bought again" value={d.boughtAgain} sub={`${d.boughtAgainPct}% of those reached`} tone="green" /><Stat label="Not buying again" value={d.notBuying} tone={d.notBuying ? 'amber' : undefined} /></div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Why they did not buy again">{d.reasons.length ? <ul className="space-y-1.5 text-sm">{d.reasons.map((r) => <li key={r.key}><div className="flex justify-between"><span>{r.label}</span><b>{r.count}</b></div><div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-gradient-to-r from-orange-500 to-rose-600" style={{ width: `${(r.count / max) * 100}%` }} /></div></li>)}</ul> : <Empty>No reasons recorded yet.</Empty>}</Card>
        <Card title="Results">{d.outcomes.length ? <ul className="divide-y text-sm">{d.outcomes.map((o) => <li key={o.key} className="flex justify-between py-1.5"><span>{o.label}</span><b>{o.count}</b></li>)}</ul> : <Empty />}</Card>
        <Card title="By branch" className="md:col-span-2">{d.byBranch.length ? <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Branch</th><th className="num">Approached</th><th className="num">Came back</th><th className="num">Not buying</th><th>Main reason</th></tr></thead><tbody>{d.byBranch.map((b) => <tr key={b.branch} className="border-t"><td className="py-1">{b.branch}</td><td className="num">{b.approached}</td><td className="num">{b.boughtAgain}</td><td className="num">{b.notBuying}</td><td className="pl-3">{b.topReason}</td></tr>)}</tbody></table> : <Empty />}</Card>
        <Card title="Items customers stop buying">{d.byProduct.length ? <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Item</th><th className="num">Not buying</th><th>Main reason</th></tr></thead><tbody>{d.byProduct.map((p) => <tr key={p.product} className="border-t"><td className="py-1">{p.product}</td><td className="num">{p.notBuying}</td><td className="pl-3">{p.topReason}</td></tr>)}</tbody></table> : <Empty />}</Card>
        <Card title="Who is following up">{d.byStaff.length ? <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Staff</th><th className="num">Approached</th><th className="num">Came back</th></tr></thead><tbody>{d.byStaff.map((s) => <tr key={s.name} className="border-t"><td className="py-1">{s.name}</td><td className="num">{s.approached}</td><td className="num">{s.boughtAgain}</td></tr>)}</tbody></table> : <Empty />}</Card>
        <Card title="What customers said">{d.latestNotes.length ? <ul className="divide-y text-sm">{d.latestNotes.map((n, i) => <li key={i} className="py-1.5"><b>{n.customer}</b> <span className="text-xs text-slate-500">{n.date} · {n.reason}</span><p>“{n.note}”</p></li>)}</ul> : <Empty />}</Card>
      </div>
    </>}
  </div>;
}

/** Customer Service page: the to-do list, the results recorded, and (for managers) the reasons added up. */
export function CustomerServicePage() {
  const { can } = useAuth(); const [tab, setTab] = useState<'todo' | 'log' | 'reasons'>('todo'); const [days, setDays] = useState('30');
  const log = useQuery({ queryKey: ['cs-log', days], queryFn: () => api.get<Log[]>(`/api/customer-service/contacts?days=${days}`), enabled: tab === 'log' });
  const manager = can('member.view') || can('member.manage') || can('report.sales.all');
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Customer Service</h1><Link className="text-sm text-brand underline" to="/promos">Promos</Link></div>
    <Segmented value={tab} onChange={setTab} options={[['todo', 'To do'], ['log', 'Results recorded'], ...(manager ? [['reasons', 'Why they do not buy again'] as [string, string]] : [])] as ['todo' | 'log' | 'reasons', string][]} />
    {tab === 'todo' && <CustomerServiceBoard />}
    {tab === 'log' && <Card title="Results recorded" actions={<Select className="w-40" value={days} onChange={(e) => setDays(e.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></Select>}>
      <ErrorBox error={log.error} />{log.data?.length ? <DataTable columnSearch exportName="CustomerResults" data={log.data} columns={[{ header: 'Date', accessorFn: (r) => fmtDate(r.date) }, { header: 'Customer', accessorKey: 'customer' }, { header: 'Phone', accessorFn: (r) => r.phone ?? '' }, { header: 'Item', accessorKey: 'product' }, { header: 'Branch', accessorKey: 'store' }, { header: 'Approached by', accessorKey: 'method' }, { header: 'Result', accessorKey: 'outcomeLabel', cell: (c) => <Badge tone={c.row.original.outcome === 'BOUGHT_AGAIN' ? 'green' : c.row.original.outcome === 'NOT_BUYING' ? 'red' : 'slate'}>{String(c.getValue())}</Badge> }, { header: 'Reason', accessorKey: 'reasonLabel' }, { header: 'Note', accessorFn: (r) => r.note ?? '' }, { header: 'By', accessorFn: (r) => r.by ?? '' }]} /> : <Empty>Nothing recorded in this period.</Empty>}
    </Card>}
    {tab === 'reasons' && manager && <ReasonsTab />}
  </div>;
}
