import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate, peso } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Select, Stat } from '@/components/ui/primitives';
import { Searchable } from '@/components/Searchable';

interface Csg { agreementId: string; consigneeId: string; consignee: string; agentName: string | null; outletId: string | null; items: { productId: string; name: string; qty: number; value: number }[]; value: number; unpaid: number; lastSent: string | null; lastReport: string | null; idleDays: number | null; ageFlag: number | null }
interface Totals { outstanding: number; unpaid: number; limit: number | null; pendingLimit: number | null; headroom: number | null; usedPct: number | null; outlets: { outletId: string; outletName: string; used: number; limit: number | null; pending: boolean }[] }
interface Mine extends Totals { consignees: Csg[] }
interface Overview { agents: (Totals & { agentKey: string; agentName: string; consignees: Csg[]; oldestIdle: number })[]; noLimit: string[]; limits: { id: string; agentKey: string; agentName: string; outletId: string | null; outletName: string | null; amount: number; status: string }[]; assignments: { consigneeId: string; consignee: string; outletId: string | null; outletName: string | null; agentName: string | null }[] }

const Flag = ({ n }: { n: number | null }) => (n ? <Badge tone={n >= 60 ? 'red' : n >= 30 ? 'amber' : 'blue'}>{n}+ days without a sales report</Badge> : null);
const Meter = ({ pct }: { pct: number | null }) => pct == null ? <span className="text-xs text-slate-400">no maximum set</span> : <div className="h-2.5 w-full min-w-24 rounded-full bg-slate-100" title={`${pct}% of the maximum`}><div className={`h-2.5 rounded-full ${pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>;

function ConsigneeCard({ c }: { c: Csg }) {
  return <div className="rounded-2xl bg-white p-4 shadow-soft"><div className="flex flex-wrap items-center gap-2"><b className="text-navy">{c.consignee}</b><Flag n={c.ageFlag} /><span className="ml-auto text-sm">{peso(c.value)} at retail</span></div>
    <div className="text-xs text-slate-500">Last sent {c.lastSent ? fmtDate(c.lastSent) : '—'} · last sales report {c.lastReport ? fmtDate(c.lastReport) : 'none yet'} · still owes {peso(c.unpaid)}</div>
    {c.items.length ? <div className="sticky-head"><table className="mt-2 w-full text-sm"><tbody>{c.items.map((i) => <tr key={i.productId} className="border-t"><td className="py-1">{i.name}</td><td className="num">{i.qty}</td><td className="num">{peso(i.value)}</td></tr>)}</tbody></table></div> : <p className="mt-2 text-xs text-slate-500">No stock there now.</p>}</div>;
}

function Summary({ t }: { t: Totals }) {
  return <div className="grid gap-3 md:grid-cols-4"><Stat label="Consignment out (retail)" value={peso(t.outstanding)} /><Stat label="Approved maximum" value={t.limit != null ? peso(t.limit) : 'not set'} sub={t.pendingLimit != null ? `${peso(t.pendingLimit)} waiting for the Owner` : undefined} /><Stat label="Room left" value={t.headroom != null ? peso(t.headroom) : '—'} tone={t.headroom != null && t.headroom <= 0 ? 'red' : undefined} sub={<Meter pct={t.usedPct} />} /><Stat label="Consignees still owe" value={peso(t.unpaid)} /></div>;
}

/** The consignments an agent is responsible for and their maximum; the Sales Manager links consignees to outlets and sets the maximums (the Owner approves). */
export function AgentConsignmentsPage() {
  const { can } = useAuth();
  return can('outlet.view.all') || can('outlet.manage') ? <Overview /> : <MyConsignments />;
}

function MyConsignments() {
  const q = useQuery({ queryKey: ['agent-csg-mine'], queryFn: () => api.get<Mine>('/api/field/consignments/mine') });
  const d = q.data;
  return <div className="space-y-4"><h1 className="text-2xl font-bold tracking-tight text-navy">My Consignments</h1><ErrorBox error={q.error} />
    {d && <><Summary t={d} />
      {d.outlets.length > 0 && <Card title="Maximum per outlet"><ul className="divide-y text-sm">{d.outlets.map((o) => <li key={o.outletId} className="flex items-center gap-3 py-2"><span className="flex-1">{o.outletName}</span><span>{peso(o.used)}{o.limit != null ? ` of ${peso(o.limit)}` : ' (no separate maximum)'}</span></li>)}</ul></Card>}
      {d.consignees.length ? d.consignees.map((c) => <ConsigneeCard key={c.agreementId} c={c} />) : <Card><Empty>No consignment is assigned to you yet. The Sales Manager links a consignee account to your outlet.</Empty></Card>}
      <p className="text-xs text-slate-500">Valued at retail price (SRP) of the stock still with the consignee. A new consignment that would go over your maximum is stopped until the Sales Manager asks the Owner to raise it.</p></>}</div>;
}

function Overview() {
  const { can } = useAuth(); const qc = useQueryClient(); const manager = can('outlet.manage');
  const q = useQuery({ queryKey: ['agent-csg-over'], queryFn: () => api.get<Overview>('/api/field/consignments/overview') });
  const agents = useQuery({ queryKey: ['field-agents'], queryFn: () => api.get<{ key: string; name: string }[]>('/api/field/agents') });
  const outlets = useQuery({ queryKey: ['outlets', 'approved-all'], queryFn: () => api.get<{ id: string; name: string; agentKey: string; agentName: string }[]>('/api/field/outlets?status=APPROVED'), enabled: manager });
  const [lim, setLim] = useState({ agentKey: '', outletId: '', amount: '', notes: '' }); const [msg, setMsg] = useState(''); const [asg, setAsg] = useState<Record<string, string>>({});
  const refresh = () => void qc.invalidateQueries({ queryKey: ['agent-csg-over'] });
  const setLimit = useMutation({ mutationFn: () => api.post<{ status: string }>('/api/field/consignments/limits', { agentKey: lim.agentKey, outletId: lim.outletId || null, amount: Number(lim.amount), notes: lim.notes || undefined }), onSuccess: (r) => { setMsg(r.status === 'APPROVED' ? 'Maximum set.' : 'Sent to the Owner for approval.'); setLim({ agentKey: '', outletId: '', amount: '', notes: '' }); refresh(); } });
  const assign = useMutation({ mutationFn: (v: { consigneeId: string; outletId: string | null }) => api.post('/api/field/consignments/assign', v), onSuccess: refresh });
  const d = q.data;
  return <div className="space-y-4"><div className="flex items-center gap-3"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Agent Consignments</h1><Link className="text-sm text-brand underline" to="/field">Field Monitoring</Link></div><ErrorBox error={q.error} />
    {d && <>
      {d.noLimit.length > 0 && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">No approved maximum yet for: {d.noLimit.join(', ')}. Their consignments are stopped until one is set.</p>}
      {d.agents.length ? d.agents.map((a) => <Card key={a.agentKey} title={<span>{a.agentName} <span className="text-sm font-normal text-slate-500">· {a.consignees.length} consignee{a.consignees.length === 1 ? '' : 's'}</span></span>}>
        <Summary t={a} />{a.outlets.some((o) => o.limit != null) && <ul className="mt-2 text-sm">{a.outlets.filter((o) => o.limit != null).map((o) => <li key={o.outletId}>{o.outletName}: {peso(o.used)} of {peso(o.limit!)}{o.pending ? ' (a change is waiting for the Owner)' : ''}</li>)}</ul>}
        <div className="mt-3 grid gap-3 lg:grid-cols-2">{a.consignees.map((c) => <ConsigneeCard key={c.agreementId} c={c} />)}</div></Card>) : <Card><Empty>No consignee is linked to an agent's outlet yet.</Empty></Card>}
      {manager && <Card title="Link a consignee account to an agent's outlet"><ul className="divide-y text-sm">{d.assignments.map((a) => <li key={a.consigneeId} className="flex flex-wrap items-center gap-2 py-2"><span className="min-w-40 flex-1 font-medium">{a.consignee}</span>
        <Select className="max-w-64" value={asg[a.consigneeId] ?? a.outletId ?? ''} onChange={(e) => setAsg({ ...asg, [a.consigneeId]: e.target.value })}><option value="">— no agent —</option>{outlets.data?.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.agentName})</option>)}</Select>
        <Button size="sm" variant="outline" disabled={(asg[a.consigneeId] ?? a.outletId ?? '') === (a.outletId ?? '') || assign.isPending} onClick={() => assign.mutate({ consigneeId: a.consigneeId, outletId: asg[a.consigneeId] || null })}>Save</Button></li>)}{!d.assignments.length && <Empty>No consignee accounts yet (the Owner creates them).</Empty>}</ul><ErrorBox error={assign.error} /></Card>}
      {manager && <Card title="Maximum consignment (the Owner approves)">
        <div className="grid gap-3 md:grid-cols-4"><Field label="Agent"><Select value={lim.agentKey} onChange={(e) => setLim({ ...lim, agentKey: e.target.value, outletId: '' })}><option value="">— choose —</option>{agents.data?.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}</Select></Field>
          <Field label="Applies to"><Select value={lim.outletId} onChange={(e) => setLim({ ...lim, outletId: e.target.value })}><option value="">All outlets together</option>{outlets.data?.filter((o) => o.agentKey === lim.agentKey).map((o) => <option key={o.id} value={o.id}>Only {o.name}</option>)}</Select></Field>
          <Field label="Maximum (₱ at retail)"><Input type="number" min={0} step="1000" value={lim.amount} onChange={(e) => setLim({ ...lim, amount: e.target.value })} /></Field><Field label="Note"><Input value={lim.notes} onChange={(e) => setLim({ ...lim, notes: e.target.value })} /></Field></div>
        <Button className="mt-3" disabled={!lim.agentKey || !(Number(lim.amount) > 0) || setLimit.isPending} onClick={() => { setMsg(''); setLimit.mutate(); }}>Send for the Owner's approval</Button><ErrorBox error={setLimit.error} />{msg && <p className="mt-2 text-sm text-emerald-700">{msg}</p>}
        {d.limits.length > 0 && <Searchable><table className="mt-3 w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Agent</th><th>Applies to</th><th className="num">Maximum</th><th>Status</th></tr></thead><tbody>{d.limits.map((l) => <tr key={l.id} className="border-t"><td className="py-1.5">{l.agentName}</td><td>{l.outletName ?? 'All outlets'}</td><td className="num">{peso(l.amount)}</td><td><Badge tone={l.status === 'APPROVED' ? 'green' : 'amber'}>{l.status === 'APPROVED' ? 'approved' : 'waiting for the Owner'}</Badge></td></tr>)}</tbody></table></Searchable>}
        <p className="mt-2 text-xs text-slate-500">Consignment is valued at retail price (SRP) of the stock still at the consignee. A consignment out that would go over the agent's maximum (or the outlet's) is stopped when it is submitted.</p></Card>}
    </>}</div>;
}
