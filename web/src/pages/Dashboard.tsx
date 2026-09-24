import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, peso } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Card, Stat, Empty } from '@/components/ui/primitives';

interface Dash { today: string; unreadNotifications: number; approvals?: { pending: number; oldestDays: number }; todaySales?: { count: number; total: string; byMode: Record<string, string> }; ar?: { open: string; overdue: string }; criticalStock?: { product: { name: string }; location: { name: string }; onHand: number; minQty: number; warehouseAvailable: number }[]; expiring?: { bucket: string; qty: number; valueAtSrp: string; valueAtCost?: string }[]; incomingTransfers?: number; openDiscrepancies?: number; chargeFormsPending?: number; gl?: { vouchersThisMonth: number; lockedPeriods: number } }
const BUCKET: Record<string, string> = { EXPIRED: 'Expired', LT_1M: '< 1 month', M1_3: '1–3 months', M3_6: '3–6 months' };

export function DashboardPage() {
  const { me, can } = useAuth();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dash>('/api/dashboard'), refetchInterval: 60000 });
  const d = q.data;
  if (!d) return <div className="text-slate-500">Loading…</div>;
  return <div className="space-y-6">
    <h1 className="text-xl font-semibold">Good day, {me?.fullName}</h1>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {d.approvals && <Link to="/approvals"><Stat label="Pending your approval" value={d.approvals.pending} sub={d.approvals.pending ? `oldest ${d.approvals.oldestDays} day(s)` : 'all clear'} tone={d.approvals.pending ? 'amber' : undefined} /></Link>}
      {d.todaySales && <Stat label={`Sales today (${d.today})`} value={peso(d.todaySales.total)} sub={`${d.todaySales.count} DR · cash ${peso(d.todaySales.byMode.CASH)}`} />}
      {d.ar && <Link to="/ar?overdue=1"><Stat label="Open AR" value={peso(d.ar.open)} sub={`overdue ${peso(d.ar.overdue)}`} tone={Number(d.ar.overdue) > 0 ? 'red' : undefined} /></Link>}
      {d.incomingTransfers !== undefined && <Link to="/transfers?direction=in&status=APPROVED"><Stat label="Incoming transfers to confirm" value={d.incomingTransfers} tone={d.incomingTransfers ? 'amber' : undefined} /></Link>}
      {d.openDiscrepancies !== undefined && <Link to="/discrepancies"><Stat label="Open discrepancy cases" value={d.openDiscrepancies} tone={d.openDiscrepancies ? 'red' : undefined} /></Link>}
      {d.chargeFormsPending !== undefined && <Link to="/charge-forms"><Stat label="Charge forms awaiting HR" value={d.chargeFormsPending} tone={d.chargeFormsPending ? 'amber' : undefined} /></Link>}
      {d.gl && <Stat label="Vouchers this month" value={d.gl.vouchersThisMonth} sub={`${d.gl.lockedPeriods} period(s) locked`} />}
    </div>
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
