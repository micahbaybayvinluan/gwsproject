import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, peso, today } from '@/lib/api';
import { Badge, Card, Empty, Field, Input, Select, Stat } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';

interface Dest {
  code: string; name: string;
  totals: { forms: number; units: number; expensedUnits: number; pendingExpenseUnits: number; notEndorsedUnits: number; waitingForHeadAuditorForms: number; waitingForHeadAuditorUnits: number; value?: string; expensedValue?: string };
  products: { productId: string; sku: string; name: string; units: number; expensedUnits: number; value?: string; expensedValue?: string }[];
  docs: { id: string; controlNo: string; date: string; from: string; status: string; units: number; endorsed: boolean; expenseStatus: string | null; notes: string | null; value?: string }[];
}

const EXP = (s: string | null, endorsed: boolean) => s === 'POSTED' ? <Badge tone="green">expense booked</Badge> : s === 'PENDING' ? <Badge tone="amber">waiting for Accounting</Badge> : s === 'REJECTED' ? <Badge tone="red">not accepted</Badge> : endorsed ? <Badge tone="amber">to be endorsed</Badge> : <Badge>not endorsed</Badge>;

/** Everything given out to Prothin Marketing, GWS Marketing and BO (bad orders): items, units, what Accounting has booked as expense (owner request 2026-10-01). */
export function MarketingPulloutsPage() {
  const first = new Date(); first.setDate(1);
  const [from, setFrom] = useState(first.toISOString().slice(0, 10)); const [to, setTo] = useState(today()); const [dest, setDest] = useState('');
  const q = useQuery({ queryKey: ['marketing-summary', from, to, dest], queryFn: () => api.get<{ canCost: boolean; destinations: Dest[] }>(`/api/marketing-pullouts/summary?from=${from}&to=${to}${dest ? `&destination=${dest}` : ''}`) });
  const ds = q.data?.destinations ?? []; const canCost = !!q.data?.canCost;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Marketing & BO Pull-outs</h1>
      <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      <Field label="Destination"><Select value={dest} onChange={(e) => setDest(e.target.value)}><option value="">All three</option><option value="MKT-PROTHIN">Prothin Marketing</option><option value="MKT-GWS">GWS Marketing</option><option value="BO-BAD">BO (bad orders)</option></Select></Field></div>
    {q.isLoading ? <Empty>Loading…</Empty> : !ds.length ? <Empty>Nothing in this period.</Empty> : ds.map((d) => <Card key={d.code} title={<span className="flex flex-wrap items-center gap-2">{d.name}{d.totals.waitingForHeadAuditorForms > 0 && <Badge tone="amber">{d.totals.waitingForHeadAuditorForms} form(s) waiting for the Head Auditor</Badge>}</span>}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Forms approved" value={String(d.totals.forms)} /><Stat label="Units given out" value={String(d.totals.units)} />
        <Stat label="Units expensed (booked)" value={String(d.totals.expensedUnits)} tone="green" /><Stat label="Waiting for Accounting" value={String(d.totals.pendingExpenseUnits)} tone={d.totals.pendingExpenseUnits ? 'amber' : undefined} /><Stat label="Not endorsed as expense" value={String(d.totals.notEndorsedUnits)} />
      </div>
      {canCost && d.totals.value != null && <p className="mt-2 text-sm text-slate-600">Value at cost: <b>{peso(d.totals.value)}</b> · booked as expense: <b>{peso(d.totals.expensedValue)}</b></p>}
      <h3 className="mb-1 mt-4 text-sm font-semibold text-navy">Items given out</h3>
      {d.products.length ? <DataTable exportName={`Pullouts_${d.code}`} data={d.products} columns={[{ header: 'SKU', accessorKey: 'sku' }, { header: 'Item', accessorKey: 'name' }, { header: 'Units', accessorKey: 'units', cell: (c) => <span className="num block">{String(c.getValue())}</span> }, { header: 'Expensed', accessorKey: 'expensedUnits', cell: (c) => <span className="num block">{String(c.getValue())}</span> }, ...(canCost ? [{ header: 'Value at cost', accessorKey: 'value', cell: (c: { getValue: () => unknown }) => <span className="num block">{peso(c.getValue())}</span> }] : [])]} /> : <p className="text-sm text-slate-500">No approved pull-out yet.</p>}
      <h3 className="mb-1 mt-4 text-sm font-semibold text-navy">Forms</h3>
      <div className="overflow-x-auto"><div className="sticky-head"><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1 pr-3">Pull-Out</th><th className="pr-3">Date</th><th className="pr-3">From</th><th className="num pr-3">Units</th><th className="pr-3">Status</th><th className="pr-3">Expense</th>{canCost && <th className="num">Value</th>}</tr></thead>
        <tbody>{d.docs.map((x) => <tr key={x.id} className="border-t"><td className="py-1.5 pr-3"><Link className="font-medium text-brand hover:underline" to={`/transfers/${x.id}`}>{x.controlNo}</Link></td><td className="pr-3">{x.date}</td><td className="pr-3">{x.from}</td><td className="num pr-3">{x.units}</td><td className="pr-3"><Badge tone={x.status === 'RECEIVED' ? 'green' : 'amber'}>{x.status === 'RECEIVED' ? 'approved' : 'waiting for the Head Auditor'}</Badge></td><td className="pr-3">{EXP(x.expenseStatus, x.endorsed)}</td>{canCost && <td className="num">{x.value != null ? peso(x.value) : ''}</td>}</tr>)}</tbody></table></div></div>
    </Card>)}
  </div>;
}
