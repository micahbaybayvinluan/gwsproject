import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, fmtDate, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Select } from '@/components/ui/primitives';
import { Segmented } from '@/components/ui/widgets';
import { PhotoRow } from '@/components/Photo';
import { STAGE } from './Outlets';

interface Board { from: string; to: string; agents: { agentKey: string; agentName: string; days: number; planned: number; visited: number; missed: number; notReported: number; claims: number; visitRate: number | null }[]; days: { id: string; agentName: string; date: string; submitted: boolean; claims: number; stops: { id: string; outletName: string; city: string | null; status: string; note: string | null; visitedAt: string | null; lat: number | null; lng: number | null; shelfStatus: string | null; competitors: string | null; photos: { id: string; createdAt: string }[] }[] }[] }
interface Score { agentKey: string; agentName: string; visits: { days: number; planned: number; visited: number; missed: number; notReported: number; visitRate: number | null }; outlets: { added: number; pending: number; total: number; stages: Record<string, number> }; sales: { total: number; orders: number; target: number | null; achievedPct: number | null }; collections: { unpaid: number; overdue: number; openInvoices: number }; consignment: { outstanding: number; limit: number | null; usedPct: number | null; unpaid: number } }
const SHELF: Record<string, string> = { ON_SHELF: 'GWS on the shelf', LOW_STOCK: 'low stock', OUT_OF_STOCK: 'out of stock', NOT_CARRIED: 'does not carry GWS' };
const ST: Record<string, { l: string; t: 'green' | 'red' | 'amber' | 'slate' }> = { VISITED: { l: 'Visited', t: 'green' }, MISSED: { l: 'Missed', t: 'red' }, NOT_REPORTED: { l: 'Not reported', t: 'amber' }, PLANNED: { l: 'To visit', t: 'slate' } };
const monthNow = () => today().slice(0, 7);

/** Sales Manager, Head Auditor and Owner: what every agent planned and did, with the photos, scorecards, areas, claims. */
export function FieldMonitorPage() {
  const { can } = useAuth(); const qc = useQueryClient(); const [sp] = useSearchParams();
  const manager = can('outlet.manage');
  const [tab, setTab] = useState<'board' | 'score' | 'areas' | 'dormant' | 'claims'>(sp.get('tab') === 'claims' ? 'claims' : 'board');
  const [from, setFrom] = useState(() => new Date(Date.now() + 8 * 3600e3 - 6 * 86400e3).toISOString().slice(0, 10)); const [to, setTo] = useState(today()); const [agentKey, setAgentKey] = useState(''); const [month, setMonth] = useState(monthNow());
  const agents = useQuery({ queryKey: ['field-agents'], queryFn: () => api.get<{ key: string; name: string }[]>('/api/field/agents') });
  const board = useQuery({ queryKey: ['field-board', from, to, agentKey], queryFn: () => api.get<Board>(`/api/field/board?from=${from}&to=${to}${agentKey ? `&agentKey=${agentKey}` : ''}`), enabled: tab === 'board' });
  const score = useQuery({ queryKey: ['field-score', month, agentKey], queryFn: () => api.get<Score[]>(`/api/field/scorecard?month=${month}${agentKey ? `&agentKey=${agentKey}` : ''}`), enabled: tab === 'score' });
  const areas = useQuery({ queryKey: ['field-areaperf', month], queryFn: () => api.get<{ areas: { areaId: string; area: string; agentName: string | null; outlets: number; ordering: number; orders: number; sales: number; agentTarget: number | null; achievedPct: number | null }[]; topOutlets: { outletId: string; outlet: string; agentName: string; sales: number; orders: number }[] }>(`/api/field/areas/performance?month=${month}`), enabled: tab === 'areas' });
  const dormant = useQuery({ queryKey: ['field-dormant', agentKey], queryFn: () => api.get<{ id: string; name: string; city: string | null; agentName: string; stage: string; contactName: string | null; phone: string | null; lastOrder: string | null; days: number }[]>(`/api/field/outlets/dormant${agentKey ? `?agentKey=${agentKey}` : ''}`), enabled: tab === 'dormant' });
  const claims = useQuery({ queryKey: ['field-claims'], queryFn: () => api.get<{ id: string; agentName: string; date: string; stores: number; kind: string; amount: number; note: string | null; status: string; receipts: { id: string; createdAt: string }[] }[]>('/api/field/claims'), enabled: tab === 'claims' });
  const decide = useMutation({ mutationFn: (v: { id: string; action: 'APPROVE' | 'REJECT'; reason?: string }) => api.post(`/api/field/claims/${v.id}/decide`, { action: v.action, reason: v.reason }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['field-claims'] }) });
  const [reason, setReason] = useState<Record<string, string>>({});
  const agentSel = <Select className="max-w-48" value={agentKey} onChange={(e) => setAgentKey(e.target.value)}><option value="">All agents</option>{agents.data?.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}</Select>;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Field Monitoring</h1><Link className="text-sm text-brand underline" to="/outlets">Outlets</Link><Link className="text-sm text-brand underline" to="/field/consignments">Agent consignments</Link></div>
    <Segmented value={tab} onChange={setTab} options={[['board', 'Daily itineraries & photos'], ['score', 'Agent scorecards'], ['areas', 'Areas & top outlets'], ['dormant', 'Outlets not ordering'], ['claims', 'Fuel / transport claims']]} />
    {tab === 'board' && <>
      <div className="flex flex-wrap items-end gap-3"><Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>{agentSel}</div>
      <ErrorBox error={board.error} />
      {board.data && <><Card title="Plan vs actual per agent">{board.data.agents.length ? <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Agent</th><th className="num">Days</th><th className="num">Planned</th><th className="num">Visited</th><th className="num">Missed</th><th className="num">Not reported</th><th className="num">Visit rate</th><th className="num">Claims</th></tr></thead><tbody>{board.data.agents.map((a) => <tr key={a.agentKey} className="border-t"><td className="py-2 font-medium">{a.agentName}</td><td className="num">{a.days}</td><td className="num">{a.planned}</td><td className="num">{a.visited}</td><td className="num">{a.missed || '—'}</td><td className={`num ${a.notReported ? 'font-semibold text-amber-700' : ''}`}>{a.notReported || '—'}</td><td className="num font-semibold">{a.visitRate != null ? `${a.visitRate}%` : '—'}</td><td className="num">{a.claims ? peso(a.claims) : '—'}</td></tr>)}</tbody></table> : <Empty>No itineraries in this period.</Empty>}</Card>
        {board.data.days.map((d) => <Card key={d.id} title={<span>{d.agentName} · {fmtDate(d.date)} <span className="text-sm font-normal text-slate-500">{d.submitted ? '· report submitted' : '· not submitted'}{d.claims ? ` · claims ${peso(d.claims)}` : ''}</span></span>}>
          <ul className="divide-y">{d.stops.map((s) => <li key={s.id} className="py-2"><div className="flex flex-wrap items-center gap-2"><b className="text-sm">{s.outletName}</b><span className="text-xs text-slate-500">{s.city}</span><Badge tone={ST[s.status]?.t ?? 'slate'}>{ST[s.status]?.l ?? s.status}</Badge>{s.visitedAt && <span className="text-xs text-slate-500">{new Date(s.visitedAt).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' })}</span>}{s.lat != null && <a className="text-xs text-brand underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${s.lat},${s.lng}`}>location</a>}</div>
            {(s.shelfStatus || s.competitors || s.note) && <div className="text-xs text-slate-600">{[s.shelfStatus ? SHELF[s.shelfStatus] : null, s.competitors ? `competitors: ${s.competitors}` : null, s.note].filter(Boolean).join(' · ')}</div>}
            <div className="mt-1"><PhotoRow photos={s.photos} className="h-20 w-20" /></div></li>)}</ul></Card>)}</>}
    </>}
    {tab === 'score' && <>
      <div className="flex flex-wrap items-end gap-3"><Field label="Month"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>{agentSel}</div>
      <ErrorBox error={score.error} />
      <div className="grid gap-3 lg:grid-cols-2">{score.data?.map((s) => <Card key={s.agentKey} title={s.agentName}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Metric k="Visits (done / planned)" v={`${s.visits.visited} / ${s.visits.planned}${s.visits.visitRate != null ? ` · ${s.visits.visitRate}%` : ''}`} warn={s.visits.notReported > 0 ? `${s.visits.notReported} not reported` : undefined} />
          <Metric k="Days with an itinerary" v={String(s.visits.days)} />
          <Metric k="New outlets (approved)" v={`${s.outlets.added}${s.outlets.pending ? ` · ${s.outlets.pending} waiting` : ''}`} />
          <Metric k="Outlets in total" v={`${s.outlets.total} (${Object.entries(s.outlets.stages).map(([k, n]) => `${STAGE[k] ?? k} ${n}`).join(', ') || '—'})`} />
          <Metric k="Sales this month" v={`${peso(s.sales.total)} · ${s.sales.orders} orders`} />
          <Metric k="Against target" v={s.sales.target != null ? `${peso(s.sales.target)} · ${s.sales.achievedPct}%` : 'no target'} />
          <Metric k="Unpaid (AR)" v={`${peso(s.collections.unpaid)} · ${s.collections.openInvoices} invoices`} warn={s.collections.overdue ? `${s.collections.overdue} overdue` : undefined} />
          <Metric k="Consignment out" v={`${peso(s.consignment.outstanding)}${s.consignment.limit != null ? ` of ${peso(s.consignment.limit)} (${s.consignment.usedPct}%)` : ' (no maximum)'}`} />
        </dl></Card>)}</div>
      {score.data && !score.data.length && <Card><Empty>No agents with outlets yet.</Empty></Card>}
    </>}
    {tab === 'areas' && <>
      <Field label="Month"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
      {areas.data && <><Card title="Sales per area (orders tagged to its outlets)">{areas.data.areas.length ? <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Area</th><th>Agent</th><th className="num">Outlets</th><th className="num">Ordering</th><th className="num">Orders</th><th className="num">Sales</th><th className="num">Agent target</th></tr></thead><tbody>{areas.data.areas.map((a) => <tr key={a.areaId} className="border-t"><td className="py-2 font-medium">{a.area}</td><td>{a.agentName ?? '—'}</td><td className="num">{a.outlets}</td><td className="num">{a.ordering}</td><td className="num">{a.orders}</td><td className="num">{peso(a.sales)}</td><td className="num">{a.agentTarget != null ? `${peso(a.agentTarget)} (${a.achievedPct}%)` : '—'}</td></tr>)}</tbody></table> : <Empty>No areas yet.</Empty>}</Card>
        <Card title="Top outlets">{areas.data.topOutlets.length ? <table className="w-full text-sm"><tbody>{areas.data.topOutlets.map((o) => <tr key={o.outletId} className="border-t"><td className="py-2 font-medium">{o.outlet}</td><td>{o.agentName}</td><td className="num">{o.orders} orders</td><td className="num">{peso(o.sales)}</td></tr>)}</tbody></table> : <Empty>No orders tagged to outlets this month.</Empty>}</Card></>}
    </>}
    {tab === 'dormant' && <><div className="flex items-end gap-3">{agentSel}</div><Card title="Approved outlets with no order for 30 days or more">{dormant.data?.length ? <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Outlet</th><th>Agent</th><th>Stage</th><th>Contact</th><th className="num">Last order</th><th className="num">Days</th></tr></thead><tbody>{dormant.data.map((o) => <tr key={o.id} className="border-t"><td className="py-2 font-medium">{o.name}<div className="text-xs font-normal text-slate-500">{o.city}</div></td><td>{o.agentName}</td><td>{STAGE[o.stage] ?? o.stage}</td><td>{o.contactName}{o.phone ? ` · ${o.phone}` : ''}</td><td className="num">{o.lastOrder ? fmtDate(o.lastOrder) : 'never'}</td><td className="num font-semibold">{o.days}</td></tr>)}</tbody></table> : <Empty>Every outlet ordered in the last 30 days.</Empty>}</Card></>}
    {tab === 'claims' && <Card title="Fuel / transport / meal claims">{claims.data?.length ? <ul className="divide-y">{claims.data.map((c) => <li key={c.id} className="flex flex-wrap items-center gap-2 py-2 text-sm"><span className="min-w-48 flex-1"><b>{c.agentName}</b> · {fmtDate(c.date)} · {c.kind.toLowerCase()} · {peso(c.amount)} · {c.stores} stores{c.note ? ` · ${c.note}` : ''}</span><PhotoRow photos={c.receipts} className="h-10 w-10" />
      {c.status === 'PENDING' && manager ? <><Button size="sm" onClick={() => decide.mutate({ id: c.id, action: 'APPROVE' })}>Approve</Button><Input className="max-w-40" placeholder="Reason" value={reason[c.id] ?? ''} onChange={(e) => setReason({ ...reason, [c.id]: e.target.value })} /><Button size="sm" variant="danger" disabled={!(reason[c.id] ?? '').trim()} onClick={() => decide.mutate({ id: c.id, action: 'REJECT', reason: reason[c.id] })}>Reject</Button></> : <Badge tone={c.status === 'APPROVED' ? 'green' : c.status === 'REJECTED' ? 'red' : 'amber'}>{c.status.toLowerCase()}</Badge>}</li>)}</ul> : <Empty>No claims.</Empty>}<ErrorBox error={decide.error} /></Card>}
  </div>;
}

function Metric({ k, v, warn }: { k: string; v: string; warn?: string }) { return <div><dt className="text-xs uppercase text-slate-500">{k}</dt><dd className="font-medium">{v}{warn && <span className="ml-1 text-xs font-semibold text-amber-700">{warn}</span>}</dd></div>; }
