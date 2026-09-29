import { locLabel } from '@/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Field, Input, Select, Stat } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';

const DENOMS = [1000, 500, 200, 100, 50, 20, 10, 5, 1];
interface Summary { businessDate: string; cashSalesOnly: string; cashCollections: string; cashSales: string; cashExpenses: string; fundReplenishment?: string; expectedCash: string; totalCashDeposit: string; salesCount: number; expenseCount: number; closed: boolean; close: { countedCash: string | null; cashVariance: string | null; moneyBreakdown: Record<string, number> | null } | null }

/** §8.4 Daily close: summary, Money Breakdown cash count (variance recorded, not blocking), post-close edit requests, deposit. */
export function ClosingPage() {
  const { me, can } = useAuth(); const qc = useQueryClient();
  const [locationId, setLocationId] = useState(me!.locations[0]?.id ?? ''); const [date, setDate] = useState(today());
  const [bd, setBd] = useState<Record<string, number>>({});
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; isSelling: boolean }[]>('/api/locations'), enabled: !me!.locationScoped });
  const s = useQuery({ queryKey: ['closing', locationId, date], queryFn: () => api.get<Summary>(`/api/closing/summary?locationId=${locationId}&date=${date}`), enabled: !!locationId });
  const edits = useQuery({ queryKey: ['post-close-edits'], queryFn: () => api.get<{ id: string; documentType: string; documentId: string; reason: string; appliedAt: string | null; createdAt: string }[]>('/api/closing/edits') });
  const banks = useQuery({ queryKey: ['payment-accounts-bank'], queryFn: () => api.get<{ id: string; title: string; paymentAccountType: string }[]>('/api/accounts/payment'), enabled: can('sale.create') });
  const count = useMutation({ mutationFn: () => api.post('/api/closing/cash-count', { locationId, date, breakdown: bd }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['closing'] }) });
  const [dep, setDep] = useState({ amount: '', bankAccountId: '', depositedAt: today() });
  const deposit = useMutation({ mutationFn: () => api.post('/api/expenses/deposits', { locationId, businessDate: date, amount: Number(dep.amount), bankAccountId: dep.bankAccountId, depositedAt: dep.depositedAt }) });
  const counted = DENOMS.reduce((t, d) => t + (bd[String(d)] ?? 0) * d, 0);
  const d = s.data;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Daily Close & Deposit</h1>{!me!.locationScoped && <Field label="Branch"><Select value={locationId} onChange={(e) => setLocationId(e.target.value)}><option value="">—</option>{locations.data?.filter((l) => l.isSelling).map((l) => <option key={l.id} value={l.id}>{locLabel(l)}</option>)}</Select></Field>}<Field label="Business day"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field></div>
    {d && <>
      <div className="flex items-center gap-2 text-sm">{d.closed ? <Badge tone="red">CLOSED — edits need approval</Badge> : <Badge tone="green">OPEN (closes 00:00 Manila)</Badge>}</div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Cash sales" value={peso(d.cashSalesOnly)} sub={`${d.salesCount} DR · + collections ${peso(d.cashCollections)}`} />
        <Stat label="Cash-paid expenses" value={peso(d.cashExpenses)} sub={`${d.expenseCount} expense(s)`} />
        <Stat label="Expected cash" value={peso(d.expectedCash)} sub={Number(d.fundReplenishment ?? 0) ? `after ${peso(d.fundReplenishment)} cash fund replenishment` : undefined} />
        <Stat label="Total cash deposit" value={peso(d.totalCashDeposit)} tone="green" />
      </div>
      {can('sale.create') && <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Money Breakdown (cash count)">
          <table className="w-full text-sm"><tbody>{DENOMS.map((den) => <tr key={den} className="border-b"><td className="py-1 w-20">₱{den}</td><td><Input type="number" inputMode="numeric" min={0} className="max-w-28" value={bd[String(den)] ?? ''} onChange={(e) => setBd({ ...bd, [String(den)]: Number(e.target.value || 0) })} aria-label={`Count of ${den}`} data-testid={`denom-${den}`} /></td><td className="num">{peso((bd[String(den)] ?? 0) * den)}</td></tr>)}</tbody><tfoot><tr className="font-medium"><td colSpan={2}>Counted</td><td className="num">{peso(counted)}</td></tr><tr><td colSpan={2}>Expected</td><td className="num">{peso(d.expectedCash)}</td></tr><tr className={counted - Number(d.expectedCash) === 0 ? 'text-emerald-700' : 'text-red-700'}><td colSpan={2}>Variance</td><td className="num" data-testid="variance">{peso(counted - Number(d.expectedCash))}</td></tr></tfoot></table>
          <div className="mt-3 flex items-center gap-2"><Button onClick={() => count.mutate()} disabled={count.isPending} data-testid="save-count">Save cash count</Button>{count.isSuccess && <span className="text-sm text-emerald-700">Saved</span>}</div>
          {d.close?.countedCash != null && <p className="mt-2 text-xs text-slate-500">Last saved count {peso(d.close.countedCash)} (variance {peso(d.close.cashVariance)})</p>}
          <ErrorBox error={count.error} />
        </Card>
        <Card title="Bank deposit">
          <div className="grid gap-3 md:grid-cols-3"><Field label="Amount"><Input type="number" inputMode="decimal" value={dep.amount || d.totalCashDeposit} onChange={(e) => setDep({ ...dep, amount: e.target.value })} /></Field><Field label="Bank account"><Select value={dep.bankAccountId} onChange={(e) => setDep({ ...dep, bankAccountId: e.target.value })}><option value="">—</option>{banks.data?.filter((b) => b.paymentAccountType === 'BANK').map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}</Select></Field><Field label="Deposited on"><Input type="date" value={dep.depositedAt} onChange={(e) => setDep({ ...dep, depositedAt: e.target.value })} /></Field></div>
          <Button className="mt-3" variant="outline" disabled={!dep.bankAccountId} onClick={() => deposit.mutate()}>Record deposit</Button>{deposit.isSuccess && <span className="ml-2 text-sm text-emerald-700">Recorded</span>}<ErrorBox error={deposit.error} />
          <div className="mt-4 flex gap-2"><Button variant="outline" size="sm" onClick={() => api.download(`/api/reports/daily-sales.xlsx?locationId=${locationId}&date=${date}`, `DailySalesReport_${date}.xlsx`)}>Daily Sales Report xlsx</Button><Button variant="outline" size="sm" onClick={() => api.download(`/api/reports/daily-sales.pdf?locationId=${locationId}&date=${date}`, `DailySalesReport_${date}.pdf`)}>PDF</Button></div>
        </Card>
      </div>}
      {!can('sale.create') && d.close?.countedCash != null && <p className="text-sm">Cash counted {peso(d.close.countedCash)} · variance <span className={Number(d.close.cashVariance) < 0 ? 'font-semibold text-red-700' : ''}>{peso(d.close.cashVariance)}</span></p>}
    </>}
    {can('charge.assign') && <ShortagesCard locationId={me!.locationScoped ? undefined : locationId || undefined} />}
    {(can('sale.create') || can('revision.request')) && <Card title="Post-close edit requests"><DataTable data={edits.data ?? []} columns={[{ header: 'Requested', accessorFn: (r) => new Date(r.createdAt).toLocaleString() }, { header: 'Document', accessorFn: (r) => `${r.documentType} ${r.documentId.slice(0, 8)}` }, { header: 'Reason', accessorKey: 'reason' }, { header: 'Status', cell: (c) => <Badge tone={c.row.original.appliedAt ? 'green' : 'amber'}>{c.row.original.appliedAt ? 'APPLIED' : 'PENDING'}</Badge> }]} /></Card>}
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
    {!short.length ? <p className="text-sm text-slate-500">No cash shortages recorded.</p> : <table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Day</th><th>Branch</th><th className="num">Expected</th><th className="num">Counted</th><th className="num">Short</th><th /></tr></thead><tbody>{short.map((c) => <tr key={c.id} className="border-t"><td className="py-1">{c.businessDate.slice(0, 10)}</td><td>{c.location.name}</td><td className="num">{peso(c.expectedCash)}</td><td className="num">{peso(c.countedCash)}</td><td className="num font-semibold text-red-700">{peso(Math.abs(Number(c.cashVariance)))}</td><td className="text-right">{c.chargeFormId ? <Badge tone="green">charged</Badge> : <Button size="sm" variant="outline" onClick={() => { setSel(c); setEmp(new Set()); }}>Charge to staff…</Button>}</td></tr>)}</tbody></table>}
    {sel && <div className="mt-3 rounded border border-slate-200 p-3">
      <p className="mb-2 text-sm">Charge {peso(Math.abs(Number(sel.cashVariance)))} ({sel.location.name}, {sel.businessDate.slice(0, 10)}) to the staff on duty, split equally:</p>
      <div className="flex flex-wrap gap-3">{staff.data?.map((e) => <label key={e.id} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={emp.has(e.id)} onChange={(ev) => { const n = new Set(emp); if (ev.target.checked) n.add(e.id); else n.delete(e.id); setEmp(n); }} />{e.fullName}</label>)}{staff.data?.length === 0 && <span className="text-sm text-slate-500">No employee records for this branch yet (HR → Employees).</span>}</div>
      <div className="mt-2 flex gap-2"><Button disabled={!emp.size || m.isPending} onClick={() => m.mutate()}>Create charge form</Button><Button variant="outline" onClick={() => setSel(null)}>Cancel</Button></div>
    </div>}
    {m.data && <p className="mt-2 text-sm text-emerald-700">Charge form {m.data.controlNo} created. HR and the staff were notified.</p>}
    <ErrorBox error={m.error} />
  </Card>;
}
