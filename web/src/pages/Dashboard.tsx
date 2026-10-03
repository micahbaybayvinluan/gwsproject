import { StepChips, approvalLabel, type TimelineItem } from '@/components/ApprovalTimeline';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Segmented, RingGauge, CapsuleBars, CalendarCard } from '@/components/ui/widgets';
import { api, fmtDate, peso } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CustomerServiceBoard } from './CustomerService';
import { PromoBanner } from './Promos';
import { Button, Card, Stat, Empty, ErrorBox, Textarea, Badge, statusTone } from '@/components/ui/primitives';

interface Dash { sixPack?: { stickers: number; dr: number; cards: number; amount: string }; franchiseAr?: { franchises: number; total: string; overdue: string; overdueInvoices: number; flagged: number; creditHold: number }; transfersInTransit?: { count: number; branches: { name: string; count: number }[] }; targets?: { target: number; actual: number; achievedPct: number | null; pacePct: number; belowPace: string[]; pendingApproval: number }; agentMonth?: { linked: boolean; total: number; count: number; target: number | null; achievedPct: number | null; pacePct: number | null; arOpen: number }; arDue?: { id: string; drSiNo: string; customer: string | null; branch: string; balance: string; dueDate: string; daysToDue: number; pdc: boolean }[]; cashOnHand?: { cashOnHand: string; overdue: number; dueToday: number; maxDays: number; days: { businessDate: string; outstanding: string; dueDate: string; daysLeft: number; status: string }[] }; cashOnHandBranches?: { id: string; name: string; cashOnHand: string; overdue: number; dueToday: number; oldest: string | null }[]; salesReport?: { businessDate: string; submitted: boolean; submittedAt?: string | null; auto?: boolean }; salesReportsMissing?: { name: string }[]; priceUpdates?: { id: string; product: string; what: string; oldValue: string | null; newValue: string | null; effectiveFrom: string; link: string | null; at: string }[]; myRequests?: TimelineItem[]; today: string; unreadNotifications: number; approvals?: { pending: number; oldestDays: number; withOthers?: number }; todaySales?: { count: number; total: string; byMode: Record<string, string> }; ar?: { open: string; overdue: string }; criticalStock?: { product: { name: string }; location: { name: string }; onHand: number; minQty: number; warehouseAvailable: number }[]; expiring?: { bucket: string; qty: number; valueAtSrp: string; valueAtCost?: string }[]; incomingTransfers?: number; openDiscrepancies?: number; chargeFormsPending?: number; gl?: { vouchersThisMonth: number; lockedPeriods: number }; cashFunds?: CashFunds; discrepancyDeadlines?: Deadline[]; weeklyCount?: Weekly; weeklyCountsMissedLastWeek?: { name: string; branch: string }[]; inspectionsToReview?: number; myCharges?: { toAcknowledge: number; openBalance: string } }
interface CashFunds { total: string; imprestTotal: string; funds: { locationId: string; location: string; imprest: string; balance: string; spent: string; lastReplenishedAt: string | null; lastCheck: { at: string; variance: string } | null }[] }
interface Deadline { caseId: string; caseNo: string | null; countNo: string; location: string; deadline: string; daysLeft: number; shortItems: number; shortUnits: number; explanationPending: boolean }
interface Weekly { weekStart: string; dueDate: string; daysLeft: number; submitted: boolean; submittedAt: string | null; countId: string | null; draft: boolean }
const BUCKET: Record<string, string> = { EXPIRED: 'Expired', LT_1M: '< 1 month', M1_3: '1–3 months', M3_6: '3–6 months' };

interface Perf { days: number[]; cumulative: Record<string, number[]>; monthNames: string[]; byMonth: Record<string, number[]> }

/** Sales statistic: bars for each day of this month or each month of this year (amounts in full, to the centavo). */
function StatisticCard() {
  const [mode, setMode] = useState<'daily' | 'monthly'>('daily');
  const now = new Date(Date.now() + 8 * 3600e3);
  const q = useQuery({ queryKey: ['dash-perf'], queryFn: () => api.get<Perf>(`/api/reports/sales-performance?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`), staleTime: 60_000 });
  const p = q.data;
  const cum = p ? p.days.map((_, i) => Object.values(p.cumulative).reduce((t, v) => t + (v[i] ?? 0), 0)) : [];
  const daily = p ? p.days.map((d, i) => ({ label: String(d), value: Math.round(((cum[i] ?? 0) - (cum[i - 1] ?? 0)) * 100) / 100 })) : [];
  const monthly = p ? p.monthNames.map((m, i) => ({ label: m, value: Math.round(Object.values(p.byMonth).reduce((t, v) => t + (v[i] ?? 0), 0) * 100) / 100 })) : [];
  const data = mode === 'daily' ? daily : monthly; const total = data.reduce((t, x) => t + x.value, 0);
  return <Card title="Sales statistic" actions={<Segmented value={mode} onChange={setMode} options={[['daily', 'Daily'], ['monthly', 'Monthly']]} />}>
    <div className="mb-3 text-sm text-slate-500">{mode === 'daily' ? 'Each day of this month' : 'Each month of this year'}: <b className="text-navy">{peso(total)}</b></div>
    {!p ? <Empty>Loading…</Empty> : data.length ? <CapsuleBars data={data} format={peso} /> : <Empty>No sales yet.</Empty>}
  </Card>;
}

export function DashboardPage() {
  const { me, can } = useAuth(); const nav = useNavigate();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dash>('/api/dashboard'), refetchInterval: 60000 });
  const d = q.data;
  if (!d) return <div className="text-slate-500">Loading…</div>;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-2"><div><div className="text-xs font-semibold uppercase tracking-[.16em] text-brand">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div><h1 className="text-2xl font-bold tracking-tight text-navy">Good day, {me?.fullName?.split(/[\s–-]/)[0]}</h1></div></div>
    {d.discrepancyDeadlines?.map((c) => <DeadlineAlert key={c.caseId} c={c} />)}
    {d.weeklyCount && !d.weeklyCount.submitted && <div className="rounded-md border-2 border-red-600 bg-red-50 p-3 text-red-800" data-testid="weekly-count-alarm">
      <p className="text-lg font-bold">Weekly inventory count sheet NOT yet submitted</p>
      <p className="text-sm font-semibold">Week of {d.weeklyCount.weekStart} — due {d.weeklyCount.dueDate} ({d.weeklyCount.daysLeft} day(s) left). The Head Auditor and HR see who submits.</p>
      <Link className="mt-2 inline-block rounded bg-red-700 px-3 py-1.5 text-sm font-semibold text-white" to={d.weeklyCount.countId ? `/counts/${d.weeklyCount.countId}` : '/counts?weekly=1'}>{d.weeklyCount.draft ? 'Continue my count sheet' : 'Start my weekly count'}</Link>
    </div>}
    {d.weeklyCount?.submitted && <p className="text-sm text-emerald-700">Weekly count sheet submitted for the week of {d.weeklyCount.weekStart}. Thank you.</p>}
    <PromoBanner />
    {(can('sale.create') || can('sale.create.warehouse')) && <CustomerServiceBoard compact />}
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {d.myCharges && (d.myCharges.toAcknowledge > 0 || Number(d.myCharges.openBalance) > 0) && <Link to="/my-hr"><Stat label="My charges" value={peso(d.myCharges.openBalance)} sub={d.myCharges.toAcknowledge ? `${d.myCharges.toAcknowledge} to acknowledge` : 'being deducted from payroll'} tone={d.myCharges.toAcknowledge ? 'red' : 'amber'} /></Link>}
      {d.inspectionsToReview !== undefined && <Link to="/inspections?status=SUBMITTED"><Stat label="Store inspections to review" value={d.inspectionsToReview} tone={d.inspectionsToReview ? 'amber' : undefined} /></Link>}
      {d.weeklyCountsMissedLastWeek && <Link to="/hr/weekly-counts"><Stat label="Missed last week's count sheet" value={d.weeklyCountsMissedLastWeek.length} sub={d.weeklyCountsMissedLastWeek.slice(0, 3).map((x) => x.name).join(', ')} tone={d.weeklyCountsMissedLastWeek.length ? 'red' : undefined} /></Link>}
      {d.cashFunds && <Link to="/cash-fund"><Stat label={d.cashFunds.funds.length === 1 ? `Cash fund – ${d.cashFunds.funds[0].location}` : 'Cash funds (all branches)'} value={peso(d.cashFunds.total)} sub={`of ${peso(d.cashFunds.imprestTotal)} fund`} tone={Number(d.cashFunds.total) < Number(d.cashFunds.imprestTotal) * 0.3 ? 'amber' : undefined} /></Link>}
      {d.approvals && <Link to={d.approvals.withOthers ? '/approvals?all=1' : '/approvals'}><Stat label="Pending your approval" value={d.approvals.pending} sub={`${d.approvals.pending ? `oldest ${d.approvals.oldestDays} day(s)` : 'all clear'}${d.approvals.withOthers ? ` · ${d.approvals.withOthers} more waiting with others (you may approve any)` : ''}`} tone={d.approvals.pending ? 'amber' : undefined} /></Link>}
      {d.targets && <Link to="/targets"><Stat label="Sales vs target this month" value={d.targets.target > 0 && d.targets.achievedPct != null ? `${d.targets.achievedPct}%` : peso(d.targets.actual)} sub={d.targets.target > 0 ? `${peso(d.targets.actual)} of ${peso(d.targets.target)} · ${d.targets.pacePct}% of month gone${d.targets.pendingApproval ? ` · ${d.targets.pendingApproval} target(s) waiting` : ''}` : `sales so far · no target approved yet${d.targets.pendingApproval ? ` (${d.targets.pendingApproval} waiting for the Owner)` : ''}`} tone={d.targets.target > 0 && d.targets.achievedPct != null ? (d.targets.achievedPct >= d.targets.pacePct ? 'green' : 'red') : undefined} /></Link>}
      {d.agentMonth?.linked && <Link to="/my-sales"><Stat label="My sales this month" value={peso(d.agentMonth.total)} sub={d.agentMonth.target != null ? `${d.agentMonth.achievedPct}% of ${peso(d.agentMonth.target)} target` : 'no target set yet'} tone={d.agentMonth.achievedPct != null && d.agentMonth.pacePct != null ? (d.agentMonth.achievedPct >= d.agentMonth.pacePct ? 'green' : 'red') : undefined} /></Link>}
      {d.agentMonth?.linked && <Link to="/my-sales"><Stat label="My customers' unpaid balance" value={peso(d.agentMonth.arOpen)} /></Link>}
      {d.sixPack && <Link to="/six-pack"><Stat label="6-Pack stickers today" value={d.sixPack.stickers} sub={`${d.sixPack.dr} DR · ${d.sixPack.cards} card${d.sixPack.cards === 1 ? '' : 's'} redeemed${d.sixPack.cards ? ` (${peso(d.sixPack.amount)})` : ''}`} /></Link>}
      {d.franchiseAr && <Link to="/franchise-ar"><Stat label="Franchise receivables" value={peso(d.franchiseAr.total)} sub={`overdue ${peso(d.franchiseAr.overdue)} · ${d.franchiseAr.overdueInvoices} invoice${d.franchiseAr.overdueInvoices === 1 ? '' : 's'}${d.franchiseAr.flagged ? ` · ⚑ ${d.franchiseAr.flagged} over two months` : ''}${d.franchiseAr.creditHold ? ` · ${d.franchiseAr.creditHold} on cash-before-delivery` : ''}`} tone={d.franchiseAr.flagged ? 'red' : Number(d.franchiseAr.overdue) > 0 ? 'amber' : undefined} /></Link>}
      {d.todaySales && <Link to="/sales"><Stat label={`Sales today (${d.today})`} value={peso(d.todaySales.total)} sub={`${d.todaySales.count} DR/SI · all payments`} /></Link>}
      {d.cashOnHand && <Link to="/cash-on-hand"><Stat label="Cash on hand (not yet deposited)" value={peso(d.cashOnHand.cashOnHand)} sub={Number(d.cashOnHand.cashOnHand) > 0 ? (d.cashOnHand.overdue ? `${d.cashOnHand.overdue} day(s) overdue` : d.cashOnHand.dueToday ? 'deposit due today' : `deposit within ${d.cashOnHand.maxDays} day(s)`) : 'all deposited'} tone={d.cashOnHand.overdue ? 'red' : d.cashOnHand.dueToday ? 'amber' : undefined} /></Link>}
      {d.ar && <Link to="/ar?overdue=1"><Stat label="Open AR" value={peso(d.ar.open)} sub={`overdue ${peso(d.ar.overdue)}`} tone={Number(d.ar.overdue) > 0 ? 'red' : undefined} /></Link>}
      {d.incomingTransfers !== undefined && <Link to="/transfers?direction=in"><Stat label="Incoming transfers to confirm" value={d.incomingTransfers} sub={d.incomingTransfers ? 'open each one, tick what arrived, confirm' : 'nothing to confirm'} tone={d.incomingTransfers ? 'amber' : undefined} /></Link>}
      {d.transfersInTransit && <Link to="/transfers"><Stat label="Transfers in transit" value={d.transfersInTransit.count} sub={d.transfersInTransit.count ? `waiting for ${d.transfersInTransit.branches.map((b) => `${b.name}${b.count > 1 ? ` (${b.count})` : ''}`).join(', ')} to confirm receipt` : 'none on the way'} /></Link>}
      {d.openDiscrepancies !== undefined && <Link to="/discrepancies"><Stat label="Open discrepancy cases" value={d.openDiscrepancies} tone={d.openDiscrepancies ? 'red' : undefined} /></Link>}
      {d.chargeFormsPending !== undefined && <Link to="/charge-forms"><Stat label="Charge forms awaiting HR" value={d.chargeFormsPending} tone={d.chargeFormsPending ? 'amber' : undefined} /></Link>}
      {d.gl && <Stat label="Vouchers this month" value={d.gl.vouchersThisMonth} sub={`${d.gl.lockedPeriods} period(s) locked`} />}
    </div>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        {(can('report.sales.own') || can('report.sales.all')) && me?.roleKey !== 'HR_STAFF' && <StatisticCard />}
        {(d.targets || d.cashFunds || d.agentMonth?.linked) && <Card title="At a glance"><div className="flex flex-wrap items-center justify-around gap-6">
          {d.targets && d.targets.target > 0 && d.targets.achievedPct != null && <Link to="/targets" className="text-center"><RingGauge pct={d.targets.achievedPct} sub="of this month's target" /><div className="mt-2 text-xs text-slate-500">pace {d.targets.pacePct}%</div></Link>}
          {d.agentMonth?.linked && d.agentMonth.target != null && d.agentMonth.achievedPct != null && <Link to="/my-sales" className="text-center"><RingGauge pct={d.agentMonth.achievedPct} sub="of my target" tone="green" /></Link>}
          {d.cashFunds && Number(d.cashFunds.imprestTotal) > 0 && <Link to="/cash-fund" className="text-center"><RingGauge pct={(Number(d.cashFunds.total) / Number(d.cashFunds.imprestTotal)) * 100} sub="of the cash fund left" tone="green" /></Link>}
        </div></Card>}
      </div>
      {d.cashOnHand && <CalendarCard value={d.today} max={d.today} title={<span className="text-xs font-semibold text-slate-500">cash still to deposit</span>}
        marks={Object.fromEntries(d.cashOnHand.days.filter((x) => x.status !== 'DEPOSITED').map((x) => [x.businessDate, { tone: x.status === 'OVERDUE' ? 'red' as const : 'amber' as const, hint: `${peso(x.outstanding)} to deposit` }]))}
        onSelect={(day) => nav(`/closing?date=${day}`)} />}
    </div>
    {d.todaySales && <Card title={`Today's sales by payment (${d.today})`} actions={<Link className="text-sm text-brand underline" to="/closing">Daily close</Link>}>
      <div className="grid gap-3 text-sm sm:grid-cols-5">{([['CASH', 'Cash'], ['ONLINE', 'Online (bank / GCash)'], ['CREDIT_CARD', 'Credit card'], ['AR_PDC', 'On credit (AR / PDC)']] as const).map(([k, l]) => <div key={k} className="rounded-xl bg-slate-50 p-3"><div className="text-xs uppercase tracking-wide text-slate-500">{l}</div><div className="text-lg font-bold text-navy">{peso(d.todaySales!.byMode[k])}</div></div>)}<div className="rounded-xl bg-navy p-3 text-white"><div className="text-xs uppercase tracking-wide text-white/70">Total ({d.todaySales.count} DR/SI)</div><div className="text-lg font-bold">{peso(d.todaySales.total)}</div></div></div>
    </Card>}
    {!!d.arDue?.length && <Card title="Receivables by due date (nearest first)" actions={<Link className="text-sm text-brand underline" to="/ar">All AR</Link>}>
      <table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Due</th><th>Customer</th><th>DR/SI</th>{d.arDue.some((a) => a.branch !== d.arDue![0].branch) && <th>Branch</th>}<th className="num">Balance</th><th>PDC</th></tr></thead><tbody>{d.arDue.map((a) => <tr key={a.id} className={`border-t ${a.daysToDue < 0 ? 'text-red-700' : a.daysToDue <= 3 ? 'text-amber-700' : ''}`}><td className="py-1.5 font-semibold">{fmtDate(a.dueDate)} <span className="text-xs font-normal">{a.daysToDue < 0 ? `${-a.daysToDue} day(s) overdue` : a.daysToDue === 0 ? 'today' : `in ${a.daysToDue} day(s)`}</span></td><td>{a.customer}</td><td><Link className="text-brand underline" to={`/sales/${a.id}`}>{a.drSiNo}</Link></td>{d.arDue!.some((x) => x.branch !== d.arDue![0].branch) && <td>{a.branch}</td>}<td className="num">{peso(a.balance)}</td><td>{a.pdc ? 'Yes' : '—'}</td></tr>)}</tbody></table>
    </Card>}
    {d.salesReport && !d.salesReport.submitted && <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand/30 bg-brand-soft p-3 text-sm"><span className="flex-1 font-semibold text-brand-dark">Today's Daily Sales Report is not submitted yet — review it and submit before 8 PM.</span><Link className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white" to="/reports/daily-sales?submit=1">Review & submit</Link></div>}
    {d.salesReport?.submitted && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{d.salesReport.auto ? "Today's report was submitted automatically at the cut-off." : "Today's Daily Sales Report is submitted."}</div>}
    {!!d.salesReportsMissing?.length && <Card title="Daily Sales Reports not yet submitted today"><p className="text-sm">{d.salesReportsMissing.map((b) => b.name).join(', ')}</p></Card>}
    {d.cashOnHand && Number(d.cashOnHand.cashOnHand) > 0 && <Card title={<span className="flex items-center gap-2">Cash on hand — not yet deposited {d.cashOnHand.overdue ? <Badge tone="red">{d.cashOnHand.overdue} overdue</Badge> : d.cashOnHand.dueToday ? <Badge tone="amber">due today</Badge> : null}</span>} actions={<Link className="text-sm text-brand underline" to="/cash-on-hand">Details / request extension</Link>}>
      <div className="flex flex-wrap items-baseline gap-3"><span className={`text-2xl font-bold ${d.cashOnHand.overdue ? 'text-red-700' : 'text-navy'}`}>{peso(d.cashOnHand.cashOnHand)}</span><span className="text-sm text-slate-500">deposit each day's cash within {d.cashOnHand.maxDays} day(s)</span></div>
      <ul className="mt-2 text-sm">{d.cashOnHand.days.map((x) => <li key={x.businessDate} className={x.status === 'OVERDUE' ? 'font-bold text-red-700' : x.status === 'DUE_TODAY' ? 'font-semibold text-amber-700' : 'text-slate-600'}>{fmtDate(x.businessDate)} sales: {peso(x.outstanding)} — deposit by {fmtDate(x.dueDate)} {x.daysLeft < 0 ? `(${-x.daysLeft} day(s) late)` : x.daysLeft === 0 ? '(today)' : ''}</li>)}</ul>
    </Card>}
    {!!d.cashOnHandBranches?.length && <Card title="Cash on hand per branch (not yet deposited)" actions={<Link className="text-sm text-brand underline" to="/cash-on-hand">All branches</Link>}>
      <table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Branch</th><th className="num">Cash on hand</th><th>Status</th><th>Oldest</th></tr></thead><tbody>{d.cashOnHandBranches.map((b) => <tr key={b.id} className="border-t"><td className="py-1.5"><Link className="text-brand underline" to={`/cash-on-hand?locationId=${b.id}`}>{b.name}</Link></td><td className="num">{peso(b.cashOnHand)}</td><td>{b.overdue ? <Badge tone="red">{b.overdue} overdue</Badge> : b.dueToday ? <Badge tone="amber">due today</Badge> : <Badge tone="blue">within time</Badge>}</td><td>{b.oldest ? fmtDate(b.oldest) : '—'}</td></tr>)}</tbody></table>
    </Card>}
    {d.cashFunds && d.cashFunds.funds.length > 1 && <Card title="Cash fund balances" actions={<Link className="text-sm text-brand underline" to="/cash-fund">Details</Link>}>
      <table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Branch</th><th className="num">Fund</th><th className="num">Balance</th><th className="num">Spent (to replenish)</th><th>Last store check</th></tr></thead><tbody>{d.cashFunds.funds.map((f) => <tr key={f.locationId} className="border-t"><td>{f.location}</td><td className="num">{peso(f.imprest)}</td><td className={`num font-medium ${Number(f.balance) < Number(f.imprest) * 0.3 ? 'text-red-700' : ''}`}>{peso(f.balance)}</td><td className="num">{peso(f.spent)}</td><td className="text-xs">{f.lastCheck ? <>{new Date(f.lastCheck.at).toLocaleDateString()} {Number(f.lastCheck.variance) !== 0 ? <span className="font-semibold text-red-700">({Number(f.lastCheck.variance) > 0 ? '+' : ''}{peso(f.lastCheck.variance)})</span> : <span className="text-emerald-700">(matched)</span>}</> : '—'}</td></tr>)}</tbody></table>
    </Card>}
    <div className="grid gap-4 lg:grid-cols-2">
      {d.criticalStock && <Card title="Critical stock" actions={<Link className="text-sm text-brand underline" to="/expiry">Suggested restock</Link>}>
        {!d.criticalStock.length ? <Empty>No products under minimum.</Empty> : <table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Product</th><th>Location</th><th className="num">On hand / Min</th><th className="num">WH avail.</th></tr></thead><tbody>{d.criticalStock.map((c, i) => <tr key={i} className="border-t"><td>{c.product.name}</td><td>{c.location.name}</td><td className="num text-red-700">{c.onHand} / {c.minQty}</td><td className="num">{c.warehouseAvailable}</td></tr>)}</tbody></table>}
      </Card>}
      {!!d.myRequests?.length && <Card title="My requests" actions={<span className="text-xs text-slate-500">who approved and who is next</span>}>
        <ul className="divide-y divide-slate-100">{d.myRequests.map((r) => <li key={r.id} className="py-2.5"><div className="flex flex-wrap items-center justify-between gap-2"><Link to={r.link ?? '/'} className="text-sm font-semibold text-navy hover:text-brand">{approvalLabel(r.type)}{r.controlNo ? ` · ${r.controlNo}` : ''}</Link><Badge tone={statusTone(r.status)}>{r.status === 'PENDING' ? 'In progress' : r.status.replace('_', ' ').toLowerCase()}</Badge></div><div className="mt-1.5"><StepChips item={r} /></div></li>)}</ul>
      </Card>}
      {!!d.priceUpdates?.length && <Card title="Price updates" actions={<span className="text-xs text-slate-500">last 14 days</span>}>
        <table className="w-full text-sm"><thead className="text-left text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="pb-1">Product</th><th>What</th><th className="num">Old</th><th className="num">New</th><th className="text-right">From</th></tr></thead><tbody>{d.priceUpdates.map((p) => <tr key={p.id} className="border-t border-slate-100"><td className="py-1.5 font-medium text-navy">{p.product}</td><td className="text-xs text-slate-500">{p.what}</td><td className="num text-slate-400 line-through">{p.oldValue ? peso(p.oldValue) : '—'}</td><td className={`num font-semibold ${Number(p.newValue) > Number(p.oldValue ?? 0) ? 'text-brand-dark' : 'text-emerald-700'}`}>{peso(p.newValue)}</td><td className="text-right text-xs text-slate-500">{p.effectiveFrom}</td></tr>)}</tbody></table>
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
