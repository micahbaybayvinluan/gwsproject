import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fmtDate, peso } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Select } from '@/components/ui/primitives';
import { NewNteModal } from '@/pages/Nte';
import { locLabel } from '@/lib/utils';

interface Detail {
  id: string; employeeNo: string; fullName: string; position: string | null; basicRate: string; payFrequency: string; sssNo: string | null; phicNo: string | null; hdmfNo: string | null; bankAccount: string | null; active: boolean; locationId: string | null;
  location: { id: string; code: string; name: string } | null; user: { id: string; username: string; fullName: string; idNumber: string | null } | null;
  loans: { id: string; kind: string; principal: string; balance: string; perPeriod: string; active: boolean }[];
  chargeAllocations: { id: string; amount: string; deductedToDate: string; balance: string; acknowledgedAt: string | null; form: { id: string; controlNo: string; kind: string; reason: string | null; totalAmount: string; finalizedByHrAt: string | null } }[];
  ntes: { id: string; nteNo: string; subject: string; status: string; issuedOn: string; replyDueOn: string; decision: string | null }[];
  memos: { id: string; memoNo: string; subject: string; memoDate: string; status: string; acknowledgedAt: string | null }[];
  idChangePending: { to?: string } | null; editPending?: { change: string } | null;
}
const LOAN_KIND: Record<string, string> = { SSS_LOAN: 'SSS loan', HDMF_LOAN: 'Pag-IBIG loan', VALE: 'Vale', ADVANCE: 'Cash advance' };

/** One employee for HR (owner request 2026-10-16): profile, staff ID number, loans and cash advances, charges, NTEs and memos in one page. */
export function EmployeePage() {
  const { id } = useParams(); const nav = useNavigate(); const qc = useQueryClient(); const { can } = useAuth(); const manage = can('employee.manage');
  const q = useQuery({ queryKey: ['employee-detail', id], queryFn: () => api.get<Detail>(`/api/payroll/employees/${id}/detail`) });
  const locs = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; type: string }[]>('/api/locations'), enabled: manage });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['employee-detail', id] }); void qc.invalidateQueries({ queryKey: ['employees'] }); };
  const d = q.data;
  const [f, setF] = useState<Record<string, string> | null>(null);
  const form = f ?? (d ? { fullName: d.fullName, position: d.position ?? '', basicRate: String(Number(d.basicRate)), payFrequency: d.payFrequency, sssNo: d.sssNo ?? '', phicNo: d.phicNo ?? '', hdmfNo: d.hdmfNo ?? '', bankAccount: d.bankAccount ?? '', locationId: d.locationId ?? '' } : {});
  const [saveMsg, setSaveMsg] = useState('');
  const save = useMutation({ mutationFn: () => api.patch<{ pending?: boolean; message?: string } | null>(`/api/payroll/employees/${id}`, { fullName: form.fullName, position: form.position || undefined, basicRate: Number(form.basicRate), payFrequency: form.payFrequency, sssNo: form.sssNo || undefined, phicNo: form.phicNo || undefined, hdmfNo: form.hdmfNo || undefined, bankAccount: form.bankAccount || undefined, locationId: form.locationId || null }), onSuccess: (r) => { setF(null); setSaveMsg(r && (r as { pending?: boolean }).pending ? 'Your change to the name, position, branch or monthly basic was sent to the Owner. It shows here once approved.' : 'Saved.'); refresh(); } });
  const setActive = useMutation({ mutationFn: (active: boolean) => api.patch(`/api/payroll/employees/${id}`, { active }), onSuccess: refresh });
  const [newNo, setNewNo] = useState(''); const [why, setWhy] = useState(''); const [idMsg, setIdMsg] = useState('');
  const idChange = useMutation({ mutationFn: () => api.post<{ pending?: boolean; message?: string }>(`/api/payroll/employees/${id}/id-number`, { employeeNo: newNo, reason: why }), onSuccess: (r) => { setIdMsg(r.pending ? (r.message ?? 'Sent to the Owner for approval.') : 'The staff ID number was changed.'); setNewNo(''); setWhy(''); refresh(); } });
  const [loan, setLoan] = useState({ kind: 'ADVANCE', principal: '', perPeriod: '' });
  const addLoan = useMutation({ mutationFn: () => api.post('/api/payroll/loans', { employeeId: id, kind: loan.kind, principal: Number(loan.principal), perPeriod: Number(loan.perPeriod) }), onSuccess: () => { setLoan({ kind: 'ADVANCE', principal: '', perPeriod: '' }); refresh(); } });
  const updLoan = useMutation({ mutationFn: (x: { id: string; perPeriod?: number; active?: boolean }) => api.patch(`/api/payroll/loans/${x.id}`, { perPeriod: x.perPeriod, active: x.active }), onSuccess: refresh });
  const [nte, setNte] = useState(false);
  if (!d) return <p className="text-sm text-slate-500">{q.error ? (q.error as Error).message : 'Loading…'}</p>;
  const set = (k: string, v: string) => setF({ ...form, [k]: v });
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold tracking-tight text-navy">{d.fullName}</h1><span className="text-sm text-slate-500">{d.employeeNo}{d.position ? ` · ${d.position}` : ''} · {d.location?.name ?? 'Office'}</span><Badge tone={d.active ? 'green' : 'slate'}>{d.active ? 'active' : 'inactive'}</Badge>
      <div className="ml-auto flex gap-2"><Button size="sm" variant="outline" onClick={() => api.download(`/api/reports/forms/employee-ledger/${d.id}.pdf`, `Ledger-${d.employeeNo}.pdf`)}>Ledger (PDF)</Button><Button size="sm" variant="outline" onClick={() => nav('/payroll')}>Back to Payroll</Button></div></div>

    <Card title="Profile">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Full name"><Input value={form.fullName} disabled={!manage} onChange={(e) => set('fullName', e.target.value)} /></Field>
        <Field label="Position"><Input value={form.position} disabled={!manage} onChange={(e) => set('position', e.target.value)} /></Field>
        <Field label="Branch (cost centre)"><Select value={form.locationId} disabled={!manage} onChange={(e) => set('locationId', e.target.value)}><option value="">Office / none</option>{locs.data?.filter((l) => ['BRANCH', 'WAREHOUSE', 'OFFICE'].includes(l.type)).map((l) => <option key={l.id} value={l.id}>{locLabel(l)}</option>)}</Select></Field>
        <Field label="Monthly basic pay"><Input type="number" value={form.basicRate} disabled={!manage} onChange={(e) => set('basicRate', e.target.value)} /></Field>
        <Field label="Paid"><Select value={form.payFrequency} disabled={!manage} onChange={(e) => set('payFrequency', e.target.value)}><option value="SEMI_MONTHLY">Twice a month</option><option value="MONTHLY">Monthly</option><option value="WEEKLY">Weekly</option></Select></Field>
        <Field label="Bank account"><Input value={form.bankAccount} disabled={!manage} onChange={(e) => set('bankAccount', e.target.value)} /></Field>
        <Field label="SSS no."><Input value={form.sssNo} disabled={!manage} onChange={(e) => set('sssNo', e.target.value)} /></Field>
        <Field label="PhilHealth no."><Input value={form.phicNo} disabled={!manage} onChange={(e) => set('phicNo', e.target.value)} /></Field>
        <Field label="Pag-IBIG no."><Input value={form.hdmfNo} disabled={!manage} onChange={(e) => set('hdmfNo', e.target.value)} /></Field>
      </div>
      {manage && <div className="mt-3 flex flex-wrap gap-2"><Button disabled={save.isPending || !form.fullName || f === null} onClick={() => save.mutate()}>Save the profile</Button><Button variant="outline" onClick={() => setActive.mutate(!d.active)}>{d.active ? 'Set as inactive (left the company)' : 'Set as active again'}</Button></div>}
      {d.editPending && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900" data-testid="edit-pending">Waiting for the Owner: {d.editPending.change}</p>}
      {saveMsg && <p className="mt-1 text-sm text-emerald-700">{saveMsg}</p>}
      <ErrorBox error={save.error ?? setActive.error} />
      <p className="mt-2 text-xs text-slate-500">A change to the name, position, branch or monthly basic is approved by the Owner (the Owner's own change applies at once). The government contributions of each payroll run are worked out from the monthly basic pay above (SSS, PhilHealth and Pag-IBIG tables); HR can still type the shares of one payroll line when they differ.</p>
    </Card>

    <Card title="Staff ID number">
      <p className="text-sm">Staff ID: <b data-testid="emp-no">{d.employeeNo}</b>{d.user ? <span className="text-slate-500"> · login {d.user.username} (Company ID {d.user.idNumber ?? '—'})</span> : <span className="text-slate-500"> · no login account linked</span>}</p>
      {d.idChangePending && <p className="mt-1 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">A change to <b>{d.idChangePending.to}</b> is waiting for the Owner's approval.</p>}
      {manage && !d.idChangePending && <div className="mt-2 flex flex-wrap items-end gap-2"><Field label="New staff ID number"><Input value={newNo} onChange={(e) => setNewNo(e.target.value)} /></Field><Field label="Why" className="min-w-64 flex-1"><Input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. typing error / assigned the company ID" /></Field><Button disabled={!newNo.trim() || why.trim().length < 3 || idChange.isPending} onClick={() => idChange.mutate()} data-testid="change-id">Ask the Owner to approve</Button></div>}
      {idMsg && <p className="mt-1 text-sm text-emerald-700">{idMsg}</p>}<ErrorBox error={idChange.error} />
      <p className="mt-1 text-xs text-slate-500">The Owner approves every change. When approved, the employee's login Company ID changes too.</p>
    </Card>

    <Card title="Loans and cash advances (deducted from each payroll by itself)">
      {d.loans.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th>Kind</th><th className="num">Amount</th><th className="num">Balance</th><th className="num">Deduct each payroll</th><th /></tr></thead><tbody>{d.loans.map((l) => <tr key={l.id} className="border-t"><td className="py-1.5">{LOAN_KIND[l.kind] ?? l.kind} {!l.active && <Badge tone="slate">closed</Badge>}</td><td className="num">{peso(l.principal)}</td><td className="num">{peso(l.balance)}</td><td className="num">{manage && l.active ? <Input type="number" className="ml-auto min-h-8 w-28 text-right" defaultValue={Number(l.perPeriod)} onBlur={(e) => Number(e.target.value) > 0 && Number(e.target.value) !== Number(l.perPeriod) && updLoan.mutate({ id: l.id, perPeriod: Number(e.target.value) })} /> : peso(l.perPeriod)}</td><td className="text-right">{manage && l.active && <Button size="sm" variant="ghost" onClick={() => updLoan.mutate({ id: l.id, active: false })}>Close</Button>}</td></tr>)}</tbody></table></div> : <Empty>No loans or cash advances.</Empty>}
      {manage && <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3"><Field label="Add"><Select value={loan.kind} onChange={(e) => setLoan({ ...loan, kind: e.target.value })}>{Object.entries(LOAN_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field><Field label="Amount"><Input type="number" value={loan.principal} onChange={(e) => setLoan({ ...loan, principal: e.target.value })} /></Field><Field label="Deduct each payroll"><Input type="number" value={loan.perPeriod} onChange={(e) => setLoan({ ...loan, perPeriod: e.target.value })} /></Field><Button disabled={!(Number(loan.principal) > 0 && Number(loan.perPeriod) > 0) || addLoan.isPending} onClick={() => addLoan.mutate()} data-testid="add-loan">Add the loan / advance</Button></div>}
      <ErrorBox error={addLoan.error ?? updLoan.error} />
      <p className="mt-2 text-xs text-slate-500">Every payroll run takes the amount "each payroll" (never more than the balance) and lowers the balance when the run is finalized.</p>
    </Card>

    <Card title="Charges (deducted from payroll once HR finalizes the charge form)">
      {d.chargeAllocations.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th>Charge form</th><th>What for</th><th className="num">Charged</th><th className="num">Deducted so far</th><th className="num">Balance</th><th>Status</th></tr></thead><tbody>{d.chargeAllocations.map((a) => <tr key={a.id} className="border-t"><td className="py-1.5"><Link className="font-semibold text-brand underline" to={`/charge-forms/${a.form.id}`}>{a.form.controlNo}</Link></td><td>{a.form.reason ?? a.form.kind}</td><td className="num">{peso(a.amount)}</td><td className="num">{peso(a.deductedToDate)}</td><td className="num">{peso(a.balance)}</td><td>{a.form.finalizedByHrAt ? (a.acknowledgedAt ? <Badge tone="green">acknowledged</Badge> : <Badge tone="amber">finalized, not yet acknowledged</Badge>) : <Badge tone="slate">waiting for HR to finalize</Badge>}</td></tr>)}</tbody></table></div> : <Empty>No charges.</Empty>}
      <p className="mt-2 text-xs text-slate-500">New charges are made from the Staff Charges page (write-offs, cash shortage, counts) and allocated to the employee there.</p>
    </Card>

    <Card title="Notices to Explain and memos">
      {manage && <Button size="sm" className="mb-2" onClick={() => setNte(true)} data-testid="emp-issue-nte">Issue a Notice to Explain to {d.fullName}</Button>}
      {nte && <NewNteModal employeeId={d.id} onClose={() => { setNte(false); refresh(); }} />}
      {d.ntes.length ? <ul className="divide-y text-sm">{d.ntes.map((n) => <li key={n.id} className="flex flex-wrap items-center gap-2 py-1.5"><span className="font-mono text-xs">{n.nteNo}</span>{n.subject}<Badge tone={n.status === 'DECIDED' ? 'green' : n.status === 'VOIDED' ? 'red' : 'amber'}>{n.status}</Badge><span className="text-xs text-slate-500">issued {fmtDate(n.issuedOn)}{n.decision ? ` · ${n.decision.replace('_', ' ')}` : ''}</span><Button size="sm" variant="ghost" className="ml-auto" onClick={() => api.download(`/api/ntes/${n.id}/pdf`, `${n.nteNo}.pdf`)}>Print</Button></li>)}</ul> : <p className="text-sm text-slate-500">No NTEs.</p>}
      {d.memos.length > 0 && <ul className="mt-2 divide-y border-t pt-2 text-sm">{d.memos.map((m) => <li key={m.id} className="flex flex-wrap items-center gap-2 py-1.5"><Link className="font-semibold text-brand underline" to={`/memos?id=${m.id}`}>{m.memoNo}</Link>{m.subject}<span className="text-xs text-slate-500">{fmtDate(m.memoDate)}{m.acknowledgedAt ? ' · read' : ' · not yet read'}</span></li>)}</ul>}
    </Card>
  </div>;
}
