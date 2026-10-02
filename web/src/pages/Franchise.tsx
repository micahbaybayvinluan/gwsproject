import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Toggle } from '@/components/ui/widgets';
import { api, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Select, Stat, Textarea } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { Searchable } from '@/components/Searchable';

interface Portal { franchise: { name: string }; stockLines: number; stockUnits: number; incoming: { id: string; controlNo: string; from: string; lines: number }[]; todaySales: { count: number; total: string }; arToWarehouse: { openInvoices: string; transfersAtFranchiseCost: string; goods?: string; penaltyAndInterest?: string; overdue?: string; overdueCount?: number; nextDue?: string | null; creditHold?: boolean } | null; expiring: { bucket: string; qty: number }[]; isOwner: boolean; associateReceives: boolean }
interface Staff { id: string; fullName: string; username: string }
interface Salary { id: string; staff: string; periodFrom: string; periodTo: string; basic: string; allowances: string; otherDeductions: string; chargesDeducted: string; netPay: string; notes: string | null }
interface Charge { id: string; staff: string; kind: string; reason: string; amount: string; deducted: boolean; acknowledgedAt: string | null; createdAt: string }
const KIND: Record<string, string> = { OTHER: 'Other', CASH_SHORTAGE: 'Cash shortage', DAMAGED: 'Damaged items', EXPIRED: 'Expired items', INVENTORY_DISCREPANCY: 'Inventory discrepancy' };

/** Franchise portal: the franchise's own stock, staff, pay, charges and books — separate from GWS (owner requests 2026-09-26). */
export function FranchisePage() {
  const qc = useQueryClient();
  const p = useQuery({ queryKey: ['portal'], queryFn: () => api.get<Portal>('/api/franchise/portal') });
  const [tab, setTab] = useState<'overview' | 'staff' | 'books'>('overview');
  const setting = useMutation({ mutationFn: (v: boolean) => api.put('/api/franchise/settings', { associateReceives: v }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['portal'] }) });
  const [msg, setMsg] = useState(''); const request = useMutation({ mutationFn: () => api.put('/api/franchise/request-product', { message: msg }), onSuccess: () => setMsg('') });
  const d = p.data;
  if (p.error) return <div className="space-y-2"><h1 className="text-2xl font-bold text-navy">Franchise Portal</h1><ErrorBox error={p.error} /><p className="text-sm text-slate-500">The franchise portal is for Franchise Owner / Franchise Sales Associate accounts assigned to a franchise location.</p></div>;
  if (!d) return <p className="text-sm text-slate-500">Loading…</p>;
  const tabs = d.isOwner ? [['overview', 'Overview'], ['staff', 'Staff pay & charges'], ['books', 'Income statement & balance sheet']] as const : [['overview', 'Overview']] as const;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-xs font-semibold uppercase tracking-[.16em] text-brand">Franchise</div><h1 className="text-2xl font-bold tracking-tight text-navy">{d.franchise.name}</h1></div>
      {tabs.length > 1 && <div className="inline-flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">{tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={cn('rounded-lg px-3.5 py-1.5 text-sm font-semibold transition', tab === k ? 'bg-navy text-white shadow' : 'text-slate-600 hover:text-navy')}>{l}</button>)}</div>}</div>
    {tab === 'overview' && <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Stock on hand" value={d.stockUnits} sub={`${d.stockLines} products`} />
        <Stat label="Today's sales" value={peso(d.todaySales.total)} sub={`${d.todaySales.count} DR`} />
        {d.arToWarehouse && <Link to="/franchise-ar"><Stat label="Owed to GWS (Franchise AR)" value={peso(d.arToWarehouse.openInvoices)} sub={Number(d.arToWarehouse.overdue ?? 0) > 0 ? `overdue ${peso(d.arToWarehouse.overdue)} incl. penalty and interest ${peso(d.arToWarehouse.penaltyAndInterest ?? 0)}` : d.arToWarehouse.nextDue ? `next due ${d.arToWarehouse.nextDue}` : 'nothing due'} tone={Number(d.arToWarehouse.overdue ?? 0) > 0 ? 'red' : 'amber'} /></Link>}
        <Stat label="Expiring / expired" value={d.expiring.reduce((s, b) => s + b.qty, 0)} tone={d.expiring.find((b) => b.bucket === 'EXPIRED')?.qty ? 'red' : undefined} />
      </div>
      {d.isOwner && <Card title="Who receives incoming stock">
        <div className="flex flex-wrap items-center gap-4 text-sm"><Toggle checked={d.associateReceives} onChange={(v) => setting.mutate(v)} disabled={setting.isPending} /><span><b className="text-navy">Let my franchise associate receive transfers from GWS.</b><br /><span className="text-slate-500">When on, your associate checks and confirms deliveries (without seeing the franchise cost) and you are notified. When off, only you confirm.</span></span></div>
        <ErrorBox error={setting.error} />
      </Card>}
      <Card title="Incoming transfers">{d.incoming.length ? <ul className="divide-y divide-slate-100 text-sm">{d.incoming.map((t) => <li key={t.id} className="flex items-center justify-between py-2.5"><span><b className="text-navy">{t.controlNo}</b> from {t.from} · {t.lines} line(s)</span>{(d.isOwner || d.associateReceives) ? <Link to={`/transfers/${t.id}`}><Button size="sm">Check & receive</Button></Link> : <Badge>the owner receives</Badge>}</li>)}</ul> : <Empty>None pending.</Empty>}</Card>
      <Card title="Request a product from the warehouse"><Field label="Message"><Textarea rows={2} value={msg} onChange={(e) => setMsg(e.target.value)} /></Field><Button className="mt-2" variant="outline" disabled={!msg} onClick={() => request.mutate()}>Send</Button>{request.isSuccess && <span className="ml-2 text-sm text-emerald-700">Sent to the warehouse</span>}</Card>
      {!d.isOwner && <p className="text-sm text-slate-500">Your pay and any charges are under <Link className="font-semibold text-brand underline" to="/my-hr">My Pay & Charges</Link>.</p>}
    </>}
    {tab === 'staff' && d.isOwner && <StaffTab />}
    {tab === 'books' && d.isOwner && <BooksTab />}
  </div>;
}

function StaffTab() {
  const qc = useQueryClient();
  const staff = useQuery({ queryKey: ['fr-staff'], queryFn: () => api.get<Staff[]>('/api/franchise/staff') });
  const salaries = useQuery({ queryKey: ['fr-salaries'], queryFn: () => api.get<Salary[]>('/api/franchise/salaries') });
  const charges = useQuery({ queryKey: ['fr-charges'], queryFn: () => api.get<Charge[]>('/api/franchise/charges') });
  const forms = useQuery({ queryKey: ['fr-charge-forms'], queryFn: () => api.get<{ id: string; controlNo: string; kind: string; reason: string | null; totalAmount: string }[]>('/api/franchise/charge-forms') });
  const inv = () => ['fr-salaries', 'fr-charges', 'fr-charge-forms'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
  const [s, setS] = useState({ userId: '', periodFrom: today().slice(0, 8) + '01', periodTo: today(), basic: '', allowances: '', otherDeductions: '', deductCharges: true, notes: '' });
  const pay = useMutation({ mutationFn: () => api.post('/api/franchise/salaries', { ...s, basic: Number(s.basic), allowances: Number(s.allowances || 0), otherDeductions: Number(s.otherDeductions || 0) }), onSuccess: () => { setS({ ...s, basic: '', allowances: '', otherDeductions: '', notes: '' }); inv(); } });
  const [c, setC] = useState({ userIds: [] as string[], kind: 'CASH_SHORTAGE', reason: '', amount: '' });
  const charge = useMutation({ mutationFn: () => api.post('/api/franchise/charges', { ...c, amount: Number(c.amount) }), onSuccess: () => { setC({ ...c, userIds: [], reason: '', amount: '' }); inv(); } });
  const [assignTo, setAssignTo] = useState<Record<string, string[]>>({});
  const assign = useMutation({ mutationFn: (id: string) => api.post(`/api/franchise/charge-forms/${id}/assign`, { userIds: assignTo[id] ?? [] }), onSuccess: inv });
  const toggle = (arr: string[], id: string) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  const openCharges = (uid: string) => (charges.data ?? []).filter((x) => !x.deducted && staff.data?.find((st) => st.id === uid)?.fullName === x.staff).reduce((t, x) => t + Number(x.amount), 0);
  const net = Number(s.basic || 0) + Number(s.allowances || 0) - Number(s.otherDeductions || 0) - (s.deductCharges && s.userId ? openCharges(s.userId) : 0);
  return <div className="space-y-5">
    <p className="text-sm text-slate-500">Your associates are paid and charged by you. Company HR does not see this. Salaries are recorded as a franchise expense in your own books.</p>
    <div className="grid gap-5 xl:grid-cols-2">
      <Card title="Record a salary">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Associate" className="sm:col-span-2"><Select value={s.userId} onChange={(e) => setS({ ...s, userId: e.target.value })}><option value="">— choose —</option>{staff.data?.map((x) => <option key={x.id} value={x.id}>{x.fullName}</option>)}</Select></Field>
          <Field label="From"><Input type="date" value={s.periodFrom} onChange={(e) => setS({ ...s, periodFrom: e.target.value })} /></Field><Field label="To"><Input type="date" value={s.periodTo} onChange={(e) => setS({ ...s, periodTo: e.target.value })} /></Field>
          <Field label="Basic pay (₱)"><Input type="number" min={0} value={s.basic} onChange={(e) => setS({ ...s, basic: e.target.value })} /></Field><Field label="Allowances (₱)"><Input type="number" min={0} value={s.allowances} onChange={(e) => setS({ ...s, allowances: e.target.value })} /></Field>
          <Field label="Other deductions (₱)"><Input type="number" min={0} value={s.otherDeductions} onChange={(e) => setS({ ...s, otherDeductions: e.target.value })} /></Field>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" className="accent-[#c8102e]" checked={s.deductCharges} onChange={(e) => setS({ ...s, deductCharges: e.target.checked })} /> Deduct open charges{s.userId ? ` (${peso(openCharges(s.userId))})` : ''}</label>
        </div>
        <div className="mt-3 flex items-center justify-between rounded-xl bg-silver px-4 py-2"><span className="text-sm text-slate-600">Net pay</span><span className={`text-lg font-bold ${net < 0 ? 'text-brand-dark' : 'text-navy'}`}>{peso(net)}</span></div>
        <Button className="mt-3" disabled={!s.userId || s.basic === '' || pay.isPending} onClick={() => pay.mutate()}>Save salary</Button><ErrorBox error={pay.error} />
      </Card>
      <Card title="Charge an associate">
        <div className="mb-2 text-[13px] font-medium text-slate-600">Who</div>
        <div className="mb-3 flex flex-wrap gap-3">{staff.data?.map((x) => <label key={x.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="accent-[#c8102e]" checked={c.userIds.includes(x.id)} onChange={() => setC({ ...c, userIds: toggle(c.userIds, x.id) })} />{x.fullName}</label>)}{!staff.data?.length && <span className="text-sm text-slate-500">No associates assigned to this franchise.</span>}</div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Kind"><Select value={c.kind} onChange={(e) => setC({ ...c, kind: e.target.value })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field><Field label="Amount (₱, split equally)"><Input type="number" min={0.01} value={c.amount} onChange={(e) => setC({ ...c, amount: e.target.value })} /></Field><Field label="Reason" className="sm:col-span-2"><Input value={c.reason} onChange={(e) => setC({ ...c, reason: e.target.value })} /></Field></div>
        <Button className="mt-3" disabled={!c.userIds.length || !(Number(c.amount) > 0) || c.reason.trim().length < 3 || charge.isPending} onClick={() => charge.mutate()}>Charge</Button><ErrorBox error={charge.error} />
      </Card>
    </div>
    {!!forms.data?.length && <Card title="Charge forms from GWS for your branch (assign them to your associates)">
      <ul className="divide-y divide-slate-100">{forms.data.map((cf) => <li key={cf.id} className="py-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm"><b className="text-navy">{cf.controlNo}</b> · {KIND[cf.kind] ?? cf.kind} · {cf.reason}</span><span className="font-semibold text-navy">{peso(cf.totalAmount)}</span></div>
        <div className="mt-2 flex flex-wrap items-center gap-3">{staff.data?.map((x) => <label key={x.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="accent-[#c8102e]" checked={(assignTo[cf.id] ?? []).includes(x.id)} onChange={() => setAssignTo({ ...assignTo, [cf.id]: toggle(assignTo[cf.id] ?? [], x.id) })} />{x.fullName}</label>)}<Button size="sm" disabled={!(assignTo[cf.id] ?? []).length || assign.isPending} onClick={() => assign.mutate(cf.id)}>Assign</Button></div></li>)}</ul>
      <ErrorBox error={assign.error} />
    </Card>}
    <div className="grid gap-5 xl:grid-cols-2">
      <Card title="Salaries paid">{!salaries.data?.length ? <Empty>No salaries recorded yet.</Empty> : <Searchable><table className="w-full text-sm"><thead className="text-left text-[11px] uppercase tracking-wide text-slate-500"><tr><th>Associate</th><th>Period</th><th className="num">Gross</th><th className="num">Charges</th><th className="num">Net</th></tr></thead><tbody>{salaries.data.map((x) => <tr key={x.id} className="border-t border-slate-100"><td className="py-1.5">{x.staff}</td><td className="text-xs">{x.periodFrom} – {x.periodTo}</td><td className="num">{peso(Number(x.basic) + Number(x.allowances))}</td><td className="num text-brand-dark">{Number(x.chargesDeducted) ? peso(x.chargesDeducted) : '—'}</td><td className="num font-semibold">{peso(x.netPay)}</td></tr>)}</tbody></table></Searchable>}</Card>
      <Card title="Charges">{!charges.data?.length ? <Empty>No charges.</Empty> : <table className="w-full text-sm"><tbody>{charges.data.map((x) => <tr key={x.id} className="border-t border-slate-100"><td className="py-1.5">{x.staff}</td><td className="text-xs">{KIND[x.kind] ?? x.kind}: {x.reason}</td><td className="num font-semibold">{peso(x.amount)}</td><td className="text-right">{x.deducted ? <Badge tone="green">deducted</Badge> : <Badge tone="amber">open</Badge>}{x.acknowledgedAt && <Badge tone="blue">seen</Badge>}</td></tr>)}</tbody></table>}</Card>
    </div>
  </div>;
}

function BooksTab() {
  const [r, setR] = useState({ from: today().slice(0, 8) + '01', to: today() }); const [asOf, setAsOf] = useState(today());
  const is = useQuery({ queryKey: ['fr-is', r], queryFn: () => api.get<{ revenue: { productSales: string; fees: string; total: string }; costOfGoodsAtFranchiseCost: string; grossProfit: string; expenses: { category: string; amount: string }[]; totalExpenses: string; otherIncome: { staffChargesRecovered: string }; netIncome: string }>(`/api/franchise/income-statement?from=${r.from}&to=${r.to}`) });
  const bs = useQuery({ queryKey: ['fr-bs', asOf], queryFn: () => api.get<{ assets: { account: string; amount: string }[]; totalAssets: string; liabilities: { account: string; amount: string }[]; totalLiabilities: string; equity: { account: string; amount: string }[]; totalEquity: string; note: string }>(`/api/franchise/balance-sheet?asOf=${asOf}`) });
  const row = (k: string, v: string | number, strong = false, indent = false) => <tr key={k} className={cn('border-t border-slate-100', strong && 'font-semibold text-navy')}><td className={cn('py-1.5', indent && 'pl-4 text-slate-600')}>{k}</td><td className="num">{peso(v)}</td></tr>;
  const exp = useState({ category: 'Rent', payee: '', amount: '', notes: '' }); const [e, setE] = exp; const qc = useQueryClient();
  const addExp = useMutation({ mutationFn: () => api.post('/api/expenses/franchise', { ...e, amount: Number(e.amount) }), onSuccess: () => { setE({ ...e, amount: '', payee: '' }); void qc.invalidateQueries({ queryKey: ['fr-is'] }); void qc.invalidateQueries({ queryKey: ['fr-bs'] }); } });
  return <div className="space-y-5">
    <p className="text-sm text-slate-500">These statements are built from your franchise's own records only, separate from the other branches of GWS.</p>
    <div className="grid gap-5 xl:grid-cols-2">
      <Card title="Income statement" actions={<><Input type="date" value={r.from} onChange={(x) => setR({ ...r, from: x.target.value })} /><Input type="date" value={r.to} onChange={(x) => setR({ ...r, to: x.target.value })} /></>}>
        {is.data ? <table className="w-full text-sm"><tbody>
          {row('Product sales', is.data.revenue.productSales, false, true)}{row('Delivery / shipping fees', is.data.revenue.fees, false, true)}{row('Total revenue', is.data.revenue.total, true)}
          {row('Cost of goods (franchise cost)', is.data.costOfGoodsAtFranchiseCost, false, true)}{row('Gross profit', is.data.grossProfit, true)}
          {is.data.expenses.map((x) => row(x.category, x.amount, false, true))}{row('Total expenses', is.data.totalExpenses, true)}
          {row('Staff charges recovered', is.data.otherIncome.staffChargesRecovered, false, true)}
          <tr className="border-t-2 border-navy font-bold text-navy"><td className="py-2">Net income</td><td className={`num ${Number(is.data.netIncome) < 0 ? 'text-brand-dark' : ''}`}>{peso(is.data.netIncome)}</td></tr>
        </tbody></table> : <Empty>Loading…</Empty>}<ErrorBox error={is.error} />
      </Card>
      <Card title="Balance sheet" actions={<Input type="date" value={asOf} onChange={(x) => setAsOf(x.target.value)} />}>
        {bs.data ? <table className="w-full text-sm"><tbody>
          <tr><td colSpan={2} className="pb-1 text-xs font-semibold uppercase tracking-wider text-brand">Assets</td></tr>{bs.data.assets.map((a) => row(a.account, a.amount, false, true))}{row('Total assets', bs.data.totalAssets, true)}
          <tr><td colSpan={2} className="pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-brand">Liabilities</td></tr>{bs.data.liabilities.map((a) => row(a.account, a.amount, false, true))}{row('Total liabilities', bs.data.totalLiabilities, true)}
          <tr><td colSpan={2} className="pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-brand">Equity</td></tr>{bs.data.equity.map((a) => row(a.account, a.amount, false, true))}
          <tr className="border-t-2 border-navy font-bold text-navy"><td className="py-2">Liabilities + equity</td><td className="num">{peso(Number(bs.data.totalLiabilities) + Number(bs.data.totalEquity))}</td></tr>
        </tbody></table> : <Empty>Loading…</Empty>}
        {bs.data && <p className="mt-2 text-xs text-slate-500">{bs.data.note}</p>}<ErrorBox error={bs.error} />
      </Card>
    </div>
    <Card title="Add a franchise expense (your books only)"><div className="grid gap-2 md:grid-cols-4"><Select value={e.category} onChange={(x) => setE({ ...e, category: x.target.value })}>{['Rent', 'Utilities', 'Supplies', 'Delivery', 'Marketing', 'Others'].map((cat) => <option key={cat}>{cat}</option>)}</Select><Input placeholder="Payee" value={e.payee} onChange={(x) => setE({ ...e, payee: x.target.value })} /><Input type="number" min={0.01} placeholder="Amount" value={e.amount} onChange={(x) => setE({ ...e, amount: x.target.value })} /><Button disabled={!(Number(e.amount) > 0)} onClick={() => addExp.mutate()}>Add</Button></div><p className="mt-1 text-xs text-slate-500">Salaries are added automatically when you record them under Staff pay.</p><ErrorBox error={addExp.error} /></Card>
  </div>;
}
