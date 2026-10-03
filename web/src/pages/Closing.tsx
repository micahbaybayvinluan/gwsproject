import { PostCloseEditCard } from '@/components/PostCloseEditCard';
import { locLabel } from '@/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Attachments } from '@/components/Attachments';
import { CalendarCard } from '@/components/ui/widgets';
import { api, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Select, Stat } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';
import { Searchable } from '@/components/Searchable';

const DENOMS = [1000, 500, 200, 100, 50, 20, 10, 5, 1];
interface CashOnHand { cashOnHand: string; days: { businessDate: string; toDeposit: string; deposited: string; outstanding: string; dueDate: string; daysLeft: number; status: string }[] }
interface Summary { businessDate: string; cashSalesOnly: string; cashCollections: string; cashSales: string; cashExpenses: string; fundReplenishment?: string; replacementCash?: string; expectedCash: string; totalCashDeposit: string; salesCount: number; expenseCount: number; closed: boolean; close: { countedCash: string | null; cashVariance: string | null; moneyBreakdown: Record<string, number> | null } | null }

/** §8.4 Daily close: summary, Money Breakdown cash count (variance recorded, not blocking), post-close edit requests, deposit. */
export function ClosingPage() {
  const { me, can } = useAuth(); const qc = useQueryClient();
  const [locationId, setLocationId] = useState(me!.locations[0]?.id ?? ''); const [sp0] = useSearchParams(); const [date, setDate] = useState(/^\d{4}-\d{2}-\d{2}$/.test(sp0.get('date') ?? '') ? sp0.get('date')! : today());
  const [bd, setBd] = useState<Record<string, number>>({});
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; isSelling: boolean }[]>('/api/locations'), enabled: !me!.locationScoped });
  const s = useQuery({ queryKey: ['closing', locationId, date], queryFn: () => api.get<Summary>(`/api/closing/summary?locationId=${locationId}&date=${date}`), enabled: !!locationId });
  const edits = useQuery({ queryKey: ['post-close-edits'], queryFn: () => api.get<{ id: string; documentType: string; documentId: string; reason: string; appliedAt: string | null; createdAt: string }[]>('/api/closing/edits') });
  const banks = useQuery({ queryKey: ['payment-accounts-bank'], queryFn: () => api.get<{ id: string; title: string; paymentAccountType: string }[]>('/api/accounts/payment'), enabled: can('sale.create') });
  const count = useMutation({ mutationFn: () => api.post('/api/closing/cash-count', { locationId, date, breakdown: bd }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['closing'] }) });
  const [dep, setDep] = useState({ amount: '', bankAccountId: '', depositedAt: today() });
  const [slip, setSlip] = useState<{ draft: string; id: string | null }>({ draft: crypto.randomUUID(), id: null });
  const cash = useQuery({ queryKey: ['cash-on-hand', locationId], queryFn: () => api.get<CashOnHand>(`/api/cash-on-hand?locationId=${locationId}`), enabled: !!locationId && (can('sale.create') || can('cashdeposit.view.all')) });
  const deposit = useMutation({ mutationFn: () => api.post('/api/expenses/deposits', { locationId, businessDate: date, amount: Number(dep.amount || d?.totalCashDeposit), bankAccountId: dep.bankAccountId, depositedAt: dep.depositedAt, slipAttachmentId: slip.id }), onSuccess: () => { setSlip({ draft: crypto.randomUUID(), id: null }); setDep({ ...dep, amount: '' }); void qc.invalidateQueries({ queryKey: ['deposits'] }); void qc.invalidateQueries({ queryKey: ['cash-on-hand'] }); } });
  const pendingDays = (cash.data?.days ?? []).filter((x) => x.status !== 'DEPOSITED');
  const counted = DENOMS.reduce((t, d) => t + (bd[String(d)] ?? 0) * d, 0);
  const d = s.data;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Daily Close & Deposit</h1>{!me!.locationScoped && <Field label="Branch"><Select value={locationId} onChange={(e) => setLocationId(e.target.value)}><option value="">—</option>{locations.data?.filter((l) => l.isSelling).map((l) => <option key={l.id} value={l.id}>{locLabel(l)}</option>)}</Select></Field>}<Field label="Business day"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field></div>
    {d && <>
      <div className="flex items-center gap-2 text-sm">{d.closed ? <Badge tone="red">CLOSED — edits need approval</Badge> : <Badge tone="green">OPEN (closes 00:00 Manila)</Badge>}</div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Cash sales" value={peso(d.cashSalesOnly)} sub={`${d.salesCount} DR · + collections ${peso(d.cashCollections)}${Number(d.replacementCash ?? 0) ? ` · replacement payments ${peso(d.replacementCash)}` : ''}`} />
        <Stat label="Cash-paid expenses" value={peso(d.cashExpenses)} sub={`${d.expenseCount} expense(s)`} />
        <Stat label="Expected cash" value={peso(d.expectedCash)} sub={Number(d.fundReplenishment ?? 0) ? `after ${peso(d.fundReplenishment)} cash fund replenishment` : undefined} />
        <Stat label="Total cash deposit" value={peso(d.totalCashDeposit)} tone="green" />
      </div>
      {can('sale.create') && <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Money Breakdown (cash count)">
          <div className="sticky-head"><table className="w-full text-sm"><tbody>{DENOMS.map((den) => <tr key={den} className="border-b"><td className="py-1 w-20">₱{den}</td><td><Input type="number" inputMode="numeric" min={0} className="max-w-28" value={bd[String(den)] ?? ''} onChange={(e) => setBd({ ...bd, [String(den)]: Number(e.target.value || 0) })} aria-label={`Count of ${den}`} data-testid={`denom-${den}`} /></td><td className="num">{peso((bd[String(den)] ?? 0) * den)}</td></tr>)}</tbody><tfoot><tr className="font-medium"><td colSpan={2}>Counted</td><td className="num">{peso(counted)}</td></tr><tr><td colSpan={2}>Expected</td><td className="num">{peso(d.expectedCash)}</td></tr><tr className={counted - Number(d.expectedCash) === 0 ? 'text-emerald-700' : 'text-red-700'}><td colSpan={2}>Variance</td><td className="num" data-testid="variance">{peso(counted - Number(d.expectedCash))}</td></tr></tfoot></table></div>
          <div className="mt-3 flex items-center gap-2"><Button onClick={() => count.mutate()} disabled={count.isPending} data-testid="save-count">Save cash count</Button>{count.isSuccess && <span className="text-sm text-emerald-700">Saved</span>}</div>
          {d.close?.countedCash != null && <p className="mt-2 text-xs text-slate-500">Last saved count {peso(d.close.countedCash)} (variance {peso(d.close.cashVariance)})</p>}
          <ErrorBox error={count.error} />
        </Card>
        <Card title="Bank deposit">
          {can('sale.create') && <div className="mb-4 grid gap-4"><div className="rounded-2xl bg-amber-50 p-3" data-testid="pending-days">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-900">Cash still to deposit: {cash.data ? peso(cash.data.cashOnHand) : '…'}</div>
            {pendingDays.length ? <div className="flex flex-wrap gap-2">{pendingDays.map((x) => <button key={x.businessDate} type="button" onClick={() => { setDate(x.businessDate); setDep({ ...dep, amount: x.outstanding }); }} className={`rounded-2xl px-3.5 py-2 text-left text-sm shadow-soft transition hover:shadow-md ${x.businessDate === date ? 'ring-2 ring-brand' : ''} ${x.status === 'OVERDUE' ? 'bg-brand-soft text-brand-dark' : 'bg-white text-navy'}`}><div className="font-semibold">{x.businessDate}</div><div>{peso(x.outstanding)}</div><div className="text-[11px]">{x.status === 'OVERDUE' ? `${-x.daysLeft} day(s) overdue` : x.status === 'DUE_TODAY' ? 'deposit today' : `${x.daysLeft} day(s) left`}</div></button>)}</div> : <p className="text-sm text-slate-600">Nothing waiting: every day’s cash has been deposited.</p>}
            <p className="mt-1 text-[11px] text-slate-600">Press a date (or a coloured day on the calendar) to deposit that day’s cash.</p></div>
            <CalendarCard value={date} max={today()} onSelect={(day) => { setDate(day); const x = pendingDays.find((p) => p.businessDate === day); setDep({ ...dep, amount: x ? x.outstanding : '' }); }} marks={Object.fromEntries(pendingDays.map((x) => [x.businessDate, { tone: x.status === 'OVERDUE' ? 'red' as const : 'amber' as const, hint: `${peso(x.outstanding)} to deposit` }]))} /></div>}
          <p className="mb-2 text-sm text-slate-600">Depositing the cash of <b>{date}</b>. Attach the <b>bank deposit slip</b>: the Audit Associate checks it, then the Accounting Associate.</p>
          <div className="grid gap-3 md:grid-cols-3"><Field label="Amount"><Input type="number" inputMode="decimal" value={dep.amount || d.totalCashDeposit} onChange={(e) => setDep({ ...dep, amount: e.target.value })} /></Field><Field label="Bank account"><Select value={dep.bankAccountId} onChange={(e) => setDep({ ...dep, bankAccountId: e.target.value })}><option value="">—</option>{banks.data?.filter((b) => b.paymentAccountType === 'BANK').map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}</Select></Field><Field label="Deposited on"><Input type="date" value={dep.depositedAt} onChange={(e) => setDep({ ...dep, depositedAt: e.target.value })} /></Field></div>
          <div className="mt-3"><Attachments key={slip.draft} type="CashDeposit" id={slip.draft} title="Deposit slip (required)" uploadLabel="Attach deposit slip" onUploaded={(a) => setSlip({ ...slip, id: a.id })} /></div>
          <Button className="mt-3" variant="outline" disabled={!dep.bankAccountId || !slip.id || deposit.isPending} onClick={() => deposit.mutate()}>Record deposit</Button>{deposit.isSuccess && <span className="ml-2 text-sm text-emerald-700">Recorded: waiting for the Audit Associate</span>}{!slip.id && <span className="ml-2 text-xs text-amber-700">Attach the slip first.</span>}<ErrorBox error={deposit.error} />
          <div className="mt-4 flex gap-2"><Button variant="outline" size="sm" onClick={() => api.download(`/api/reports/daily-sales.xlsx?locationId=${locationId}&date=${date}`, `DailySalesReport_${date}.xlsx`)}>Daily Sales Report xlsx</Button><Button variant="outline" size="sm" onClick={() => api.download(`/api/reports/daily-sales.pdf?locationId=${locationId}&date=${date}`, `DailySalesReport_${date}.pdf`)}>PDF</Button></div>
        </Card>
      </div>}
      {!can('sale.create') && d.close?.countedCash != null && <p className="text-sm">Cash counted {peso(d.close.countedCash)} · variance <span className={Number(d.close.cashVariance) < 0 ? 'font-semibold text-red-700' : ''}>{peso(d.close.cashVariance)}</span></p>}
    </>}
    {locationId && (can('expense.view') || can('expense.create.branch')) && <DepositsCard locationId={locationId} canFix={can('expense.create.branch')} />}
    {can('charge.assign') && <ShortagesCard locationId={me!.locationScoped ? undefined : locationId || undefined} />}
    {!can('sale.create') && can('revision.request') && <Card title="Post-close edit requests"><DataTable data={edits.data ?? []} columns={[{ header: 'Requested', accessorFn: (r) => new Date(r.createdAt).toLocaleString() }, { header: 'Document', accessorFn: (r) => `${r.documentType} ${r.documentId.slice(0, 8)}` }, { header: 'Reason', accessorKey: 'reason' }, { header: 'Status', cell: (c) => <Badge tone={c.row.original.appliedAt ? 'green' : 'amber'}>{c.row.original.appliedAt ? 'APPLIED' : 'PENDING'}</Badge> }]} /></Card>}
    {can('sale.create') && locationId && <PostCloseEditCard locationId={locationId} date={date} isFranchise={me!.locations.find((l) => l.id === locationId)?.type === 'FRANCHISE'} />}
  </div>;
}

interface Close { id: string; businessDate: string; cashVariance: string | null; countedCash: string | null; expectedCash: string; chargeFormId: string | null; locationId: string; location: { name: string } }
/** Cash shortages at the count, charged to the staff on duty (Head Auditor / HR). HR then finalizes and payroll deducts it. */
function ShortagesCard({ locationId }: { locationId?: string }) {
  const qc = useQueryClient();
  const closes = useQuery({ queryKey: ['closes', locationId], queryFn: () => api.get<Close[]>(`/api/closing/closes${locationId ? `?locationId=${locationId}` : ''}`) });
  const short = (closes.data ?? []).filter((c) => c.cashVariance != null && Number(c.cashVariance) < 0);
  const [sel, setSel] = useState<Close | null>(null); const [emp, setEmp] = useState<Set<string>>(new Set());
  const staff = useQuery({ queryKey: ['staff', sel?.locationId], queryFn: () => api.get<{ id: string; fullName: string; position: string | null }[]>(`/api/staff?locationId=${sel!.locationId}`), enabled: !!sel });
  const m = useMutation({ mutationFn: () => api.post<{ controlNo: string }>(`/api/closing/closes/${sel!.id}/charge-shortage`, { employeeIds: [...emp] }), onSuccess: () => { setSel(null); setEmp(new Set()); void qc.invalidateQueries({ queryKey: ['closes'] }); } });
  return <Card title="Cash shortages">
    {!short.length ? <p className="text-sm text-slate-500">No cash shortages recorded.</p> : <Searchable><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Day</th><th>Branch</th><th className="num">Expected</th><th className="num">Counted</th><th className="num">Short</th><th /></tr></thead><tbody>{short.map((c) => <tr key={c.id} className="border-t"><td className="py-1">{c.businessDate.slice(0, 10)}</td><td>{c.location.name}</td><td className="num">{peso(c.expectedCash)}</td><td className="num">{peso(c.countedCash)}</td><td className="num font-semibold text-red-700">{peso(Math.abs(Number(c.cashVariance)))}</td><td className="text-right">{c.chargeFormId ? <Badge tone="green">charged</Badge> : <Button size="sm" variant="outline" onClick={() => { setSel(c); setEmp(new Set()); }}>Charge to staff…</Button>}</td></tr>)}</tbody></table></Searchable>}
    {sel && <div className="mt-3 rounded border border-slate-200 p-3">
      <p className="mb-2 text-sm">Charge {peso(Math.abs(Number(sel.cashVariance)))} ({sel.location.name}, {sel.businessDate.slice(0, 10)}) to the staff on duty, split equally:</p>
      <div className="flex flex-wrap gap-3">{staff.data?.map((e) => <label key={e.id} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={emp.has(e.id)} onChange={(ev) => { const n = new Set(emp); if (ev.target.checked) n.add(e.id); else n.delete(e.id); setEmp(n); }} />{e.fullName}</label>)}{staff.data?.length === 0 && <span className="text-sm text-slate-500">No employee records for this branch yet (HR → Employees).</span>}</div>
      <div className="mt-2 flex gap-2"><Button disabled={!emp.size || m.isPending} onClick={() => m.mutate()}>Create charge form</Button><Button variant="outline" onClick={() => setSel(null)}>Cancel</Button></div>
    </div>}
    {m.data && <p className="mt-2 text-sm text-emerald-700">Charge form {m.data.controlNo} created. HR and the staff were notified.</p>}
    <ErrorBox error={m.error} />
  </Card>;
}

interface Dep { id: string; businessDate: string; depositedAt: string; amount: string; status: string; bankAccount: { title: string }; slip: { id: string; fileName: string } | null; enteredBy: string | null; auditVerifiedByName: string | null; accountingVerifiedByName: string | null; rejectedByName: string | null; rejectReason: string | null; locationId: string }
const DEP_STATUS: Record<string, { label: string; tone: 'amber' | 'blue' | 'green' | 'red' }> = {
  PENDING_AUDIT: { label: 'Waiting: Audit Associate', tone: 'amber' }, PENDING_ACCOUNTING: { label: 'Audit checked · waiting: Accounting Associate', tone: 'blue' }, VERIFIED: { label: 'Verified by Audit and Accounting', tone: 'green' }, REJECTED: { label: 'Not accepted: fix and send again', tone: 'red' },
};

/** The deposits recorded by the branch, with the slip and where each one stands (Audit Associate, then Accounting Associate). */
function DepositsCard({ locationId, canFix }: { locationId: string; canFix: boolean }) {
  const qc = useQueryClient(); const [sp] = useSearchParams(); const [fixing, setFixing] = useState<string | null>(null); const [slip, setSlip] = useState<{ draft: string; id: string | null }>({ draft: crypto.randomUUID(), id: null });
  const q = useQuery({ queryKey: ['deposits', locationId], queryFn: () => api.get<Dep[]>(`/api/expenses/deposits?locationId=${locationId}`) });
  const resend = useMutation({ mutationFn: (id: string) => api.post(`/api/expenses/deposits/${id}/resubmit`, { slipAttachmentId: slip.id }), onSuccess: () => { setFixing(null); setSlip({ draft: crypto.randomUUID(), id: null }); void qc.invalidateQueries({ queryKey: ['deposits'] }); } });
  const rows = q.data ?? [];
  return <Card title="Deposits recorded by this branch">
    {rows.length ? <div className="overflow-x-auto"><Searchable><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1 pr-3">Cash of</th><th className="pr-3">Deposited on</th><th className="num pr-3">Amount</th><th className="pr-3">Bank</th><th className="pr-3">Slip</th><th className="pr-3">By</th><th>Status</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id} className={`border-t align-top ${sp.get('deposit') === r.id ? 'bg-amber-50' : ''}`}>
        <td className="py-1.5 pr-3">{String(r.businessDate).slice(0, 10)}</td><td className="pr-3">{String(r.depositedAt).slice(0, 10)}</td><td className="num pr-3">{peso(r.amount)}</td><td className="pr-3">{r.bankAccount.title}</td>
        <td className="pr-3">{r.slip ? <button className="text-brand underline" onClick={() => api.download(`/api/attachments/file/${r.slip!.id}`, r.slip!.fileName)}>View slip</button> : <span className="text-xs text-slate-500">no slip (before slips were required)</span>}</td><td className="pr-3">{r.enteredBy}</td>
        <td><Badge tone={DEP_STATUS[r.status]?.tone}>{DEP_STATUS[r.status]?.label ?? r.status}</Badge>
          {r.auditVerifiedByName && <div className="text-xs text-slate-500">Audit: {r.auditVerifiedByName}</div>}{r.accountingVerifiedByName && <div className="text-xs text-slate-500">Accounting: {r.accountingVerifiedByName}</div>}
          {r.status === 'REJECTED' && <div className="text-xs text-red-700">{r.rejectedByName}: {r.rejectReason}</div>}
          {r.status === 'REJECTED' && canFix && (fixing === r.id ? <div className="mt-1 space-y-1"><Attachments key={slip.draft} type="CashDeposit" id={slip.draft} title="New deposit slip" uploadLabel="Attach slip" onUploaded={(a) => setSlip({ ...slip, id: a.id })} /><div className="flex gap-1"><Button size="sm" disabled={resend.isPending} onClick={() => resend.mutate(r.id)}>Send again</Button><Button size="sm" variant="outline" onClick={() => setFixing(null)}>Cancel</Button></div><ErrorBox error={resend.error} /></div> : <Button size="sm" variant="outline" className="mt-1" onClick={() => setFixing(r.id)}>Fix and send again</Button>)}</td></tr>)}</tbody></table></Searchable></div> : <Empty>No deposits recorded yet.</Empty>}
  </Card>;
}
