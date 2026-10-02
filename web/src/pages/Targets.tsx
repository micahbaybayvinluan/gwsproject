import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Select, Stat } from '@/components/ui/primitives';
import { Searchable } from '@/components/Searchable';

interface Row { name: string; target: number | null; pendingTarget: number | null; actual: number; achievedPct: number | null; transactions: number }
interface Progress { month: string; daysInMonth: number; daysElapsed: number; pacePct: number; branches: (Row & { id: string })[]; agents: (Row & { key: string; branches: string[]; linkedUser: string | null })[]; totals: { target: number; actual: number; achievedPct: number | null } }
interface AgentGroup { key: string; name: string; agentIds: string[]; branches: string[]; user: { id: string; fullName: string } | null }

/** A bar showing the achieved share of the target, with a mark at how much of the month has passed. */
function Bar({ pct, pace }: { pct: number | null; pace: number }) {
  if (pct == null) return <span className="text-xs text-slate-400">no target</span>;
  const tone = pct >= pace ? 'bg-emerald-500' : pct >= pace * 0.8 ? 'bg-amber-500' : 'bg-red-500';
  return <div className="relative h-2.5 w-full min-w-24 rounded-full bg-slate-100" title={`${pct}% of target · ${pace}% of the month gone`}>
    <div className={`h-2.5 rounded-full ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} />
    <div className="absolute -top-1 h-4.5 w-0.5 bg-navy" style={{ left: `${Math.min(100, pace)}%` }} />
  </div>;
}

/** Sales targets per branch and per agent, and how much is achieved (Sales Manager sets, the Owner approves). */
export function TargetsPage() {
  const { can } = useAuth(); const qc = useQueryClient();
  const manage = can('target.manage');
  const [month, setMonth] = useState(today().slice(0, 7));
  const q = useQuery({ queryKey: ['targets-progress', month], queryFn: () => api.get<Progress>(`/api/targets/progress?month=${month}`) });
  const [f, setF] = useState({ kind: 'BRANCH' as 'BRANCH' | 'AGENT', id: '', amount: '', notes: '' }); const [msg, setMsg] = useState('');
  const save = useMutation({ mutationFn: () => api.post<{ status: string }>('/api/targets', { month, kind: f.kind, locationId: f.kind === 'BRANCH' ? f.id : undefined, agentKey: f.kind === 'AGENT' ? f.id : undefined, amount: Number(f.amount), notes: f.notes || undefined }), onSuccess: (r) => { setMsg(r.status === 'APPROVED' ? 'Target set.' : 'Sent to the Owner for approval.'); setF({ ...f, id: '', amount: '', notes: '' }); void qc.invalidateQueries({ queryKey: ['targets-progress'] }); } });
  const p = q.data; const pace = p?.pacePct ?? 0;
  const table = (rows: (Row & { id?: string; key?: string; branches?: string[]; linkedUser?: string | null })[], agent: boolean) => rows.length ? <table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1">{agent ? 'Agent' : 'Branch'}</th><th className="num">Target</th><th className="num">Sales so far</th><th className="num">Achieved</th><th className="w-1/4">Progress</th><th className="num">Sales</th></tr></thead><tbody>
    {rows.map((r) => <tr key={r.id ?? r.key} className="border-t"><td className="py-2 font-medium">{r.name}{agent && <div className="text-xs font-normal text-slate-500">{r.branches?.join(', ')}{r.linkedUser ? ` · account: ${r.linkedUser}` : ''}</div>}</td>
      <td className="num">{r.target != null ? peso(r.target) : '—'}{r.pendingTarget != null && <div className="text-xs text-amber-700">{peso(r.pendingTarget)} waiting for the Owner</div>}</td>
      <td className="num">{peso(r.actual)}</td><td className={`num font-semibold ${r.achievedPct == null ? '' : r.achievedPct >= pace ? 'text-emerald-700' : 'text-red-700'}`}>{r.achievedPct != null ? `${r.achievedPct}%` : '—'}</td><td><Bar pct={r.achievedPct} pace={pace} /></td><td className="num">{r.transactions}</td></tr>)}
  </tbody></table> : <Empty>None.</Empty>;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-3"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Sales Targets</h1><Field label="Month"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field></div>
    {p && <div className="grid gap-3 md:grid-cols-4">
      <Stat label="Company target (branches)" value={peso(p.totals.target)} />
      <Stat label="Sales so far" value={peso(p.totals.actual)} />
      <Stat label="Achieved" value={p.totals.achievedPct != null ? `${p.totals.achievedPct}%` : '—'} tone={p.totals.achievedPct != null ? (p.totals.achievedPct >= pace ? 'green' : 'red') : undefined} />
      <Stat label="Month gone" value={`${p.pacePct}%`} sub={`day ${p.daysElapsed} of ${p.daysInMonth}: to be on track, achieved should be at least this`} />
    </div>}
    <p className="text-xs text-slate-500">Green: on track (achieved ≥ share of the month gone). Amber: slightly behind. Red: behind. The dark line on each bar marks today.</p>
    <ErrorBox error={q.error} />
    <Card title="Branches (and e-commerce platforms)">{p && table(p.branches, false)}</Card>
    <Card title="Agents (all branches together)">{p && table(p.agents, true)}</Card>
    {manage && <Card title={`Set a target for ${month}`}>
      <div className="grid gap-3 md:grid-cols-5">
        <Field label="For"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'BRANCH' | 'AGENT', id: '' })}><option value="BRANCH">A branch</option><option value="AGENT">An agent</option></Select></Field>
        <Field label={f.kind === 'BRANCH' ? 'Branch' : 'Agent'}><Select value={f.id} onChange={(e) => setF({ ...f, id: e.target.value })}><option value="">— choose —</option>{f.kind === 'BRANCH' ? p?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>) : p?.agents.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}</Select></Field>
        <Field label="Target sales (₱)"><Input type="number" min={0} step="1000" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Note (optional)" className="md:col-span-2"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. includes the anniversary sale" /></Field>
      </div>
      <Button className="mt-3" disabled={!f.id || !(Number(f.amount) > 0) || save.isPending} onClick={() => { setMsg(''); save.mutate(); }}>Send for the Owner's approval</Button>
      <ErrorBox error={save.error} />{msg && <p className="mt-2 text-sm text-emerald-700">{msg}</p>}
    </Card>}
    {manage && <AgentAccounts />}
  </div>;
}

/** Link each agent to the person's Agent account so they see their own sales at every branch. */
function AgentAccounts() {
  const qc = useQueryClient();
  const agents = useQuery({ queryKey: ['target-agents'], queryFn: () => api.get<AgentGroup[]>('/api/targets/agents') });
  const users = useQuery({ queryKey: ['agent-users'], queryFn: () => api.get<{ id: string; fullName: string; username: string }[]>('/api/targets/agent-users') });
  const link = useMutation({ mutationFn: async (x: { agentIds: string[]; userId: string | null }) => { for (const id of x.agentIds) await api.put(`/api/targets/agents/${id}/user`, { userId: x.userId }); }, onSuccess: () => { void qc.invalidateQueries({ queryKey: ['target-agents'] }); void qc.invalidateQueries({ queryKey: ['targets-progress'] }); } });
  return <Card title="Agent accounts">
    <p className="mb-3 text-sm text-slate-600">An agent listed at several branches is one person. Link them to their <b>Agent</b> user account (created by the Owner in Users & Roles) so they can follow their own sales and target.</p>
    <Searchable><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1">Agent</th><th>Branches</th><th>Account</th></tr></thead><tbody>{agents.data?.map((a) => <tr key={a.key} className="border-t"><td className="py-2">{a.name}</td><td>{a.branches.join(', ')}</td><td><Select className="max-w-64" value={a.user?.id ?? ''} onChange={(e) => link.mutate({ agentIds: a.agentIds, userId: e.target.value || null })}><option value="">— not linked —</option>{users.data?.map((u) => <option key={u.id} value={u.id}>{u.fullName} ({u.username})</option>)}</Select></td></tr>)}</tbody></table></Searchable>
    <ErrorBox error={link.error} />
  </Card>;
}

interface Mine { linked: boolean; month: string; total: number; count?: number; target: number | null; achievedPct: number | null; pacePct?: number; byMonth: { month: string; total: number }[]; sales: { id: string; date: string; branch: string; drSiNo: string; outlet?: string | null; customer: string | null; channel: string; paymentMode: string; amount: number }[]; ar: { id: string; drSiNo: string; branch: string; customer: string | null; date: string; dueDate: string | null; daysToDue: number | null; balance: number; pdc: boolean }[] }
const MODE: Record<string, string> = { CASH: 'Cash', ONLINE: 'Online', CREDIT_CARD: 'Card', AR_PDC: 'Credit (AR)' };

/** The Agent's own page: sales at every branch, target and achievement, and customers' unpaid balances. */
export function MySalesPage() {
  const [month, setMonth] = useState(today().slice(0, 7));
  const q = useQuery({ queryKey: ['my-sales', month], queryFn: () => api.get<Mine>(`/api/targets/mine?month=${month}`) });
  const m = q.data;
  const max = Math.max(1, ...(m?.byMonth ?? []).map((x) => x.total));
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-3"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">My Sales</h1><Field label="Month"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field></div>
    <ErrorBox error={q.error} />
    {m && !m.linked && <Card><p className="text-sm text-slate-600">Your account is not linked to an agent yet. Ask the Sales Manager to link it (Sales Targets → Agent accounts).</p></Card>}
    {m?.linked && <>
      <div className="grid gap-3 md:grid-cols-4">
        <Stat label={`My sales ${m.month}`} value={peso(m.total)} sub={`${m.sales.length} sale(s), all branches`} />
        <Stat label="My target" value={m.target != null ? peso(m.target) : '—'} sub={m.target == null ? 'not set yet' : undefined} />
        <Stat label="Achieved" value={m.achievedPct != null ? `${m.achievedPct}%` : '—'} tone={m.achievedPct != null && m.pacePct != null ? (m.achievedPct >= m.pacePct ? 'green' : 'red') : undefined} sub={m.pacePct != null ? `${m.pacePct}% of the month gone` : undefined} />
        <Stat label="My customers' unpaid balance" value={peso(m.ar.reduce((t, a) => t + a.balance, 0))} sub={`${m.ar.length} invoice(s)`} tone={m.ar.some((a) => (a.daysToDue ?? 0) < 0) ? 'red' : undefined} />
      </div>
      <Card title="This year, month by month"><div className="flex h-32 items-end gap-2">{m.byMonth.map((x) => <div key={x.month} className="flex flex-1 flex-col items-center gap-1"><div className="w-full rounded-t bg-brand" style={{ height: `${(x.total / max) * 100}%`, minHeight: x.total ? 2 : 0 }} title={peso(x.total)} /><span className="text-[10px] text-slate-500">{x.month.slice(5)}</span></div>)}</div></Card>
      <Card title="Customers who have not paid yet (nearest due first)">{m.ar.length ? <Searchable><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1">Due</th><th>Customer</th><th>DR/SI</th><th>Branch</th><th className="num">Balance</th><th>PDC</th></tr></thead><tbody>{m.ar.map((a) => <tr key={a.id} className={`border-t ${(a.daysToDue ?? 0) < 0 ? 'text-red-700' : (a.daysToDue ?? 99) <= 3 ? 'text-amber-700' : ''}`}><td className="py-1.5">{fmtDate(a.dueDate)} <span className="text-xs">{a.daysToDue == null ? '' : a.daysToDue < 0 ? `${-a.daysToDue} day(s) overdue` : a.daysToDue === 0 ? 'today' : `in ${a.daysToDue} day(s)`}</span></td><td>{a.customer}</td><td>{a.drSiNo}</td><td>{a.branch}</td><td className="num">{peso(a.balance)}</td><td>{a.pdc ? 'Yes' : '—'}</td></tr>)}</tbody></table></Searchable> : <Empty>All paid.</Empty>}</Card>
      <Card title={`My sales in ${m.month}`}>{m.sales.length ? <Searchable><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1">Date</th><th>Branch</th><th>DR/SI</th><th>Customer</th><th>Outlet</th><th>Paid by</th><th className="num">Amount</th></tr></thead><tbody>{m.sales.map((s) => <tr key={s.id} className="border-t"><td className="py-1.5">{fmtDate(s.date)}</td><td>{s.branch}</td><td>{s.drSiNo}</td><td>{s.customer}</td><td>{s.outlet ?? '—'}</td><td><Badge>{MODE[s.paymentMode] ?? s.paymentMode}</Badge></td><td className="num">{peso(s.amount)}</td></tr>)}</tbody></table></Searchable> : <Empty>No sales yet this month.</Empty>}</Card>
    </>}
    <p className="text-xs text-slate-500"><Link className="underline" to="/help">How targets work</Link></p>
  </div>;
}
