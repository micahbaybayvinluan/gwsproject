import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, ErrorBox, Field, Input, Select, Stat, Textarea } from '@/components/ui/primitives';

/** §8.7 Franchise portal: stock, incoming transfers, today's sales, AR to warehouse, expiring stock; own P&L (Phase 2); own expenses. */
export function FranchisePage() {
  const { can } = useAuth();
  const p = useQuery({ queryKey: ['portal'], queryFn: () => api.get<{ franchise: { name: string }; stockLines: number; stockUnits: number; incoming: { id: string; controlNo: string; from: string; lines: number }[]; todaySales: { count: number; total: string }; arToWarehouse: { openInvoices: string; transfersAtFranchiseCost: string }; expiring: { bucket: string; qty: number }[] }>('/api/franchise/portal') });
  const [range, setRange] = useState({ from: today().slice(0, 8) + '01', to: today() });
  const pnl = useQuery({ queryKey: ['pnl', range], queryFn: () => api.get<{ revenue: { productSales: string; fees: string; total: string }; costOfGoodsAtFranchiseCost: string; grossProfit: string; expenses: { category: string; amount: string }[]; totalExpenses: string; netIncome: string }>(`/api/franchise/pnl?from=${range.from}&to=${range.to}`), enabled: can('franchise.pnl') });
  const [exp, setExp] = useState({ category: 'Rent', payee: '', amount: '', notes: '' });
  const addExp = useMutation({ mutationFn: () => api.post('/api/expenses/franchise', { ...exp, amount: Number(exp.amount) }), onSuccess: () => { setExp({ ...exp, amount: '', payee: '' }); void pnl.refetch(); } });
  const [msg, setMsg] = useState(''); const request = useMutation({ mutationFn: () => api.put('/api/franchise/request-product', { message: msg }), onSuccess: () => setMsg('') });
  const d = p.data; if (!d) return null;
  return <div className="space-y-4">
    <h1 className="text-xl font-semibold">Franchise portal — {d.franchise.name}</h1>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Stock on hand" value={d.stockUnits} sub={`${d.stockLines} products`} /><Stat label="Today's sales" value={peso(d.todaySales.total)} sub={`${d.todaySales.count} DR`} /><Stat label="Owed to GWS (open AR)" value={peso(d.arToWarehouse.openInvoices)} sub={`transfers at franchise cost ${peso(d.arToWarehouse.transfersAtFranchiseCost)}`} /><Stat label="Expiring / expired" value={d.expiring.reduce((s, b) => s + b.qty, 0)} tone={d.expiring.find((b) => b.bucket === 'EXPIRED')?.qty ? 'red' : undefined} /></div>
    <Card title="Incoming transfers to confirm">{d.incoming.length ? <ul className="divide-y text-sm">{d.incoming.map((t) => <li key={t.id} className="flex items-center justify-between py-2"><span>{t.controlNo} from {t.from} · {t.lines} line(s)</span><Link to={`/transfers/${t.id}`}><Button size="sm">Confirm</Button></Link></li>)}</ul> : <p className="text-sm text-slate-500">None pending.</p>}</Card>
    {can('franchise.pnl') && <Card title="Franchise Income Statement (sales − COGS at franchise cost − expenses)" actions={<><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></>}>{pnl.data && <table className="w-full text-sm"><tbody>{[['Product sales', pnl.data.revenue.productSales], ['Delivery / shipping fees', pnl.data.revenue.fees], ['Total revenue', pnl.data.revenue.total], ['Cost of goods (franchise cost)', pnl.data.costOfGoodsAtFranchiseCost], ['Gross profit', pnl.data.grossProfit], ...pnl.data.expenses.map((e) => [`  ${e.category}`, e.amount] as [string, string]), ['Total expenses', pnl.data.totalExpenses], ['Net income', pnl.data.netIncome]].map(([k, v]) => <tr key={k} className={`border-t ${/^(Total|Gross|Net)/.test(k) ? 'font-medium' : ''}`}><td className="py-1 whitespace-pre">{k}</td><td className="num">{peso(v)}</td></tr>)}</tbody></table>}</Card>}
    {can('franchise.expense') && <Card title="Franchise expense (own P&L only; does not post to GWS books)"><div className="grid gap-2 md:grid-cols-4"><Select value={exp.category} onChange={(e) => setExp({ ...exp, category: e.target.value })}>{['Rent', 'Utilities', 'Salaries', 'Supplies', 'Delivery', 'Marketing', 'Others'].map((c) => <option key={c}>{c}</option>)}</Select><Input placeholder="Payee" value={exp.payee} onChange={(e) => setExp({ ...exp, payee: e.target.value })} /><Input type="number" placeholder="Amount" value={exp.amount} onChange={(e) => setExp({ ...exp, amount: e.target.value })} /><Button disabled={!exp.amount} onClick={() => addExp.mutate()}>Add</Button></div><ErrorBox error={addExp.error} /></Card>}
    <Card title="Request a product from the warehouse"><Field label="Message"><Textarea rows={2} value={msg} onChange={(e) => setMsg(e.target.value)} /></Field><Button className="mt-2" variant="outline" disabled={!msg} onClick={() => request.mutate()}>Send</Button>{request.isSuccess && <span className="ml-2 text-sm text-emerald-700">Sent to warehouse</span>}</Card>
  </div>;
}
