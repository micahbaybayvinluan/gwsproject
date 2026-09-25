import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, peso } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, Stat, Empty, ErrorBox, Textarea } from '@/components/ui/primitives';

interface Dash { today: string; unreadNotifications: number; approvals?: { pending: number; oldestDays: number }; todaySales?: { count: number; total: string; byMode: Record<string, string> }; ar?: { open: string; overdue: string }; criticalStock?: { product: { name: string }; location: { name: string }; onHand: number; minQty: number; warehouseAvailable: number }[]; expiring?: { bucket: string; qty: number; valueAtSrp: string; valueAtCost?: string }[]; incomingTransfers?: number; openDiscrepancies?: number; chargeFormsPending?: number; gl?: { vouchersThisMonth: number; lockedPeriods: number }; cashFunds?: CashFunds; discrepancyDeadlines?: Deadline[]; weeklyCount?: Weekly; weeklyCountsMissedLastWeek?: { name: string; branch: string }[]; inspectionsToReview?: number; myCharges?: { toAcknowledge: number; openBalance: string } }
interface CashFunds { total: string; imprestTotal: string; funds: { locationId: string; location: string; imprest: string; balance: string; spent: string; lastReplenishedAt: string | null; lastCheck: { at: string; variance: string } | null }[] }
interface Deadline { caseId: string; caseNo: string | null; countNo: string; location: string; deadline: string; daysLeft: number; shortItems: number; shortUnits: number; explanationPending: boolean }
interface Weekly { weekStart: string; dueDate: string; daysLeft: number; submitted: boolean; submittedAt: string | null; countId: string | null; draft: boolean }
const BUCKET: Record<string, string> = { EXPIRED: 'Expired', LT_1M: '< 1 month', M1_3: '1–3 months', M3_6: '3–6 months' };

export function DashboardPage() {
  const { me, can } = useAuth();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dash>('/api/dashboard'), refetchInterval: 60000 });
  const d = q.data;
  if (!d) return <div className="text-slate-500">Loading…</div>;
  return <div className="space-y-6">
    <h1 className="text-xl font-semibold">Good day, {me?.fullName}</h1>
    {d.discrepancyDeadlines?.map((c) => <DeadlineAlert key={c.caseId} c={c} />)}
    {d.weeklyCount && !d.weeklyCount.submitted && <div className="rounded-md border-2 border-red-600 bg-red-50 p-3 text-red-800" data-testid="weekly-count-alarm">
      <p className="text-lg font-bold">Weekly inventory count sheet NOT yet submitted</p>
      <p className="text-sm font-semibold">Week of {d.weeklyCount.weekStart} — due {d.weeklyCount.dueDate} ({d.weeklyCount.daysLeft} day(s) left). The Head Auditor and HR see who submits.</p>
      <Link className="mt-2 inline-block rounded bg-red-700 px-3 py-1.5 text-sm font-semibold text-white" to={d.weeklyCount.countId ? `/counts/${d.weeklyCount.countId}` : '/counts?weekly=1'}>{d.weeklyCount.draft ? 'Continue my count sheet' : 'Start my weekly count'}</Link>
    </div>}
    {d.weeklyCount?.submitted && <p className="text-sm text-emerald-700">Weekly count sheet submitted for the week of {d.weeklyCount.weekStart}. Thank you.</p>}
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {d.myCharges && (d.myCharges.toAcknowledge > 0 || Number(d.myCharges.openBalance) > 0) && <Link to="/my-hr"><Stat label="My charges" value={peso(d.myCharges.openBalance)} sub={d.myCharges.toAcknowledge ? `${d.myCharges.toAcknowledge} to acknowledge` : 'being deducted from payroll'} tone={d.myCharges.toAcknowledge ? 'red' : 'amber'} /></Link>}
      {d.inspectionsToReview !== undefined && <Link to="/inspections?status=SUBMITTED"><Stat label="Store inspections to review" value={d.inspectionsToReview} tone={d.inspectionsToReview ? 'amber' : undefined} /></Link>}
      {d.weeklyCountsMissedLastWeek && <Link to="/hr/weekly-counts"><Stat label="Missed last week's count sheet" value={d.weeklyCountsMissedLastWeek.length} sub={d.weeklyCountsMissedLastWeek.slice(0, 3).map((x) => x.name).join(', ')} tone={d.weeklyCountsMissedLastWeek.length ? 'red' : undefined} /></Link>}
      {d.cashFunds && <Link to="/cash-fund"><Stat label={d.cashFunds.funds.length === 1 ? `Cash fund – ${d.cashFunds.funds[0].location}` : 'Cash funds (all branches)'} value={peso(d.cashFunds.total)} sub={`of ${peso(d.cashFunds.imprestTotal)} fund`} tone={Number(d.cashFunds.total) < Number(d.cashFunds.imprestTotal) * 0.3 ? 'amber' : undefined} /></Link>}
      {d.approvals && <Link to="/approvals"><Stat label="Pending your approval" value={d.approvals.pending} sub={d.approvals.pending ? `oldest ${d.approvals.oldestDays} day(s)` : 'all clear'} tone={d.approvals.pending ? 'amber' : undefined} /></Link>}
      {d.todaySales && <Stat label={`Sales today (${d.today})`} value={peso(d.todaySales.total)} sub={`${d.todaySales.count} DR · cash ${peso(d.todaySales.byMode.CASH)}`} />}
      {d.ar && <Link to="/ar?overdue=1"><Stat label="Open AR" value={peso(d.ar.open)} sub={`overdue ${peso(d.ar.overdue)}`} tone={Number(d.ar.overdue) > 0 ? 'red' : undefined} /></Link>}
      {d.incomingTransfers !== undefined && <Link to="/transfers?direction=in&status=APPROVED"><Stat label="Incoming transfers to confirm" value={d.incomingTransfers} tone={d.incomingTransfers ? 'amber' : undefined} /></Link>}
      {d.openDiscrepancies !== undefined && <Link to="/discrepancies"><Stat label="Open discrepancy cases" value={d.openDiscrepancies} tone={d.openDiscrepancies ? 'red' : undefined} /></Link>}
      {d.chargeFormsPending !== undefined && <Link to="/charge-forms"><Stat label="Charge forms awaiting HR" value={d.chargeFormsPending} tone={d.chargeFormsPending ? 'amber' : undefined} /></Link>}
      {d.gl && <Stat label="Vouchers this month" value={d.gl.vouchersThisMonth} sub={`${d.gl.lockedPeriods} period(s) locked`} />}
    </div>
    {d.cashFunds && d.cashFunds.funds.length > 1 && <Card title="Cash fund balances" actions={<Link className="text-sm text-brand underline" to="/cash-fund">Details</Link>}>
      <table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Branch</th><th className="num">Fund</th><th className="num">Balance</th><th className="num">Spent (to replenish)</th><th>Last store check</th></tr></thead><tbody>{d.cashFunds.funds.map((f) => <tr key={f.locationId} className="border-t"><td>{f.location}</td><td className="num">{peso(f.imprest)}</td><td className={`num font-medium ${Number(f.balance) < Number(f.imprest) * 0.3 ? 'text-red-700' : ''}`}>{peso(f.balance)}</td><td className="num">{peso(f.spent)}</td><td className="text-xs">{f.lastCheck ? <>{new Date(f.lastCheck.at).toLocaleDateString()} {Number(f.lastCheck.variance) !== 0 ? <span className="font-semibold text-red-700">({Number(f.lastCheck.variance) > 0 ? '+' : ''}{peso(f.lastCheck.variance)})</span> : <span className="text-emerald-700">(matched)</span>}</> : '—'}</td></tr>)}</tbody></table>
    </Card>}
    <div className="grid gap-4 lg:grid-cols-2">
      {d.criticalStock && <Card title="Critical stock" actions={<Link className="text-sm text-brand underline" to="/expiry">Suggested restock</Link>}>
        {!d.criticalStock.length ? <Empty>No products under minimum.</Empty> : <table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Product</th><th>Location</th><th className="num">On hand / Min</th><th className="num">WH avail.</th></tr></thead><tbody>{d.criticalStock.map((c, i) => <tr key={i} className="border-t"><td>{c.product.name}</td><td>{c.location.name}</td><td className="num text-red-700">{c.onHand} / {c.minQty}</td><td className="num">{c.warehouseAvailable}</td></tr>)}</tbody></table>}
      </Card>}
      {d.expiring && <Card title="Expiring stock" actions={<Link className="text-sm text-brand underline" to="/expiry">Details</Link>}>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">{d.expiring.map((b) => <Stat key={b.bucket} label={BUCKET[b.bucket]} value={b.qty} sub={can('cost.view') && b.valueAtCost !== undefined ? `cost ${peso(b.valueAtCost)}` : `SRP ${peso(b.valueAtSrp)}`} tone={b.bucket === 'EXPIRED' && b.qty ? 'red' : b.bucket === 'LT_1M' && b.qty ? 'amber' : undefined} />)}</div>
      </Card>}
    </div>
  </div>;
}

/** Branch staff: an open discrepancy case, the days left before it is charged (bold red), and a way to explain it (HR notified, Head Auditor decides). */
function DeadlineAlert({ c }: { c: Deadline }) {
  const qc = useQueryClient(); const [open, setOpen] = useState(false); const [text, setText] = useState('');
  const m = useMutation({ mutationFn: () => api.post(`/api/discrepancies/${c.caseId}/explain`, { explanation: text }), onSuccess: () => { setOpen(false); setText(''); void qc.invalidateQueries({ queryKey: ['dashboard'] }); } });
  return <div className="rounded-md border-2 border-red-600 bg-red-50 p-3 text-red-800" data-testid="discrepancy-countdown">
    <p className="text-lg font-bold">{c.daysLeft} DAY{c.daysLeft === 1 ? '' : 'S'} LEFT before inventory discrepancy {c.caseNo ?? c.countNo} ({c.location}) is automatically charged to staff</p>
    <p className="text-sm font-semibold">{c.shortItems} item(s) short, {c.shortUnits} unit(s) · deadline {c.deadline}</p>
    {c.explanationPending ? <p className="mt-1 text-sm font-semibold">Your explanation is with the Head Auditor.</p> : <div className="mt-2">
      {!open ? <div className="flex flex-wrap gap-2"><Button size="sm" variant="danger" onClick={() => setOpen(true)}>Explain this discrepancy</Button><Link className="self-center text-sm underline" to={`/discrepancies/${c.caseId}`}>See the items</Link></div> : <div className="space-y-2">
        <Textarea rows={3} placeholder="What happened? (sold but not keyed, damaged, transferred, counting error…)" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex gap-2"><Button size="sm" disabled={text.trim().length < 5 || m.isPending} onClick={() => m.mutate()}>Send to HR and the Head Auditor</Button><Button size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button></div>
        <ErrorBox error={m.error} />
      </div>}
    </div>}
  </div>;
}
