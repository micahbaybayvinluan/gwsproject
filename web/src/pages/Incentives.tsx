import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, Select } from '@/components/ui/primitives';

interface Incentive { id: string; month: string; agentName: string; branches: string[]; transactions: number; totalSales: number; collected: number; ratePct: number | null; amount: number; notes: string | null; status: string; formNo: string | null; decisionNote: string | null; preparedByName?: string | null; hrSignedByName?: string | null; releasedByName?: string | null; releaseMode: string | null; releaseReference: string | null; releaseDate: string | null; releaseAccount?: string | null }
interface AgentMonth { agentKey: string; name: string; branches: string[]; linkedUser: string | null; transactions: number; totalSales: number; collected: number; unpaid: number; incentive: Incentive | null }

const thisMonth = () => today().slice(0, 7);
const STATUS: Record<string, { label: string; tone: 'amber' | 'blue' | 'purple' | 'green' | 'red' }> = {
  PENDING: { label: 'Waiting: Accounting Associate, Accounting Head, Owner', tone: 'amber' },
  APPROVED: { label: 'Approved · with HR for the agent to sign', tone: 'blue' },
  SIGNED: { label: 'Signed by the agent · Accounting to release', tone: 'purple' },
  RELEASED: { label: 'Released', tone: 'green' },
  REJECTED: { label: 'Rejected', tone: 'red' },
};
const MODES: [string, string][] = [['BANK_TRANSFER', 'Bank transfer'], ['GCASH', 'GCash'], ['CHEQUE', 'Cheque'], ['CASH', 'Cash']];

/** Agent incentives (owner request 2026-09-30): the Sales Manager confirms each agent's month, Accounting and the Owner approve, HR has the agent sign, Accounting tags the payment. */
export function IncentivesPage() {
  const { can } = useAuth(); const qc = useQueryClient(); const [sp] = useSearchParams();
  const [month, setMonth] = useState(sp.get('month') ?? thisMonth());
  const [input, setInput] = useState<Record<string, { rate: string; amount: string; notes: string }>>({});
  const [releasing, setReleasing] = useState<Incentive | null>(null);
  const agents = useQuery({ queryKey: ['incentive-month', month], queryFn: () => api.get<AgentMonth[]>(`/api/incentives/month?month=${month}`), enabled: can('incentive.prepare') });
  const list = useQuery({ queryKey: ['incentives', month], queryFn: () => api.get<Incentive[]>(`/api/incentives?month=${month}`) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['incentive-month'] }); void qc.invalidateQueries({ queryKey: ['incentives'] }); };
  const prepare = useMutation({ mutationFn: (a: AgentMonth) => { const v = input[a.agentKey] ?? { rate: '', amount: '', notes: '' }; return api.post('/api/incentives', { month, agentKey: a.agentKey, ratePct: v.rate ? Number(v.rate) : null, amount: v.amount ? Number(v.amount) : null, notes: v.notes || null }); }, onSuccess: refresh });
  const signed = useMutation({ mutationFn: (id: string) => api.post(`/api/incentives/${id}/signed`, {}), onSuccess: refresh });
  const set = (k: string, f: 'rate' | 'amount' | 'notes', v: string) => setInput({ ...input, [k]: { ...(input[k] ?? { rate: '', amount: '', notes: '' }), [f]: v } });
  const rows = list.data ?? [];
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Agent Incentives</h1><Field label="Month"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field></div>
    <Card><ol className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
      <li><b>1.</b> Sales Manager confirms the agent's total sales and the incentive</li><li><b>2.</b> Accounting Associate, Accounting Head and the Owner approve</li><li><b>3.</b> The release form goes to HR; the agent signs</li><li><b>4.</b> Accounting releases it and tags the payment</li>
    </ol></Card>

    {can('incentive.prepare') && <Card title={`Agents' sales in ${month}`}>
      {agents.data?.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1">Agent</th><th>Branches</th><th className="num">DR/SI</th><th className="num">Total sales</th><th className="num">Collected</th><th className="num">Unpaid</th><th>Incentive</th></tr></thead>
        <tbody>{agents.data.map((a) => { const v = input[a.agentKey] ?? { rate: '', amount: '', notes: '' }; const calc = v.amount ? Number(v.amount) : v.rate ? Math.round(a.totalSales * Number(v.rate)) / 100 : null; return <tr key={a.agentKey} className="border-t align-top">
          <td className="py-2 font-medium">{a.name}{a.linkedUser && <div className="text-xs font-normal text-slate-500">account: {a.linkedUser}</div>}</td><td className="text-xs text-slate-600">{a.branches.join(', ')}</td><td className="num">{a.transactions}</td><td className="num font-semibold">{peso(a.totalSales)}</td><td className="num">{peso(a.collected)}</td><td className="num">{a.unpaid > 0 ? <span className="text-amber-700">{peso(a.unpaid)}</span> : '—'}</td>
          <td>{a.incentive ? <div><Badge tone={STATUS[a.incentive.status]?.tone}>{STATUS[a.incentive.status]?.label}</Badge><div className="text-xs text-slate-600">{peso(a.incentive.amount)}{a.incentive.formNo ? ` · ${a.incentive.formNo}` : ''}</div></div>
            : a.totalSales > 0 ? <div className="flex flex-wrap items-center gap-1"><Input className="w-20" type="number" step="0.01" placeholder="%" value={v.rate} onChange={(e) => set(a.agentKey, 'rate', e.target.value)} aria-label={`Rate for ${a.name}`} /><span className="text-xs text-slate-400">or ₱</span><Input className="w-28" type="number" step="0.01" placeholder="amount" value={v.amount} onChange={(e) => set(a.agentKey, 'amount', e.target.value)} aria-label={`Amount for ${a.name}`} /><Button size="sm" disabled={!calc || prepare.isPending} onClick={() => prepare.mutate(a)}>Confirm {calc ? peso(calc) : ''}</Button></div>
            : <span className="text-xs text-slate-400">no sales</span>}</td></tr>; })}</tbody></table></div>
        : <Empty>No agents.</Empty>}
      <p className="mt-2 text-xs text-slate-500">Total sales are every DR/SI of the agent at every branch in the month (voided ones excluded). Type the incentive as a % of sales or as an amount, then press Confirm: it goes to the Accounting Associate, the Accounting Head and the Owner.</p>
      <ErrorBox error={prepare.error} />
    </Card>}

    <Card title="Incentive forms">
      {rows.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1">Form #</th><th>Agent</th><th className="num">Total sales</th><th className="num">Incentive</th><th>Status</th><th>Release</th><th /></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id} className={`border-t align-top ${sp.get('id') === r.id ? 'bg-amber-50' : ''}`}>
          <td className="py-2">{r.formNo ?? '—'}<div className="text-xs text-slate-500">{r.month}</div></td><td>{r.agentName}<div className="text-xs text-slate-500">by {r.preparedByName}</div></td><td className="num">{peso(r.totalSales)}</td><td className="num font-semibold">{peso(r.amount)}{r.ratePct != null && <div className="text-xs font-normal text-slate-500">{r.ratePct}%</div>}</td>
          <td><Badge tone={STATUS[r.status]?.tone}>{STATUS[r.status]?.label ?? r.status}</Badge>{r.status === 'REJECTED' && r.decisionNote && <div className="text-xs text-red-700">{r.decisionNote}</div>}{r.hrSignedByName && <div className="text-xs text-slate-500">signed · HR {r.hrSignedByName}</div>}</td>
          <td className="text-xs text-slate-600">{r.status === 'RELEASED' ? <>{MODES.find((m) => m[0] === r.releaseMode)?.[1]}{r.releaseAccount ? ` · ${r.releaseAccount}` : ''}{r.releaseReference ? ` · ref ${r.releaseReference}` : ''}<div>{r.releaseDate} · {r.releasedByName}</div></> : '—'}</td>
          <td className="whitespace-nowrap text-right"><span className="inline-flex flex-wrap justify-end gap-1">
            {r.formNo && <Button size="sm" variant="outline" onClick={() => api.download(`/api/reports/forms/agent-incentive/${r.id}.pdf`, `${r.formNo}.pdf`)}>Print form</Button>}
            {can('incentive.hr') && r.status === 'APPROVED' && <Button size="sm" disabled={signed.isPending} onClick={() => signed.mutate(r.id)}>Agent signed</Button>}
            {can('incentive.release') && ['APPROVED', 'SIGNED'].includes(r.status) && <Button size="sm" onClick={() => setReleasing(r)}>Tag as released</Button>}
          </span></td></tr>)}</tbody></table></div>
        : <Empty>No incentive forms for {month}.</Empty>}
      <ErrorBox error={signed.error} />
    </Card>
    {releasing && <ReleaseModal row={releasing} onClose={() => setReleasing(null)} onDone={() => { setReleasing(null); refresh(); }} />}
  </div>;
}

function ReleaseModal({ row, onClose, onDone }: { row: Incentive; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ mode: 'BANK_TRANSFER', accountId: '', reference: '', date: today() });
  const accts = useQuery({ queryKey: ['payment-accounts'], queryFn: () => api.get<{ id: string; title: string }[]>('/api/accounts/payment') });
  const m = useMutation({ mutationFn: () => api.post(`/api/incentives/${row.id}/release`, { mode: f.mode, accountId: f.accountId || null, reference: f.reference || null, date: f.date }), onSuccess: onDone });
  return <Modal title={`Release ${row.formNo}: ${row.agentName} · ${peso(row.amount)}`} onClose={onClose}>
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Paid by"><Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        {f.mode !== 'CASH' && <Field label="From account"><Select value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}><option value="">—</option>{accts.data?.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</Select></Field>}
        <Field label={f.mode === 'CHEQUE' ? 'Cheque no.' : 'Reference no.'}><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder={f.mode === 'CASH' ? 'optional' : 'required'} /></Field>
        <Field label="Date released"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      </div>
      <ErrorBox error={m.error} />
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={m.isPending || (f.mode !== 'CASH' && !f.reference.trim())} onClick={() => m.mutate()}>Tag as released</Button></div>
    </div>
  </Modal>;
}
