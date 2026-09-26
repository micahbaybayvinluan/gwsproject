import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, fmtDate, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Select } from '@/components/ui/primitives';

interface MyCharge { id: string; amount: string; deductedToDate: string; open: string; acknowledgedAt: string | null; kindLabel: string; chargeForm: { id: string; controlNo: string; reason: string | null; totalAmount: string; createdAt: string; finalizedByHrAt: string | null; location: { name: string }; lines: { qty: number; unitCharge: string; amount: string; description: string | null; product: { name: string } | null }[] } }
interface MyHr { employee: { id: string; employeeNo: string; fullName: string; position: string | null; location: { name: string } | null } | null; charges: MyCharge[]; loans: { id: string; kind: string; principal: string; balance: string; perPeriod: string; active: boolean }[]; payslips: { id: string; netPay: string; run: { periodFrom: string; periodTo: string } }[] }

/** "My Pay & Charges": only the signed-in person's own charges (acknowledge in one click), loans/advances and payslips. */
export function MyHrPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['my-hr'], queryFn: () => api.get<MyHr>('/api/me/hr') });
  const ack = useMutation({ mutationFn: (id: string) => api.post(`/api/me/charges/${id}/acknowledge`), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['my-hr'] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); } });
  const d = q.data; if (!d) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!d.employee) return <Card title="My Pay & Charges"><p className="text-sm">Your account is not linked to an employee record yet. HR links it under Payroll → Employees.</p></Card>;
  return <div className="mx-auto max-w-4xl space-y-4">
    <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">My Pay & Charges</h1><span className="text-sm text-slate-500">{d.employee.fullName} · {d.employee.employeeNo} · {d.employee.location?.name ?? 'Office'}</span>
      <Button size="sm" variant="outline" className="ml-auto" onClick={() => api.download(`/api/reports/forms/employee-ledger/${d.employee!.id}.pdf`, 'MyLedger.pdf')}>My ledger (PDF)</Button></div>
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
    <Card title="Loans and cash advances">{!d.loans.length ? <Empty>None.</Empty> : <table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Type</th><th className="num">Amount</th><th className="num">Per payroll</th><th className="num">Balance</th></tr></thead><tbody>{d.loans.map((l) => <tr key={l.id} className="border-t"><td>{l.kind.replace(/_/g, ' ')}</td><td className="num">{peso(l.principal)}</td><td className="num">{peso(l.perPeriod)}</td><td className="num">{peso(l.balance)}</td></tr>)}</tbody></table>}</Card>
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
      <table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Agency</th><th className="num">Employee share</th><th className="num">Employer share</th><th className="num">Total</th><th>Status</th><th /></tr></thead>
        <tbody>{r.agencies.map((a) => <tr key={a.kind} className="border-t"><td>{a.label}</td><td className="num">{peso(a.employeeShare)}</td><td className="num">{peso(a.employerShare)}</td><td className="num font-medium">{peso(a.total)}</td><td>{a.remitted ? <Badge tone="green">remitted {fmtDate(a.remitted.paidAt)} · ref {a.remitted.referenceNo}</Badge> : Number(a.total) > 0 ? <Badge tone="amber">payable</Badge> : <Badge>none</Badge>}</td>
          <td>{!a.remitted && Number(a.total) > 0 && can('contribution.remit') && <Button size="sm" variant="outline" onClick={() => setRem({ kind: a.kind, referenceNo: '', paidAt: today(), paidFromAccountId: '' })}>Record payment</Button>}</td></tr>)}</tbody></table>
      {rem && <div className="mt-3 flex flex-wrap items-end gap-2 rounded bg-slate-50 p-2"><b className="self-center text-sm">{rem.kind} {ym}</b><Field label="Reference no."><Input value={rem.referenceNo} onChange={(e) => setRem({ ...rem, referenceNo: e.target.value })} /></Field><Field label="Paid on"><Input type="date" value={rem.paidAt} onChange={(e) => setRem({ ...rem, paidAt: e.target.value })} /></Field><Field label="Paid from (optional, posts to the books)"><Select value={rem.paidFromAccountId} onChange={(e) => setRem({ ...rem, paidFromAccountId: e.target.value })}><option value="">—</option>{accts.data?.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</Select></Field><Button disabled={!rem.referenceNo || remit.isPending} onClick={() => remit.mutate()}>Save</Button><Button variant="outline" onClick={() => setRem(null)}>Cancel</Button></div>}
      <ErrorBox error={remit.error} />
      {r.rows ? <div className="mt-4 max-h-96 overflow-auto"><table className="w-full text-xs"><thead className="sticky top-0 bg-white text-left text-slate-500"><tr><th>Employee</th><th>Branch</th><th>SSS no.</th><th className="num">SSS EE</th><th className="num">SSS ER</th><th className="num">PHIC EE</th><th className="num">PHIC ER</th><th className="num">HDMF EE</th><th className="num">HDMF ER</th></tr></thead>
        <tbody>{r.rows.map((x) => <tr key={x.employeeId} className="border-t"><td>{x.name} <span className="text-slate-400">{x.employeeNo}</span></td><td>{x.branch}</td><td>{x.sssNo ?? '—'}</td><td className="num">{peso(x.sssEe)}</td><td className="num">{peso(x.sssEr)}</td><td className="num">{peso(x.phicEe)}</td><td className="num">{peso(x.phicEr)}</td><td className="num">{peso(x.hdmfEe)}</td><td className="num">{peso(x.hdmfEr)}</td></tr>)}</tbody></table></div>
        : <p className="mt-3 text-xs text-slate-500">Per-employee breakdown is visible to HR, the External Auditor and the Accounting Head only.</p>}
    </>}
  </Card>;
}

/** HR links each employee record to that person's login account (so charges and payslips reach them) and prints ledgers. */
export function EmployeeLinks() {
  const qc = useQueryClient();
  const emps = useQuery({ queryKey: ['employees'], queryFn: () => api.get<{ id: string; employeeNo: string; fullName: string; locationId: string | null; location: { name: string } | null; user: { id: string; username: string } | null }[]>('/api/payroll/employees') });
  const users = useQuery({ queryKey: ['linkable-users'], queryFn: () => api.get<{ id: string; username: string; fullName: string; idNumber: string | null; role: { name: string }; employee: { id: string } | null }[]>('/api/payroll/linkable-users') });
  const [accFor, setAccFor] = useState<{ id: string; fullName: string; employeeNo: string; locationId?: string | null } | null>(null); const [accMsg, setAccMsg] = useState('');
  const link = useMutation({ mutationFn: ({ id, userId }: { id: string; userId: string | null }) => api.patch(`/api/payroll/employees/${id}`, { userId }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['employees'] }); void qc.invalidateQueries({ queryKey: ['linkable-users'] }); } });
  return <Card title="Employee ↔ account links (charges and payslips reach the person)">
    <table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Employee</th><th>Branch</th><th>Login account</th><th /></tr></thead>
      <tbody>{emps.data?.map((e) => <tr key={e.id} className="border-t"><td>{e.fullName} <span className="text-xs text-slate-400">{e.employeeNo}</span></td><td>{e.location?.name ?? 'Office'}</td>
        <td><Select value={e.user?.id ?? ''} onChange={(ev) => link.mutate({ id: e.id, userId: ev.target.value || null })}><option value="">— not linked —</option>{users.data?.filter((u) => !u.employee || u.employee.id === e.id).map((u) => <option key={u.id} value={u.id}>{u.fullName} ({u.username}{u.idNumber ? ` · ${u.idNumber}` : ''}) — {u.role.name}</option>)}</Select></td>
        <td className="whitespace-nowrap"><button className="text-xs text-brand underline" onClick={() => api.download(`/api/reports/forms/employee-ledger/${e.id}.pdf`, `Ledger-${e.employeeNo}.pdf`)}>Ledger</button>{!e.user && <button className="ml-3 text-xs text-brand underline" onClick={() => setAccFor(e)}>Create user account…</button>}</td></tr>)}</tbody></table>
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
  const [f, setF] = useState({ username: '', email: '', roleKey: 'SALES_ASSOCIATE', locationId: emp.locationId ?? '', password: '' });
  const m = useMutation({ mutationFn: () => api.post('/api/hr/employees/' + emp.id + '/account', { username: f.username, email: f.email, roleKey: f.roleKey, password: f.password, locationIds: f.locationId ? [f.locationId] : [] }), onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['master-pending'] }); onDone((r as { message?: string }).message ?? 'Account created.'); } });
  return <div className="mt-3 rounded-md border border-slate-200 p-3">
    <div className="mb-2 text-sm font-medium">User account for {emp.fullName} <span className="text-xs text-slate-500">(company ID {emp.employeeNo})</span></div>
    <div className="grid gap-2 md:grid-cols-5">
      <Field label="Username"><Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.trim() })} /></Field>
      <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value.trim() })} /></Field>
      <Field label="Role"><Select value={f.roleKey} onChange={(e) => setF({ ...f, roleKey: e.target.value })}>{roles.data?.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</Select></Field>
      <Field label="Branch"><Select value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}><option value="">— none —</option>{locations.data?.filter((l) => l.type !== 'VIRTUAL').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
      <Field label="Temporary password (10+)"><Input type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
    </div>
    <p className="mt-1 text-xs text-slate-500">The Owner approves the account. Give the temporary password to the person; they set their own at first sign-in.</p>
    <div className="mt-2 flex gap-2"><Button disabled={f.username.length < 3 || !f.email || f.password.length < 10 || m.isPending} onClick={() => m.mutate()}>Send to the Owner</Button><Button variant="outline" onClick={() => onDone('')}>Cancel</Button></div>
    <ErrorBox error={m.error} />
  </div>;
}

/** HR / auditors: who submitted the required weekly count sheet, week by week. */
export function WeeklyCompliancePage() {
  const [weeks, setWeeks] = useState('8');
  const q = useQuery({ queryKey: ['weekly-compliance', weeks], queryFn: () => api.get<{ weeks: string[]; rows: { userId: string; name: string; username: string; idNumber: string | null; role: string; branch: string; missed: number; compliancePct: number; weeks: { weekStart: string; submitted: boolean; controlNo: string | null; countId: string | null; current: boolean }[] }[] }>(`/api/hr/weekly-counts?weeks=${weeks}`) });
  const d = q.data;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-xl font-semibold">Weekly inventory count sheets — compliance</h1><Field label="Weeks"><Select value={weeks} onChange={(e) => setWeeks(e.target.value)}>{['4', '8', '12', '26'].map((w) => <option key={w}>{w}</option>)}</Select></Field></div>
    <p className="text-sm text-slate-500">Each branch associate submits their own count sheet every week (Monday–Sunday). Red = not submitted.</p>
    {d && <div className="overflow-auto rounded border bg-white"><table className="w-full text-xs"><thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-2 py-1">Associate</th><th className="px-2">Branch</th><th className="px-2 num">Missed</th><th className="px-2 num">Compliance</th>{d.weeks.map((w) => <th key={w} className="px-1 text-center">{w.slice(5)}</th>)}</tr></thead>
      <tbody>{d.rows.map((r) => <tr key={r.userId} className="border-t"><td className="px-2 py-1">{r.name}<div className="text-[10px] text-slate-400">{r.username}{r.idNumber ? ` · ${r.idNumber}` : ''}</div></td><td className="px-2">{r.branch}</td><td className={`px-2 num font-semibold ${r.missed ? 'text-red-700' : ''}`}>{r.missed}</td><td className="px-2 num">{r.compliancePct}%</td>
        {r.weeks.map((w) => <td key={w.weekStart} className={`px-1 text-center ${w.submitted ? 'bg-emerald-50 text-emerald-700' : w.current ? 'bg-amber-50 text-amber-700' : 'bg-red-50 font-bold text-red-700'}`}>{w.submitted ? (w.countId ? <Link to={`/counts/${w.countId}`} title={w.controlNo ?? ''}>✔</Link> : '✔') : w.current ? '…' : '✘'}</td>)}</tr>)}</tbody></table></div>}
  </div>;
}

/** HR creates a charge form by clicking: kind, branch, staff, and what is charged (no upload). */
export function NewChargeFormCard() {
  const qc = useQueryClient(); const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ kind: 'DAMAGED', locationId: '', reason: '' });
  const [lines, setLines] = useState<{ description: string; qty: string; unitCharge: string }[]>([{ description: '', qty: '1', unitCharge: '' }]);
  const [emp, setEmp] = useState<Set<string>>(new Set());
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; type: string }[]>('/api/locations'), enabled: open });
  const staff = useQuery({ queryKey: ['staff', f.locationId], queryFn: () => api.get<{ id: string; fullName: string; position: string | null }[]>(`/api/staff?locationId=${f.locationId}`), enabled: open && !!f.locationId });
  const total = lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.unitCharge || 0), 0);
  const m = useMutation({ mutationFn: () => api.post<{ id: string }>('/api/charge-forms', { kind: f.kind, locationId: f.locationId, reason: f.reason, employeeIds: [...emp], lines: lines.filter((l) => l.description && Number(l.qty) > 0).map((l) => ({ description: l.description, qty: Number(l.qty), unitCharge: Number(l.unitCharge || 0) })) }), onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['charge-forms'] }); nav(`/charge-forms/${r.id}`); } });
  if (!open) return <Button onClick={() => setOpen(true)}>New charge form</Button>;
  return <Card title="New charge form">
    <div className="grid gap-3 md:grid-cols-3">
      <Field label="Kind"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="DAMAGED">Damaged items</option><option value="EXPIRED">Expired items</option><option value="CASH_SHORTAGE">Cash shortage</option><option value="OTHER">Other</option></Select></Field>
      <Field label="Branch"><Select value={f.locationId} onChange={(e) => { setF({ ...f, locationId: e.target.value }); setEmp(new Set()); }}><option value="">—</option>{locations.data?.filter((l) => ['BRANCH', 'WAREHOUSE', 'OFFICE', 'FRANCHISE'].includes(l.type)).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
      <Field label="Reason"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. 2 tubs dropped on 25 Sep" /></Field>
    </div>
    <table className="mt-3 w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>What is charged</th><th>Qty</th><th>Amount each (₱)</th><th className="num">Total</th><th /></tr></thead><tbody>{lines.map((l, i) => <tr key={i} className="border-t"><td><Input value={l.description} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, description: e.target.value } : x)))} /></td><td><Input type="number" min={1} className="w-20" value={l.qty} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, qty: e.target.value } : x)))} /></td><td><Input type="number" step="0.01" className="w-28" value={l.unitCharge} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, unitCharge: e.target.value } : x)))} /></td><td className="num">{peso(Number(l.qty || 0) * Number(l.unitCharge || 0))}</td><td>{lines.length > 1 && <button className="text-red-600" onClick={() => setLines(lines.filter((_, k) => k !== i))}>✕</button>}</td></tr>)}</tbody></table>
    <button type="button" className="mt-1 text-xs text-brand underline" onClick={() => setLines([...lines, { description: '', qty: '1', unitCharge: '' }])}>+ add a line</button>
    {f.locationId && <div className="mt-3"><div className="text-xs uppercase text-slate-500">Charge to (split equally; you can change the split after)</div><div className="mt-1 flex flex-wrap gap-3">{staff.data?.map((e) => <label key={e.id} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={emp.has(e.id)} onChange={(ev) => { const n = new Set(emp); if (ev.target.checked) n.add(e.id); else n.delete(e.id); setEmp(n); }} />{e.fullName}</label>)}{staff.data?.length === 0 && <span className="text-sm text-slate-500">No employees at this branch yet.</span>}</div></div>}
    <div className="mt-3 flex items-center gap-2"><Button disabled={!f.locationId || !f.reason || total <= 0 || m.isPending} onClick={() => m.mutate()}>Create charge form ({peso(total)})</Button><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button></div>
    <ErrorBox error={m.error} />
  </Card>;
}
