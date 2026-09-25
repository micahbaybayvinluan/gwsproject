import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, Field, Input, Select } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';

const firstOfMonth = () => `${today().slice(0, 8)}01`;

/** Accounting: inventory value at cost per day or per month — beginning, receiving, transfer-in, returns, pull-out, direct cost of sales, freebies, adjustments, ending. */
export function InventoryCostPage() {
  const [f, setF] = useState({ from: firstOfMonth(), to: today(), groupBy: 'day', locationId: '' });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; type: string }[]>('/api/locations') });
  const qs = `from=${f.from}&to=${f.to}&groupBy=${f.groupBy}${f.locationId ? `&locationId=${f.locationId}` : ''}`;
  const q = useQuery({ queryKey: ['inventory-cost', qs], queryFn: () => api.get<{ rows: Record<string, string | number>[]; totals: Record<string, number> }>(`/api/reports/inventory-cost?${qs}`), enabled: !!f.from && !!f.to && f.from <= f.to });
  const [ym, setYm] = useState(today().slice(0, 7)); const [y, m] = ym.split('-').map(Number);
  const dc = useQuery({ queryKey: ['direct-cost', ym], queryFn: () => api.get<{ rows: { branch: string; category: string; accountCode: string; account: string; sales: number; directCost: number; postedInLedger: number }[]; totals: { sales: number; directCost: number; postedInLedger: number } }>(`/api/reports/direct-cost?year=${y}&month=${m}`) });
  const money = (v: unknown) => <span className="num block">{peso(v)}</span>;
  const cols = [['period', f.groupBy === 'month' ? 'Month' : 'Date'], ['branch', 'Branch'], ['beginning', 'Beginning'], ['receiving', 'Receiving'], ['transferIn', 'Transfer-in'], ['returns', 'Returns'], ['pullOut', 'Pull-out'], ['directCostOfSales', 'Direct cost of sales'], ['freebiesTasting', 'Freebies / tasting'], ['adjustments', 'Adjustments'], ['ending', 'Ending']] as const;
  return <div className="space-y-4">
    <h1 className="text-xl font-semibold">Inventory cost & direct cost</h1>
    <Card title="Inventory cost movements (at batch cost)">
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label="From"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="To"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        <Field label="Per"><Select value={f.groupBy} onChange={(e) => setF({ ...f, groupBy: e.target.value })}><option value="day">Day</option><option value="month">Month</option></Select></Field>
        <Field label="Branch"><Select value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}><option value="">All branches</option>{locations.data?.filter((l) => l.type !== 'VIRTUAL').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        <Button variant="outline" onClick={() => api.download(`/api/reports/inventory-cost.xlsx?${qs}`, `InventoryCost_${f.groupBy}_${f.from}_${f.to}.xlsx`)}>Generate xlsx</Button>
      </div>
      <DataTable data={q.data?.rows ?? []} columns={cols.map(([k, h]) => ({ header: h, accessorKey: k, ...(k === 'period' || k === 'branch' ? {} : { cell: (c: { getValue: () => unknown }) => money(c.getValue()) }) }))} />
    </Card>
    <Card title="Direct cost generated from sales (posted automatically with every sale)" actions={<div className="flex items-end gap-2"><Input type="month" value={ym} onChange={(e) => setYm(e.target.value)} /><Button size="sm" variant="outline" onClick={() => api.download(`/api/reports/direct-cost.xlsx?year=${y}&month=${m}`, `DirectCost_${ym}.xlsx`)}>xlsx</Button></div>}>
      <p className="mb-2 text-xs text-slate-500">Branches do not enter direct cost; each sale posts its batch cost to the branch's "Direct Cost" account of the chart of accounts. "Posted in ledger" shows what the automatic entries recorded (requires auto-posting to be on).</p>
      <DataTable data={dc.data?.rows ?? []} columns={[{ header: 'Branch', accessorKey: 'branch' }, { header: 'Category', accessorKey: 'category' }, { header: 'Account', accessorFn: (r) => `${r.accountCode} ${r.account}` }, { header: 'Sales', accessorKey: 'sales', cell: (c) => money(c.getValue()) }, { header: 'Direct cost', accessorKey: 'directCost', cell: (c) => money(c.getValue()) }, { header: 'Posted in ledger', accessorKey: 'postedInLedger', cell: (c) => money(c.getValue()) }]} />
    </Card>
  </div>;
}

/** Customer contact list from sales (name, contact number, email, purchases) — export to Excel. */
export function CustomersReportPage() {
  const { me } = useAuth();
  const [f, setF] = useState({ from: '', to: '', locationId: '' });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; isSelling: boolean }[]>('/api/locations'), enabled: !me?.locationScoped });
  const qs = `${f.from ? `from=${f.from}&` : ''}${f.to ? `to=${f.to}&` : ''}${f.locationId ? `locationId=${f.locationId}` : ''}`;
  const q = useQuery({ queryKey: ['customers-report', qs], queryFn: () => api.get<{ name: string; type: string; contactNumber: string; email: string; branches: string; channels: string; purchases: number; totalPurchases: number; firstPurchase: string; lastPurchase: string }[]>(`/api/reports/customers?${qs}`) });
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-xl font-semibold">Customer contacts</h1>
      {!me?.locationScoped && <Field label="Branch"><Select value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}><option value="">All</option>{locations.data?.filter((l) => l.isSelling).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>}
      <Field label="From"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field><Field label="To"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
      <Button variant="outline" onClick={() => api.download(`/api/reports/customers.xlsx?${qs}`, 'CustomerContacts.xlsx')}>Generate xlsx</Button></div>
    <DataTable data={q.data ?? []} columns={[{ header: 'Customer', accessorKey: 'name' }, { header: 'Contact number', accessorKey: 'contactNumber' }, { header: 'Email', accessorKey: 'email' }, { header: 'Type', accessorKey: 'type' }, { header: 'Branch(es)', accessorKey: 'branches' }, { header: 'Purchases', accessorKey: 'purchases' }, { header: 'Total', accessorKey: 'totalPurchases', cell: (c) => <span className="num block">{peso(c.getValue())}</span> }, { header: 'Last purchase', accessorKey: 'lastPurchase' }]} />
  </div>;
}
