import { locLabel, personLabel } from '@/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AccountFields, missingFor, type AccountDraft } from '@/components/NewUserFields';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, fmtDate, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { MyNtes } from '@/pages/Nte';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Select } from '@/components/ui/primitives';
import { Searchable } from '@/components/Searchable';

interface MyCharge { id: string; amount: string; deductedToDate: string; open: string; acknowledgedAt: string | null; kindLabel: string; chargeForm: { id: string; controlNo: string; reason: string | null; totalAmount: string; createdAt: string; finalizedByHrAt: string | null; location: { name: string }; lines: { qty: number; unitCharge: string; amount: string; description: string | null; product: { name: string } | null }[] } }
interface MyHr { employee: { id: string; employeeNo: string; fullName: string; position: string | null; location: { name: string } | null } | null; charges: MyCharge[]; loans: { id: string; kind: string; principal: string; balance: string; perPeriod: string; active: boolean }[]; payslips: { id: string; netPay: string; run: { periodFrom: string; periodTo: string } }[] }

/** "My Pay & Charges": only the signed-in person's own charges (acknowledge in one click), loans/advances and payslips. */
export function MyHrPage() {
  const { me } = useAuth();
  if (me?.roleKey === 'FRANCHISE_SALES_ASSOCIATE') return <FranchiseMyPay />;
  return <CompanyMyPay />;
}

/** A franchise associate's own pay and charges, set by their franchise owner (not company HR). */
function FranchiseMyPay() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['fr-my-pay'], queryFn: () => api.get<{ salaries: { id: string; periodFrom: string; periodTo: string; basic: string; allowances: string; otherDeductions: string; chargesDeducted: string; netPay: string }[]; charges: { id: string; kind: string; reason: string; amount: string; deducted: boolean; acknowledgedAt: string | null; createdAt: string }[] }>('/api/franchise/my-pay') });
  const ack = useMutation({ mutationFn: (id: string) => api.post(`/api/franchise/charges/${id}/acknowledge`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['fr-my-pay'] }) });
  const d = q.data; if (!d) return <p className="text-sm text-slate-500">Loading…</p>;
  return <div className="mx-auto max-w-4xl space-y-4">
    <h1 className="text-2xl font-bold tracking-tight text-navy">My Pay & Charges</h1>
    <Card title="My charges">{!d.charges.length ? <Empty>No charges.</Empty> : <ul className="divide-y divide-slate-100">{d.charges.map((c) => <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"><span>{c.reason} <span className="text-xs text-slate-400">{new Date(c.createdAt).toLocaleDateString()}</span></span><span className="flex items-center gap-2"><b className="text-navy">{peso(c.amount)}</b>{c.deducted ? <Badge tone="green">deducted from pay</Badge> : <Badge tone="amber">to be deducted</Badge>}{c.acknowledgedAt ? <Badge tone="blue">acknowledged</Badge> : <Button size="sm" onClick={() => ack.mutate(c.id)}>Acknowledge</Button>}</span></li>)}</ul>}<ErrorBox error={ack.error} /></Card>
    <Card title="My salary">{!d.salaries.length ? <Empty>No salary recorded yet.</Empty> : <Searchable><table className="w-full text-sm"><thead className="text-left text-[11px] uppercase tracking-wide text-slate-500"><tr><th>Period</th><th className="num">Basic</th><th className="num">Allowances</th><th className="num">Deductions</th><th className="num">Net pay</th></tr></thead><tbody>{d.salaries.map((x) => <tr key={x.id} className="border-t border-slate-100"><td className="py-1.5">{x.periodFrom} – {x.periodTo}</td><td className="num">{peso(x.basic)}</td><td className="num">{peso(x.allowances)}</td><td className="num text-brand-dark">{peso(Number(x.otherDeductions) + Number(x.chargesDeducted))}</td><td className="num font-bold text-navy">{peso(x.netPay)}</td></tr>)}</tbody></table></Searchable>}</Card>
  </div>;
}

function CompanyMyPay() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['my-hr'], queryFn: () => api.get<MyHr>('/api/me/hr') });
  const ack = useMutation({ mutationFn: (id: string) => api.post(`/api/me/charges/${id}/acknowledge`), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['my-hr'] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); } });
  const d = q.data; if (!d) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!d.employee) return <Card title="My Pay & Charges"><p className="text-sm">Your account is not linked to an employee record yet. HR links it under Payroll → Employees.</p></Card>;
  return <div className="mx-auto max-w-4xl space-y-4">
    <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold tracking-tight text-navy">My Pay & Charges</h1><span className="text-sm text-slate-500">{d.employee.fullName} · {d.employee.employeeNo} · {d.employee.location?.name ?? 'Office'}</span>
      <Button size="sm" variant="outline" className="ml-auto" onClick={() => api.download(`/api/reports/forms/employee-ledger/${d.employee!.id}.pdf`, 'MyLedger.pdf')}>My ledger (PDF)</Button></div>
    <MyNtes />
    <BranchCharges />
    <Card title="Charges to me">
      {!d.charges.length ? <Empty>No charges.</Empty> : <ul className="divide-y">{d.charges.map((c) => <li key={c.id} className="py-3 text-sm">
        <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{c.chargeForm.controlNo}</span><Badge tone="amber">{c.kindLabel}</Badge><span>{c.chargeForm.location.name}</span><span className="text-slate-500">{fmtDate(c.chargeForm.createdAt)}</span>
          <span className="ml-auto font-semibold">{peso(c.amount)}</span></div>
        <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">{c.chargeForm.lines.map((l, i) => <li key={i}>{l.product ? `${l.qty} × ${l.product.name}` : l.description}{l.product && l.description ? ` (${l.description})` : ''} — {peso(l.amount)}</li>)}</ul>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span>Deducted so far {peso(c.deductedToDate)} · open {peso(c.open)}</span>
          {c.chargeForm.finalizedByHrAt ? <Badge tone="green">finalized by HR — deducted from payroll</Badge> : <Badge>waiting for HR</Badge>}
          {c.acknowledgedAt ? <Badge tone="green">acknowledged {new Date(c.acknowledgedAt).toLocaleString()}</Badge> : <Button size="sm" onClick={() => ack.mutate(c.id)} disabled={ack.isPending}>I acknowledge this charge</Button>}
          <button className="text-brand underline" onClick={() => api.download(`/api/reports/forms/deduction-authorization/${c.id}.pdf`, `Deduction-${c.chargeForm.controlNo}.pdf`)}>Deduction authorization</button>
        </div>
      </li>)}</ul>}
      <ErrorBox error={ack.error} />
    </Card>
    <Card title="Loans and cash advances">{!d.loans.length ? <Empty>None.</Empty> : <Searchable><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Type</th><th className="num">Amount</th><th className="num">Per payroll</th><th className="num">Balance</th></tr></thead><tbody>{d.loans.map((l) => <tr key={l.id} className="border-t"><td>{l.kind.replace(/_/g, ' ')}</td><td className="num">{peso(l.principal)}</td><td className="num">{peso(l.perPeriod)}</td><td className="num">{peso(l.balance)}</td></tr>)}</tbody></table></Searchable>}</Card>
    <Card title="My payslips">{!d.payslips.length ? <Empty>No payslips yet.</Empty> : <ul className="divide-y text-sm">{d.payslips.map((p) => <li key={p.id} className="flex items-center justify-between py-2"><span>{fmtDate(p.run.periodFrom)} – {fmtDate(p.run.periodTo)}</span><span className="flex items-center gap-3"><b>{peso(p.netPay)}</b><button className="text-brand underline" onClick={() => api.download(`/api/reports/forms/payslip/${p.id}.pdf`, `Payslip-${fmtDate(p.run.periodTo)}.pdf`)}>Payslip</button></span></li>)}</ul>}</Card>
  </div>;
}

interface Agency { kind: 'SSS' | 'PHIC' | 'HDMF'; label: string; employeeShare: string; employerShare: string; total: string; payable: string; remitted: { referenceNo: string; paidAt: string } | null }
interface Register { year: number; month: number; employees: number; agencies: Agency[]; rows?: { employeeId: string; employeeNo: string; name: string; branch: string; sssNo: string | null; phicNo: string | null; hdmfNo: string | null; sssEe: string; sssEr: string; phicEe: string; phicEr: string; hdmfEe: string; hdmfEr: string }[] }

/** SSS / PhilHealth / Pag-IBIG per month: employee share deducted and employer share payable; per-employee names only for HR, External Auditor, Accounting Head (and Admin). */
export function ContributionsPanel() {
  const { can } = useAuth(); const qc = useQueryClient();
  const [ym, setYm] = useState(today().slice(0, 7)); const [y, m] = ym.split('-').map(Number);
  const q = useQuery({ queryKey: ['contributions', ym], queryFn: () => api.get<Register>(`/api/payroll/contributions?year=${y}&month=${m}`) });
  const accts = useQuery({ queryKey: ['payment-accounts'], queryFn: () => api.get<{ id: string; title: string }[]>('/api/accounts/payment'), enabled: can('contribution.remit') });
  const [rem, setRem] = useState<{ kind: string; referenceNo: string; paidAt: string; paidFromAccountId: string } | null>(null);
  const remit = useMutation({ mutationFn: () => api.post('/api/payroll/remittances', { kind: rem!.kind, year: y, month: m, referenceNo: rem!.referenceNo, paidAt: rem!.paidAt, paidFromAccountId: rem!.paidFromAccountId || null }), onSuccess: () => { setRem(null); void qc.invalidateQueries({ queryKey: ['contributions', ym] }); } });
  const r = q.data;
  return <Card title="Government contributions (SSS, PhilHealth, Pag-IBIG)" actions={<div className="flex items-end gap-2"><Input type="month" value={ym} onChange={(e) => setYm(e.target.value)} />{r?.rows && <Button size="sm" variant="outline" onClick={() => api.download(`/api/reports/forms/contributions/${ym}.xlsx`, `Contributions-${ym}.xlsx`)}>Register xlsx</Button>}</div>}>
    {!r ? <p className="text-sm text-slate-500">Loading…</p> : <>
      <p className="mb-2 text-xs text-slate-500">From finalized payroll runs ending in {ym} · {r.employees} employee(s). Employee share is deducted from pay; employer share is company expense; both are payable to the agency.</p>
      <Searchable><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Agency</th><th className="num">Employee share</th><th className="num">Employer share</th><th className="num">Total</th><th>Status</th><th /></tr></thead>
        <tbody>{r.agencies.map((a) => <tr key={a.kind} className="border-t"><td>{a.label}</td><td className="num">{peso(a.employeeShare)}</td><td className="num">{peso(a.employerShare)}</td><td className="num font-medium">{peso(a.total)}</td><td>{a.remitted ? <Badge tone="green">remitted {fmtDate(a.remitted.paidAt)} · ref {a.remitted.referenceNo}</Badge> : Number(a.total) > 0 ? <Badge tone="amber">payable</Badge> : <Badge>none</Badge>}</td>
          <td>{!a.remitted && Number(a.total) > 0 && can('contribution.remit') && <Button size="sm" variant="outline" onClick={() => setRem({ kind: a.kind, referenceNo: '', paidAt: today(), paidFromAccountId: '' })}>Record payment</Button>}</td></tr>)}</tbody></table></Searchable>
      {rem && <div className="mt-3 flex flex-wrap items-end gap-2 rounded bg-slate-50 p-2"><b className="self-center text-sm">{rem.kind} {ym}</b><Field label="Reference no."><Input value={rem.referenceNo} onChange={(e) => setRem({ ...rem, referenceNo: e.target.value })} /></Field><Field label="Paid on"><Input type="date" value={rem.paidAt} onChange={(e) => setRem({ ...rem, paidAt: e.target.value })} /></Field><Field label="Paid from (optional, posts to the books)"><Select value={rem.paidFromAccountId} onChange={(e) => setRem({ ...rem, paidFromAccountId: e.target.value })}><option value="">—</option>{accts.data?.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</Select></Field><Button disabled={!rem.referenceNo || remit.isPending} onClick={() => remit.mutate()}>Save</Button><Button variant="outline" onClick={() => setRem(null)}>Cancel</Button></div>}
      <ErrorBox error={remit.error} />
      {r.rows ? <div className="mt-4"><Searchable><table className="w-full text-xs"><thead className="sticky top-0 bg-white text-left text-slate-500"><tr><th>Employee</th><th>Branch</th><th>SSS no.</th><th className="num">SSS EE</th><th className="num">SSS ER</th><th className="num">PHIC EE</th><th className="num">PHIC ER</th><th className="num">HDMF EE</th><th className="num">HDMF ER</th></tr></thead>
        <tbody>{r.rows.map((x) => <tr key={x.employeeId} className="border-t"><td>{x.name} <span className="text-slate-400">{x.employeeNo}</span></td><td>{x.branch}</td><td>{x.sssNo ?? '—'}</td><td className="num">{peso(x.sssEe)}</td><td className="num">{peso(x.sssEr)}</td><td className="num">{peso(x.phicEe)}</td><td className="num">{peso(x.phicEr)}</td><td className="num">{peso(x.hdmfEe)}</td><td className="num">{peso(x.hdmfEr)}</td></tr>)}</tbody></table></Searchable></div>
        : <p className="mt-3 text-xs text-slate-500">Per-employee breakdown is visible to HR, the External Auditor and the Accounting Head only.</p>}
    </>}
  </Card>;
}

/** HR links each employee record to that person's login account (so charges and payslips reach them) and prints ledgers. */
export function EmployeeLinks() {
  const qc = useQueryClient();
  const emps = useQuery({ queryKey: ['employees'], queryFn: () => api.get<{ id: string; employeeNo: string; fullName: string; position?: string | null; locationId: string | null; location: { name: string } | null; user: { id: string; username: string } | null }[]>('/api/payroll/employees') });
  const users = useQuery({ queryKey: ['linkable-users'], queryFn: () => api.get<{ id: string; username: string; fullName: string; idNumber: string | null; role: { name: string }; employee: { id: string } | null }[]>('/api/payroll/linkable-users') });
  const [accFor, setAccFor] = useState<{ id: string; fullName: string; employeeNo: string; locationId?: string | null } | null>(null); const [accMsg, setAccMsg] = useState('');
  const link = useMutation({ mutationFn: ({ id, userId }: { id: string; userId: string | null }) => api.patch(`/api/payroll/employees/${id}`, { userId }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['employees'] }); void qc.invalidateQueries({ queryKey: ['linkable-users'] }); } });
  return <Card title="Employee ↔ account links (charges and payslips reach the person)">
    <Searchable><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Employee</th><th>Branch</th><th>Login account</th><th /></tr></thead>
      <tbody>{emps.data?.map((e) => <tr key={e.id} className="border-t"><td>{personLabel(e)} <span className="text-xs text-slate-400">{e.employeeNo}</span></td><td>{e.location?.name ?? 'Office'}</td>
        <td><Select value={e.user?.id ?? ''} onChange={(ev) => link.mutate({ id: e.id, userId: ev.target.value || null })}><option value="">— not linked —</option>{users.data?.filter((u) => !u.employee || u.employee.id === e.id).map((u) => <option key={u.id} value={u.id}>{u.fullName} ({u.username}{u.idNumber ? ` · ${u.idNumber}` : ''}) — {u.role.name}</option>)}</Select></td>
        <td className="whitespace-nowrap"><button className="text-xs text-brand underline" onClick={() => api.download(`/api/reports/forms/employee-ledger/${e.id}.pdf`, `Ledger-${e.employeeNo}.pdf`)}>Ledger</button>{!e.user && <button className="ml-3 text-xs text-brand underline" onClick={() => setAccFor(e)}>Create user account…</button>}</td></tr>)}</tbody></table></Searchable>
    <ErrorBox error={link.error} />
    {accFor && <NewAccountForm emp={accFor} onDone={(msg) => { setAccFor(null); setAccMsg(msg); }} />}
    {accMsg && <p className="mt-2 text-sm text-amber-700">{accMsg}</p>}
  </Card>;
}

/** HR opens a login for an employee; the Owner approves before it exists. The person changes the temporary password at first sign-in. */
function NewAccountForm({ emp, onDone }: { emp: { id: string; fullName: string; employeeNo: string; locationId?: string | null }; onDone: (msg: string) => void }) {
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['hr-roles'], queryFn: () => api.get<{ key: string; name: string }[]>('/api/hr/employees/roles') });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; type: string }[]>('/api/locations') });
  const [f, setF] = useState<AccountDraft>({ username: '', email: '', roleKey: 'SALES_ASSOCIATE', locationIds: emp.locationId ? [emp.locationId] : [], password: '' });
  const missing = missingFor(f);
  const m = useMutation({ mutationFn: () => api.post('/api/hr/employees/' + emp.id + '/account', { username: f.username.trim(), email: f.email.trim(), roleKey: f.roleKey, password: f.password, locationIds: f.locationIds }), onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['master-pending'] }); onDone((r as { message?: string }).message ?? 'Account created.'); } });
  return <div className="mt-3 rounded-md border border-slate-200 p-3">
    <div className="mb-2 text-sm font-medium">User account for {emp.fullName} <span className="text-xs text-slate-500">(company ID {emp.employeeNo})</span></div>
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"><AccountFields f={f} setF={setF} roles={roles.data ?? []} locations={locations.data ?? []} /></div>
    <p className="mt-2 text-xs text-slate-500">The Owner approves the account. Give the username and temporary password to the person; they set their own password at first sign-in.</p>
    <div className="mt-3 flex flex-wrap items-center gap-2"><Button disabled={missing.length > 0 || m.isPending} onClick={() => m.mutate()}>Send to the Owner</Button><Button variant="outline" onClick={() => onDone('')}>Cancel</Button>{missing.length > 0 && <span className="text-sm text-slate-500">Still needed: {missing.join(', ')}</span>}</div>
    <ErrorBox error={m.error} />
  </div>;
}

/** HR / auditors: who submitted the required weekly count sheet, week by week. */
export function WeeklyCompliancePage() {
  const [weeks, setWeeks] = useState('8');
  const q = useQuery({ queryKey: ['weekly-compliance', weeks], queryFn: () => api.get<{ weeks: string[]; rows: { userId: string; name: string; username: string; idNumber: string | null; role: string; branch: string; missed: number; compliancePct: number; weeks: { weekStart: string; submitted: boolean; controlNo: string | null; countId: string | null; current: boolean }[] }[] }>(`/api/hr/weekly-counts?weeks=${weeks}`) });
  const d = q.data;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Weekly Count Check</h1><Field label="Weeks"><Select value={weeks} onChange={(e) => setWeeks(e.target.value)}>{['4', '8', '12', '26'].map((w) => <option key={w}>{w}</option>)}</Select></Field></div>
    <p className="text-sm text-slate-500">Each branch associate submits their own count sheet every week (Monday–Sunday). Red = not submitted.</p>
    {d && <div className="overflow-auto rounded border bg-white"><Searchable><table className="w-full text-xs"><thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-2 py-1">Associate</th><th className="px-2">Branch</th><th className="px-2 num">Missed</th><th className="px-2 num">Compliance</th>{d.weeks.map((w) => <th key={w} className="px-1 text-center">{w.slice(5)}</th>)}</tr></thead>
      <tbody>{d.rows.map((r) => <tr key={r.userId} className="border-t"><td className="px-2 py-1">{r.name}<div className="text-[10px] text-slate-400">{r.username}{r.idNumber ? ` · ${r.idNumber}` : ''}</div></td><td className="px-2">{r.branch}</td><td className={`px-2 num font-semibold ${r.missed ? 'text-red-700' : ''}`}>{r.missed}</td><td className="px-2 num">{r.compliancePct}%</td>
        {r.weeks.map((w) => <td key={w.weekStart} className={`px-1 text-center ${w.submitted ? 'bg-emerald-50 text-emerald-700' : w.current ? 'bg-amber-50 text-amber-700' : 'bg-red-50 font-bold text-red-700'}`}>{w.submitted ? (w.countId ? <Link to={`/counts/${w.countId}`} title={w.controlNo ?? ''}>✔</Link> : '✔') : w.current ? '…' : '✘'}</td>)}</tr>)}</tbody></table></Searchable></div>}
  </div>;
}

interface SourceRow { type: string; id: string; number: string; date: string; summary: string; amount: number | null; route: string; staff: { employeeId: string; name: string; position: string | null }[]; items: { productId: string; name: string; qty: number; unitCharge: number }[] }
const KIND_OF_SOURCE: Record<string, string> = { WRITEOFF: 'DAMAGED', CASH_SHORT: 'CASH_SHORTAGE', COUNT_CASE: 'OTHER', TRANSFER_DIFF: 'OTHER' };

/**
 * HR creates a charge form by clicking: branch, what it is linked to (an automatic list of the branch's discrepancy forms, write-offs, BO pull-outs, cash shortages, expenses, DRs ...),
 * the items (priced at the franchise price) or an amount, and who is charged (name and position). Owner request 2026-10-19.
 */
export function NewChargeFormCard({ prefill, startOpen = false, onDone }: { prefill?: { locationId?: string; sourceType?: string; sourceQ?: string; noticeId?: string; userIds?: string[] }; startOpen?: boolean; onDone?: () => void } = {}) {
  const qc = useQueryClient(); const nav = useNavigate();
  const [open, setOpen] = useState(startOpen);
  const [f, setF] = useState({ kind: 'DAMAGED', locationId: prefill?.locationId ?? '', reason: '' });
  const [lines, setLines] = useState<{ productId?: string; description: string; qty: string; unitCharge: string }[]>([{ description: '', qty: '1', unitCharge: '' }]);
  const [emp, setEmp] = useState<Set<string>>(new Set());
  const [stype, setStype] = useState(prefill?.sourceType ?? ''); const [sq, setSq] = useState(prefill?.sourceQ ?? ''); const [picked, setPicked] = useState<SourceRow | null>(null);
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; type: string }[]>('/api/locations'), enabled: open });
  const staff = useQuery({ queryKey: ['staff', f.locationId], queryFn: () => api.get<{ id: string; fullName: string; position: string | null; userId?: string | null }[]>(`/api/staff?locationId=${f.locationId}`), enabled: open && !!f.locationId });
  const types = useQuery({ queryKey: ['charge-source-types'], queryFn: () => api.get<{ key: string; label: string }[]>('/api/charge-sources/types'), enabled: open });
  const sources = useQuery({ queryKey: ['charge-sources', f.locationId, stype, sq], queryFn: () => api.get<SourceRow[]>(`/api/charge-sources?locationId=${f.locationId}&type=${stype}${sq ? `&q=${encodeURIComponent(sq)}` : ''}`), enabled: open && !!f.locationId && !!stype });
  const total = lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.unitCharge || 0), 0);
  const pick = (x: SourceRow) => {
    setPicked(x); const label = types.data?.find((t) => t.key === x.type)?.label ?? x.type;
    setF((c) => ({ ...c, kind: KIND_OF_SOURCE[x.type] ?? c.kind, reason: `${label} ${x.number}: ${x.summary}`.slice(0, 300) }));
    setLines(x.items.length ? x.items.map((i) => ({ productId: i.productId, description: i.name, qty: String(i.qty), unitCharge: String(i.unitCharge) })) : [{ description: `${label} ${x.number}`, qty: '1', unitCharge: x.amount != null ? String(x.amount) : '' }]);
    setEmp(new Set(x.staff.map((s) => s.employeeId)));
  };
  const m = useMutation({ mutationFn: () => api.post<{ id: string }>('/api/charge-forms', { kind: f.kind, locationId: f.locationId, reason: f.reason, employeeIds: [...emp], source: picked ? { type: picked.type, id: picked.id } : null, noticeId: prefill?.noticeId ?? null, lines: lines.filter((l) => (l.description || l.productId) && Number(l.qty) > 0).map((l) => ({ productId: l.productId, description: l.productId ? undefined : l.description, qty: Number(l.qty), unitCharge: Number(l.unitCharge || 0) })) }), onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['charge-forms'] }); void qc.invalidateQueries({ queryKey: ['hr-notices'] }); onDone?.(); nav(`/charge-forms/${r.id}`); } });
  if (!open) return <Button onClick={() => setOpen(true)}>New charge form</Button>;
  return <Card title="New charge form">
    <div className="grid gap-3 md:grid-cols-3">
      <Field label="Branch"><Select value={f.locationId} onChange={(e) => { setF({ ...f, locationId: e.target.value }); setEmp(new Set()); setPicked(null); }}><option value="">—</option>{locations.data?.filter((l) => ['BRANCH', 'WAREHOUSE', 'OFFICE', 'FRANCHISE'].includes(l.type)).map((l) => <option key={l.id} value={l.id}>{locLabel(l)}</option>)}</Select></Field>
      <Field label="Linked to (what caused the charge)"><Select value={stype} onChange={(e) => { setStype(e.target.value); setPicked(null); }} data-testid="source-type"><option value="">— nothing / other —</option>{types.data?.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</Select></Field>
      <Field label="Kind"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="DAMAGED">Damaged items</option><option value="EXPIRED">Expired items</option><option value="CASH_SHORTAGE">Cash shortage</option><option value="OTHER">Other</option></Select></Field>
    </div>
    {stype && f.locationId && <div className="mt-3 rounded-xl border p-3" data-testid="source-list"><div className="flex flex-wrap items-center gap-2"><div className="text-xs font-semibold uppercase text-slate-500">Choose the document</div><Input className="w-56" placeholder="search a number or a name" value={sq} onChange={(e) => setSq(e.target.value)} /></div>
      {sources.isLoading ? <p className="mt-2 text-sm text-slate-500">Loading…</p> : !sources.data?.length ? <p className="mt-2 text-sm text-slate-500">Nothing found for this branch.</p> : <ul className="mt-2 max-h-56 divide-y overflow-auto text-sm">{sources.data.map((x) => <li key={x.id}><button type="button" className={`flex w-full flex-wrap items-center gap-2 px-2 py-1.5 text-left hover:bg-slate-50 ${picked?.id === x.id ? 'bg-brand-soft' : ''}`} onClick={() => pick(x)}><span className="font-mono text-xs">{x.number}</span><span className="text-xs text-slate-500">{fmtDate(x.date)}</span><span className="flex-1">{x.summary}</span>{x.staff.length > 0 && <span className="text-xs text-slate-500">{x.staff.map((s) => `${s.name}${s.position ? ` · ${s.position}` : ''}`).join(', ')}</span>}</button></li>)}</ul>}
      {picked && <p className="mt-2 text-xs text-emerald-700">Linked to {picked.number}. The items are filled in at the franchise price and the staff named on it are ticked: change anything you need.</p>}
    </div>}
    <Field label="Reason" className="mt-3"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. 2 tubs dropped on 25 Sep" /></Field>
    <div className="sticky-head"><table className="mt-3 w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>What is charged</th><th>Qty</th><th>Amount each (₱)</th><th className="num">Total</th><th /></tr></thead><tbody>{lines.map((l, i) => <tr key={i} className="border-t"><td><Input value={l.description} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, description: e.target.value } : x)))} /></td><td><Input type="number" min={1} className="w-20" value={l.qty} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, qty: e.target.value } : x)))} /></td><td><Input type="number" min={0} step="0.01" className="w-28" value={l.unitCharge} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, unitCharge: e.target.value } : x)))} /></td><td className="num">{peso(Number(l.qty || 0) * Number(l.unitCharge || 0))}</td><td><button className="text-red-600" onClick={() => setLines(lines.filter((_, k) => k !== i))} aria-label="Remove line">✕</button></td></tr>)}</tbody></table></div>
    <button type="button" className="mt-1 text-xs text-brand underline" onClick={() => setLines([...lines, { description: '', qty: '1', unitCharge: '' }])}>+ add a line</button>
    {f.locationId && <div className="mt-3"><div className="text-xs uppercase text-slate-500">Charge to (name and position; split equally, you can change the split after)</div><div className="mt-1 flex flex-wrap gap-3">{staff.data?.map((e) => <label key={e.id} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={emp.has(e.id)} onChange={(ev) => { const n = new Set(emp); if (ev.target.checked) n.add(e.id); else n.delete(e.id); setEmp(n); }} />{personLabel(e)}</label>)}{staff.data?.length === 0 && <span className="text-xs text-slate-500">No employee is set up for this branch yet (Payroll → Employees).</span>}</div></div>}
    <div className="mt-3 flex items-center gap-2"><Button disabled={!f.locationId || !f.reason || total <= 0 || m.isPending} onClick={() => m.mutate()} data-testid="create-charge">Create charge form ({peso(total)})</Button><Button variant="outline" onClick={() => { setOpen(false); onDone?.(); }}>Cancel</Button></div>
    <ErrorBox error={m.error} />
  </Card>;
}

/** SSS / PhilHealth / Pag-IBIG tables (owner request 2026-10-16): what the payroll runs use, with a warning when one is missing and a way to load or replace it. */
export function ContributionTablesCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['contribution-tables'], queryFn: () => api.get<{ id: string; kind: string; effectiveFrom: string; rows: unknown }[]>('/api/payroll/tables') });
  const load = useMutation({ mutationFn: () => api.post('/api/payroll/tables/defaults'), onSuccess: () => void qc.invalidateQueries({ queryKey: ['contribution-tables'] }) });
  const [edit, setEdit] = useState<{ kind: string; effectiveFrom: string; rows: string } | null>(null);
  const save = useMutation({ mutationFn: () => api.put(`/api/payroll/tables/${edit!.kind}`, { effectiveFrom: edit!.effectiveFrom, rows: JSON.parse(edit!.rows) }), onSuccess: () => { setEdit(null); void qc.invalidateQueries({ queryKey: ['contribution-tables'] }); } });
  const kinds = ['SSS', 'PHIC', 'HDMF']; const rows = q.data ?? [];
  const missing = kinds.filter((k) => !rows.some((r) => r.kind === k));
  return <Card title="Contribution tables (SSS, PhilHealth, Pag-IBIG)">
    {missing.length > 0 && <p className="mb-2 rounded-lg bg-red-50 p-2 text-sm text-red-800" data-testid="tables-missing">No table for {missing.join(', ')}: payroll computes <b>₱0</b> for it. <Button size="sm" className="ml-2" disabled={load.isPending} onClick={() => load.mutate()}>Load the standard tables</Button></p>}
    <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th>Table</th><th>Used from</th><th /></tr></thead><tbody>{kinds.map((k) => { const cur = rows.filter((r) => r.kind === k).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]; return <tr key={k} className="border-t"><td className="py-1.5 font-semibold">{k === 'PHIC' ? 'PhilHealth' : k === 'HDMF' ? 'Pag-IBIG' : k}</td><td>{cur ? fmtDate(cur.effectiveFrom) : <span className="text-red-700">none</span>}</td><td className="text-right"><Button size="sm" variant="outline" onClick={() => setEdit({ kind: k, effectiveFrom: today(), rows: JSON.stringify(cur?.rows ?? [], null, 1) })}>Replace with a new table</Button></td></tr>; })}</tbody></table>
    {edit && <div className="mt-3 space-y-2 rounded-xl border p-3"><div className="flex flex-wrap items-end gap-2"><Field label="New table for"><Input value={edit.kind} disabled /></Field><Field label="Used from"><Input type="date" value={edit.effectiveFrom} onChange={(e) => setEdit({ ...edit, effectiveFrom: e.target.value })} /></Field></div>
      <Field label="Rows (the same layout as the current table; change the figures when the rates change)"><textarea className="min-h-48 w-full rounded-xl border border-slate-200 bg-white p-2 font-mono text-xs" value={edit.rows} onChange={(e) => setEdit({ ...edit, rows: e.target.value })} /></Field>
      <ErrorBox error={save.error} /><div className="flex gap-2"><Button onClick={() => save.mutate()} disabled={save.isPending}>Save the new table</Button><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button></div></div>}
    <p className="mt-2 text-xs text-slate-500">The share of each employee comes from these tables and the monthly basic pay. In a draft payroll run HR can type the employee and employer shares of one line when they differ.</p>
  </Card>;
}


/** The charges finalized at the user's own branch: who, what for and how much, so the branch is aware (owner request 2026-10-16). */
function BranchCharges() {
  const q = useQuery({ queryKey: ['branch-charges'], queryFn: () => api.get<{ id: string; controlNo: string; kind: string; reason: string | null; branch: string; total: string; date: string | null; charged: { name: string; amount: string; acknowledged: boolean }[] }[]>('/api/me/branch-charges') });
  if (!q.data?.length) return null;
  return <Card title="Charges at my branch">
    <p className="mb-2 text-xs text-slate-500">Charge forms HR finalized for your branch, so everyone is aware. Each person acknowledges their own charge in their My Pay & Charges.</p>
    <div className="overflow-x-auto"><table className="w-full text-sm" data-testid="branch-charges"><thead className="text-left text-xs uppercase text-slate-500"><tr><th>Form</th><th>What for</th><th>Charged to</th><th className="num">Total</th></tr></thead><tbody>{q.data.map((f) => <tr key={f.id} className="border-t align-top"><td className="py-1.5"><span className="font-mono text-xs">{f.controlNo}</span><div className="text-xs text-slate-500">{f.date ? fmtDate(f.date) : ''}</div></td><td>{f.kind}{f.reason ? ` · ${f.reason}` : ''}</td><td>{f.charged.map((c) => <div key={c.name}>{c.name} {peso(c.amount)} {c.acknowledged ? <Badge tone="green">acknowledged</Badge> : <Badge tone="amber">not yet</Badge>}</div>)}</td><td className="num">{peso(f.total)}</td></tr>)}</tbody></table></div>
  </Card>;
}


/** Add several names at once, with their position (owner request 2026-10-19): one request to the Owner; the employees are made when it is approved. */
export function AddNamesCard() {
  const qc = useQueryClient();
  const blank = () => ({ fullName: '', position: '', locationId: '', basicRate: '' });
  const [rows, setRows] = useState([blank(), blank(), blank()]); const [msg, setMsg] = useState('');
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; type: string }[]>('/api/locations') });
  const send = useMutation({ mutationFn: () => api.post<{ pending?: boolean; message?: string } | { id: string }>('/api/payroll/employees/batch', { rows: rows.filter((r) => r.fullName.trim()).map((r) => ({ fullName: r.fullName.trim(), position: r.position.trim() || undefined, locationId: r.locationId || null, basicRate: Number(r.basicRate || 0) })) }), onSuccess: (r) => { setMsg((r as { pending?: boolean }).pending ? ((r as { message?: string }).message ?? 'Sent to the Owner for approval.') : 'The employees were added.'); setRows([blank(), blank(), blank()]); void qc.invalidateQueries({ queryKey: ['employees'] }); void qc.invalidateQueries({ queryKey: ['master-pending'] }); } });
  const set = (i: number, k: string, v: string) => setRows(rows.map((r, n) => (n === i ? { ...r, [k]: v } : r)));
  return <Card title="Add several names (the Owner approves)">
    <p className="mb-2 text-xs text-slate-500">Type each person's name and position. The employee numbers (GWS-0001…) are made by the system when the Owner approves.</p>
    <div className="space-y-2" data-testid="add-names">{rows.map((r, i) => <div key={i} className="grid gap-2 md:grid-cols-5"><Input placeholder="Full name" value={r.fullName} onChange={(e) => set(i, 'fullName', e.target.value)} /><Input placeholder="Position" value={r.position} onChange={(e) => set(i, 'position', e.target.value)} /><Select value={r.locationId} onChange={(e) => set(i, 'locationId', e.target.value)}><option value="">Branch: office / none</option>{locations.data?.filter((l) => ['BRANCH', 'WAREHOUSE', 'OFFICE'].includes(l.type)).map((l) => <option key={l.id} value={l.id}>{locLabel(l)}</option>)}</Select><Input type="number" placeholder="Monthly basic" value={r.basicRate} onChange={(e) => set(i, 'basicRate', e.target.value)} /><button className="text-left text-xs text-red-600" onClick={() => setRows(rows.length > 1 ? rows.filter((_, n) => n !== i) : rows)}>remove</button></div>)}</div>
    <div className="mt-2 flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" onClick={() => setRows([...rows, blank()])}>+ another name</Button><Button disabled={send.isPending || !rows.some((r) => r.fullName.trim())} onClick={() => send.mutate()} data-testid="send-names">Send to the Owner</Button>{msg && <span className="text-sm text-emerald-700">{msg}</span>}</div>
    <ErrorBox error={send.error} />
  </Card>;
}
