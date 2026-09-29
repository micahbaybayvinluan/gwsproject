import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { api, fmtDate, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, Select, Textarea } from '@/components/ui/primitives';
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
    <h1 className="text-2xl font-bold tracking-tight text-navy">Inventory Cost</h1>
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
interface Contact { name: string; type: string; contactNumber: string; email: string; branches: string; channels: string; itemsOrdered: string; purchases: number; totalPurchases: number; firstPurchase: string; lastPurchase: string }
interface FollowUp { id: string; customerName: string | null; phone: string | null; email: string | null; product: string; store: string; qty: number; dueDate: string; due: boolean; status: string; note: string | null; smsSentAt: string | null; emailSentAt: string | null }

/** Customer list (with items ordered) and the re-order follow-ups: whom to call, and SMS / email with the Owner's message. */
export function CustomersReportPage() {
  const { me, can } = useAuth(); const [sp] = useSearchParams(); const qc = useQueryClient();
  const [tab, setTab] = useState<'list' | 'followups'>(sp.get('tab') === 'followups' ? 'followups' : 'list');
  const [f, setF] = useState({ from: '', to: '', locationId: '' });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; isSelling: boolean }[]>('/api/locations'), enabled: !me?.locationScoped });
  const qs = `${f.from ? `from=${f.from}&` : ''}${f.to ? `to=${f.to}&` : ''}${f.locationId ? `locationId=${f.locationId}` : ''}`;
  const q = useQuery({ queryKey: ['customers-report', qs], queryFn: () => api.get<Contact[]>(`/api/reports/customers?${qs}`), enabled: tab === 'list' });
  const [status, setStatus] = useState('');
  const fu = useQuery({ queryKey: ['follow-ups', status, f.locationId], queryFn: () => api.get<FollowUp[]>(`/api/customer-follow-ups?${status ? `status=${status}&` : ''}${f.locationId ? `locationId=${f.locationId}` : ''}`), enabled: tab === 'followups' });
  const upd = useMutation({ mutationFn: (x: { id: string; status: string }) => api.put(`/api/customer-follow-ups/${x.id}`, { status: x.status }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['follow-ups'] }) });
  const [compose, setCompose] = useState<{ followUpId?: string; channel: 'SMS' | 'EMAIL'; to: string; subject: string; body: string } | null>(null);
  const openCompose = async (x: FollowUp, channel: 'SMS' | 'EMAIL') => { const pv = await api.get<{ sms: string; subject: string; email: string; phone: string | null; emailTo: string | null }>(`/api/customer-follow-ups/${x.id}/preview`); setCompose({ followUpId: x.id, channel, to: (channel === 'SMS' ? pv.phone : pv.emailTo) ?? '', subject: pv.subject, body: channel === 'SMS' ? pv.sms : pv.email }); };
  const send = useMutation({ mutationFn: () => api.post<{ status: string; error: string | null }>('/api/customer-follow-ups/send', compose), onSuccess: (r) => { setSent(r.status === 'SENT' ? 'Sent.' : `Not sent: ${r.error ?? r.status}`); setCompose(null); void qc.invalidateQueries({ queryKey: ['follow-ups'] }); } });
  const [sent, setSent] = useState('');
  const canSend = can('sale.create') || can('report.sales.all');
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Customers &amp; Follow-ups</h1>
      {!me?.locationScoped && <Field label="Branch"><Select value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}><option value="">All</option>{locations.data?.filter((l) => l.isSelling).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>}
      {tab === 'list' && <><Field label="From"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field><Field label="To"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
      <Button variant="outline" onClick={() => api.download(`/api/reports/customers.xlsx?${qs}`, 'CustomerContacts.xlsx')}>Generate xlsx</Button></>}</div>
    <div className="inline-flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">{([['list', 'Customers & items ordered'], ['followups', 'Re-order follow-ups']] as const).map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold ${tab === k ? 'bg-navy text-white shadow' : 'text-slate-600 hover:text-navy'}`}>{l}</button>)}</div>
    {tab === 'list' && <DataTable data={q.data ?? []} columns={[{ header: 'Customer', accessorKey: 'name' }, { header: 'Contact number', accessorKey: 'contactNumber' }, { header: 'Email', accessorKey: 'email' }, { header: 'Items ordered', accessorKey: 'itemsOrdered', cell: (c) => <span className="text-xs">{String(c.getValue() ?? '')}</span> }, { header: 'Branch(es)', accessorKey: 'branches' }, { header: 'Purchases', accessorKey: 'purchases' }, { header: 'Total', accessorKey: 'totalPurchases', cell: (c) => <span className="num block">{peso(c.getValue())}</span> }, { header: 'Last purchase', accessorKey: 'lastPurchase', cell: (c) => fmtDate(String(c.getValue())) }]} />}
    {tab === 'followups' && <Card title="Customers who may have finished their supplements" actions={<Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">To call (due and upcoming)</option><option value="CONTACTED">Contacted</option><option value="DISMISSED">Dismissed</option></Select>}>
      <p className="mb-3 text-sm text-slate-600">Each product can have <b>days to consume</b> (set on the product). When a customer with a contact number or email buys it, the store is reminded on the day it is probably finished. {me?.roleKey === 'ADMIN' ? 'Edit the SMS / email message and automatic sending in Settings.' : ''}</p>
      {sent && <p className="mb-2 text-sm text-slate-700">{sent}</p>}
      {fu.data?.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-2">Customer</th><th>Bought</th><th>Store</th><th>Probably finished</th><th>Status</th><th /></tr></thead><tbody>{fu.data.map((x) => <tr key={x.id} className="border-t align-top">
        <td className="py-2"><div className="font-medium">{x.customerName || '—'}</div><div className="text-xs text-slate-500">{x.phone && <a className="text-brand underline" href={`tel:${x.phone.replace(/\s/g, '')}`}>{x.phone}</a>}{x.phone && x.email ? ' · ' : ''}{x.email}</div></td>
        <td>{x.qty}× {x.product}</td><td>{x.store}</td>
        <td className={x.due && x.status !== 'CONTACTED' ? 'font-semibold text-brand-dark' : ''}>{fmtDate(x.dueDate)}</td>
        <td><Badge tone={x.status === 'CONTACTED' ? 'green' : x.status === 'NOTIFIED' ? 'amber' : x.status === 'DISMISSED' ? 'slate' : 'blue'}>{x.status === 'PENDING' ? 'upcoming' : x.status.toLowerCase()}</Badge>{x.smsSentAt && <div className="text-xs text-slate-500">SMS sent</div>}{x.emailSentAt && <div className="text-xs text-slate-500">email sent</div>}</td>
        <td className="whitespace-nowrap text-right">{canSend && x.status !== 'DISMISSED' && <>{x.phone && <Button size="sm" variant="outline" onClick={() => void openCompose(x, 'SMS')}>SMS</Button>} {x.email && <Button size="sm" variant="outline" onClick={() => void openCompose(x, 'EMAIL')}>Email</Button>} {x.status !== 'CONTACTED' && <Button size="sm" onClick={() => upd.mutate({ id: x.id, status: 'CONTACTED' })}>Contacted</Button>} <Button size="sm" variant="ghost" onClick={() => upd.mutate({ id: x.id, status: 'DISMISSED' })}>Dismiss</Button></>}</td></tr>)}</tbody></table></div> : <Empty>No customers to call.</Empty>}
    </Card>}
    {compose && <Modal title={compose.channel === 'SMS' ? 'Send SMS' : 'Send email'} onClose={() => setCompose(null)}>
      <Field label="To"><Input value={compose.to} onChange={(e) => setCompose({ ...compose, to: e.target.value })} /></Field>
      {compose.channel === 'EMAIL' && <Field label="Subject" className="mt-2"><Input value={compose.subject} onChange={(e) => setCompose({ ...compose, subject: e.target.value })} /></Field>}
      <Field label="Message" className="mt-2" hint={compose.channel === 'SMS' ? `${compose.body.length} characters (160 per SMS)` : undefined}><Textarea rows={compose.channel === 'SMS' ? 4 : 8} value={compose.body} onChange={(e) => setCompose({ ...compose, body: e.target.value })} /></Field>
      <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setCompose(null)}>Cancel</Button><Button disabled={!compose.to || !compose.body.trim() || send.isPending} onClick={() => send.mutate()}>Send</Button></div>
      <ErrorBox error={send.error} />
    </Modal>}
  </div>;
}
