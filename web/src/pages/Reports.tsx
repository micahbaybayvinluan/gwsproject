import { PostCloseEditCard } from '@/components/PostCloseEditCard';
import { locLabel } from '@/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, Select, statusTone } from '@/components/ui/primitives';
import { Link, useSearchParams } from 'react-router-dom';
import { DataTable } from '@/components/ui/table';
import type { ColumnDef } from '@tanstack/react-table';
import { Searchable } from '@/components/Searchable';

/** §8.5 Daily Sales Report — on-screen FRONT view + xlsx/PDF exports in the sample layout. */
// the reminder to review every detail before the report is submitted (owner request 2026-09-30)
const REVIEW_ITEMS = [
  'Every sale of the day is recorded, and the totals per channel and payment (cash, card, online, AR) match the DR/SI slips.',
  'Card slips and online / GCash payments match the amounts and the accounts shown.',
  'Every expense and incentive is recorded, with its receipt.',
  'The money breakdown equals the cash I counted, and the cash to deposit is correct.',
];

export function DailySalesReportPage() {
  const { me, can } = useAuth(); const [sp] = useSearchParams(); const qc = useQueryClient();
  const [locationId, setLocationId] = useState(sp.get('locationId') ?? me!.locations[0]?.id ?? ''); const [date, setDate] = useState(sp.get('date') ?? today()); const [audit, setAudit] = useState(false);
  const sub = useQuery({ queryKey: ['dsr-submission', locationId, date], queryFn: () => api.get<{ submitted: boolean; status?: string; submittedAt?: string; submittedByName?: string | null; acknowledgementText: string }>(`/api/reports/daily-sales/submission?locationId=${locationId}&date=${date}`), enabled: !!locationId });
  const [confirmOpen, setConfirmOpen] = useState(false); const [ack, setAck] = useState(false); const [checked, setChecked] = useState<Set<number>>(new Set());
  const submit = useMutation({ mutationFn: () => api.post('/api/reports/daily-sales/submit', { locationId, date, acknowledged: true }), onSuccess: () => { setConfirmOpen(false); setAck(false); void qc.invalidateQueries({ queryKey: ['dsr-submission'] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); } });
  const canSubmit = can('sale.create') && me!.locationScoped && date === today() && sub.data && !sub.data.submitted;
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; isSelling: boolean }[]>('/api/locations'), enabled: !me!.locationScoped });
  const q = useQuery({ queryKey: ['dsr', locationId, date, audit], queryFn: () => api.get<Record<string, never>>(`/api/reports/daily-sales?locationId=${locationId}&date=${date}${audit ? '&audit=1' : ''}`), enabled: !!locationId });
  const r = q.data as unknown as { replacements: { rows: { ticketNo: string; drSiNo: string | null; customer: string | null; item: string | null; direction: string; mode: string; account: string | null; signed: string }[]; cash: string; online: string; card: string; total: string }; header: { branch: string; date: string }; cash: Record<string, string>; creditCard: Record<string, string>; onlineWalkIn: Record<string, string>; onlineDelivery: Record<string, string>; shipping: Record<string, string>; onlineCcShippingTotal: string; ar: string; channelTotals: { channel: string; amount: string; products: number }[]; productCounts: Record<string, number>; riders: { rider: string; productAmount: string; deliveryFee: string; subtotal: string; incentives: string; total: string }[]; moneyBreakdown: Record<string, number> | null; cashCount: { counted: string; expected: string; variance: string } | null; expenses: { accountTitle: string; payee: string | null; amount: string; group: string }[]; expenseTotals: { major: string; other: string; total: string; riderExpense: string; shippingExpense: { orders: string; marketing: string } }; freebies: { item: string; qty: number }[]; byPaymentAccount?: { account: string; mode: string; count: number; amount: string }[]; bankDeposit: { cash: string; expenses: string; total: string }; overallSales: string; totalProducts: number; audit?: { costOfSales: string; grossProfit: string; grossMarginPct: number } } | undefined;
  const KV = ({ rows }: { rows: [string, unknown][] }) => <div className="sticky-head"><table className="w-full text-sm"><tbody>{rows.map(([k, v]) => <tr key={k} className="border-t"><td className="py-1">{k}</td><td className="num">{typeof v === 'number' ? v : peso(v)}</td></tr>)}</tbody></table></div>;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Daily Sales Report</h1>{!me!.locationScoped && <Field label="Branch"><Select value={locationId} onChange={(e) => setLocationId(e.target.value)}><option value="">—</option>{locations.data?.filter((l) => l.isSelling).map((l) => <option key={l.id} value={l.id}>{locLabel(l)}</option>)}</Select></Field>}<Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>{can('cost.view') && <label className="flex items-center gap-1 pb-2 text-sm"><input type="checkbox" checked={audit} onChange={(e) => setAudit(e.target.checked)} /> Audit summary (margin)</label>}<Button variant="outline" disabled={!locationId} onClick={() => api.download(`/api/reports/daily-sales.xlsx?locationId=${locationId}&date=${date}`, `DailySalesReport_${date}.xlsx`)}>Review report (Excel)</Button><Button variant="outline" disabled={!locationId} onClick={() => api.download(`/api/reports/daily-sales.pdf?locationId=${locationId}&date=${date}`, `DailySalesReport_${date}.pdf`)}>Review report (PDF)</Button></div>
    {sub.data && (sub.data.submitted
      ? <div className={`rounded-xl border p-3 text-sm ${sub.data.status === 'AUTO_SUBMITTED' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>{sub.data.status === 'AUTO_SUBMITTED' ? 'Not submitted by the branch — submitted automatically at the cut-off as it stood.' : <>Submitted as true and correct by <b>{sub.data.submittedByName}</b> on {new Date(sub.data.submittedAt!).toLocaleString()}.</>} The day is closed; changes need a revision request (Daily Close → post-close edit).</div>
      : canSubmit && <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand/30 bg-brand-soft p-3 text-sm"><span className="flex-1"><b>Review every detail of today's report below</b> (or open <i>Review report</i> in Excel / PDF) and compare it with your DR/SI slips, card slips, receipts and the cash you counted. Then submit it before 8 PM (store closing). If it is not submitted by the cut-off, it is submitted as it stands and the auditors and HR are notified.</span><Button onClick={() => setConfirmOpen(true)} disabled={!r}>Submit today's report…</Button></div>)}
    {confirmOpen && <Modal title="Submit today's Daily Sales Report" onClose={() => setConfirmOpen(false)}>
      {r && <p className="mb-3 text-sm text-slate-600">{r.header.branch} · {r.header.date} · overall sales <b>{peso(r.overallSales)}</b> · cash to deposit <b>{peso(r.bankDeposit.total)}</b></p>}
      <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm" data-testid="dsr-review-list"><div className="mb-1 font-semibold text-amber-900">Before submitting, check each one:</div>
        {REVIEW_ITEMS.map((t, i) => <label key={i} className="flex items-start gap-2 py-0.5"><input type="checkbox" className="mt-0.5" checked={checked.has(i)} onChange={() => { const n = new Set(checked); n.has(i) ? n.delete(i) : n.add(i); setChecked(n); }} /><span>{t}</span></label>)}
      </div>
      <label className="flex items-start gap-2 rounded-xl border border-slate-200 p-3 text-sm"><input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>{sub.data?.acknowledgementText ?? 'I acknowledge that this Daily Sales Report is true and correct.'}</span></label>
      <p className="mt-2 text-xs text-slate-500">After submitting, today is closed for this branch. Any change afterwards follows the revision protocol (post-close edit approved by the auditors).</p>
      <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button><Button disabled={!ack || checked.size < REVIEW_ITEMS.length || submit.isPending} onClick={() => submit.mutate()}>I agree — submit</Button></div>
      <ErrorBox error={submit.error} />
    </Modal>}
    {r && <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <Card title={`Sales Breakdown (Cash) — ${r.header.branch} ${r.header.date}`}><KV rows={[['Walk-in', r.cash.walkIn], ['Delivery', r.cash.delivery], ['Franchise', r.cash.franchise], ['Prothin Dealer', r.cash.dealer], ['Agent (Cash)', r.cash.agent], ['Delivery Fee', r.cash.deliveryFee], ['Subtotal', r.cash.subtotal]]} /></Card>
        <Card title="Credit Card"><KV rows={[['Walk-in', r.creditCard.walkIn], ['Delivery', r.creditCard.delivery], ['Agent', r.creditCard.agent], ['Other', r.creditCard.other], ['Delivery / shipping fees on card', r.creditCard.deliveryFee], ['Total', r.creditCard.total], ['Card transactions', Number(r.creditCard.transactions ?? 0)], ['Products sold on card', Number(r.creditCard.products ?? 0)]]} /></Card>
        <Card title="Online & Shipping"><KV rows={[['Walk-in (Online)', r.onlineWalkIn.walkIn], ['Franchise (Online)', r.onlineWalkIn.franchise], ['Prothin Dealer (Online)', r.onlineWalkIn.dealer], ['Agent (Online)', r.onlineWalkIn.agent], ['Delivery (Online)', r.onlineDelivery.delivery], ['Delivery Fee (Online)', r.onlineDelivery.deliveryFee], ['Shipping (LBC/Lalamove)', r.shipping.courier], ['Shipping – Franchise', r.shipping.franchise], ['Shipping – Dealer', r.shipping.dealer], ['Shipping – Agent', r.shipping.agent], ['Shipping (Shopee/Lazada)', r.shipping.marketplace], ['Shipping Fee', r.shipping.shippingFee], ['Total online / CC / shipping', r.onlineCcShippingTotal], ['AR / PDC', r.ar]]} /></Card>
        <Card title="Totals by channel"><div className="sticky-head"><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Channel</th><th className="num">Amount</th><th className="num"># products</th></tr></thead><tbody>{r.channelTotals.map((c) => <tr key={c.channel} className="border-t"><td>{c.channel.replace(/_/g, ' ')}</td><td className="num">{peso(c.amount)}</td><td className="num">{c.products}</td></tr>)}<tr className="border-t"><td>Apparels</td><td /><td className="num">{r.productCounts.apparel}</td></tr><tr><td>Equipment</td><td /><td className="num">{r.productCounts.equipment}</td></tr><tr><td>Agent</td><td /><td className="num">{r.productCounts.agent}</td></tr></tbody></table></div></Card>
      </div>
      <div className="space-y-4">
        <Card title="Rider Delivery Summary"><Searchable><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Rider</th><th className="num">Product</th><th className="num">Del fee</th><th className="num">Subtotal</th><th className="num">Incentives</th><th className="num">Total</th></tr></thead><tbody>{r.riders.map((x) => <tr key={x.rider} className="border-t"><td>{x.rider}</td><td className="num">{peso(x.productAmount)}</td><td className="num">{peso(x.deliveryFee)}</td><td className="num">{peso(x.subtotal)}</td><td className="num">{peso(x.incentives)}</td><td className="num">{peso(x.total)}</td></tr>)}</tbody></table></Searchable></Card>
        <Card title="Money Breakdown"><div className="sticky-head"><table className="w-full text-sm"><tbody>{[1000, 500, 200, 100, 50, 20, 10, 5, 1].map((d) => <tr key={d} className="border-t"><td>₱{d}</td><td className="num">{r.moneyBreakdown?.[String(d)] ?? 0}</td><td className="num">{peso((r.moneyBreakdown?.[String(d)] ?? 0) * d)}</td></tr>)}{r.cashCount && <><tr className="border-t font-medium"><td colSpan={2}>Counted</td><td className="num">{peso(r.cashCount.counted)}</td></tr><tr><td colSpan={2}>Expected</td><td className="num">{peso(r.cashCount.expected)}</td></tr><tr><td colSpan={2}>Variance</td><td className="num">{peso(r.cashCount.variance)}</td></tr></>}</tbody></table></div></Card>
        <Card title="Expenses"><div className="sticky-head"><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Account</th><th className="num">Major</th><th className="num">Other</th></tr></thead><tbody>{r.expenses.map((e, i) => <tr key={i} className="border-t"><td>{e.accountTitle}{e.payee ? ` – ${e.payee}` : ''}</td><td className="num">{e.group === 'MAJOR' ? peso(e.amount) : ''}</td><td className="num">{e.group === 'OTHER' ? peso(e.amount) : ''}</td></tr>)}<tr className="border-t font-medium"><td>Total</td><td className="num">{peso(r.expenseTotals.major)}</td><td className="num">{peso(r.expenseTotals.other)}</td></tr></tbody></table></div><KV rows={[['Rider/Driver expense', r.expenseTotals.riderExpense], ['Shipping expense – Orders', r.expenseTotals.shippingExpense.orders], ['Shipping expense – Marketing', r.expenseTotals.shippingExpense.marketing]]} /></Card>
        <Card title="Replacement payments (apart from sales)">{r.replacements?.rows.length ? <Searchable><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Ticket</th><th>DR/SI</th><th>Customer</th><th>Item</th><th>How</th><th>Account</th><th className="num">Amount</th></tr></thead><tbody>{r.replacements.rows.map((x) => <tr key={x.ticketNo + x.mode + x.signed} className="border-t"><td className="py-1 pr-2">{x.ticketNo}</td><td className="pr-2">{x.drSiNo}</td><td className="pr-2">{x.customer}</td><td className="pr-2">{x.item}</td><td className="pr-2">{x.direction === 'IN' ? 'paid' : 'refunded'} · {x.mode.toLowerCase().replace('_', ' ')}</td><td className="pr-2">{x.account}</td><td className="num">{peso(x.signed)}</td></tr>)}</tbody></table></Searchable> : <Empty>No replacement payments on this day.</Empty>}
          {r.replacements && <KV rows={[['Replacement cash (joins the cash deposit)', r.replacements.cash], ['Replacement online', r.replacements.online], ['Replacement card', r.replacements.card], ['Total replacement payments', r.replacements.total]]} />}</Card>
        <Card title="Online & card payments by account">{r.byPaymentAccount?.length ? <Searchable><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Account</th><th>Type</th><th className="num">Sales</th><th className="num">Amount</th></tr></thead><tbody>{r.byPaymentAccount.map((a) => <tr key={a.account + a.mode} className="border-t"><td>{a.account}</td><td>{a.mode}</td><td className="num">{a.count}</td><td className="num">{peso(a.amount)}</td></tr>)}</tbody></table></Searchable> : <p className="text-sm text-slate-500">none</p>}</Card>
        <Card title="Freebies">{r.freebies.length ? <ul className="text-sm">{r.freebies.map((f, i) => <li key={i}>{f.qty}× {f.item}</li>)}</ul> : <p className="text-sm text-slate-500">none</p>}</Card>
        <Card title="Summary for bank deposit"><KV rows={[['Cash', r.bankDeposit.cash], ['Replacement cash', (r.bankDeposit as unknown as { replacementCash: string }).replacementCash], ['Less: cash expenses', r.bankDeposit.expenses], ['Total cash deposit', r.bankDeposit.total], ['Overall sales', r.overallSales], ['Total products', r.totalProducts]]} />{r.audit && <div className="mt-3 rounded bg-amber-50 p-2 text-sm"><div className="text-xs uppercase text-slate-500">Audit (cost.view only)</div>Cost of sales {peso(r.audit.costOfSales)} · Gross profit {peso(r.audit.grossProfit)} ({r.audit.grossMarginPct}%)</div>}</Card>
      </div>
    </div>}
    {can('sale.create') && locationId && <PostCloseEditCard locationId={locationId} date={date} isFranchise={me!.locations.find((l) => l.id === locationId)?.type === 'FRANCHISE'} />}
  </div>;
}

interface DiBuckets { receive: number; transferIn: number; returns: number; pullOut: number; sales: number; other: number; adjust: number; receiveCost?: number; transferInCost?: number; returnsCost?: number; pullOutCost?: number; salesCost?: number; otherCost?: number; adjustCost?: number }
interface DiDay extends DiBuckets { date: string; beg: number; begCost?: number; end: number; endCost?: number }
interface DiProduct extends DiBuckets { product: { id: string; sku: string; name: string; brand?: string | null }; beg: number; begCost?: number; end: number; endCost?: number; unitCost?: number; moved?: boolean; days: DiDay[] }
interface DiReport { location: { id: string; name: string }; from: string; to: string; days: string[]; products: DiProduct[]; totals: DiBuckets & { beg: number; begCost?: number; end: number; endCost?: number } }

/** Daily Inventory Report: date range + per-day view of Beg / Receive / Transfer In / Returns / Pull Out / Sales / Other / Adj / End.
 *  Cost columns come from the API only for roles with cost.view (the server strips them for everyone else), so the same screen works for all roles. */
function DailyInventoryReport({ locationId }: { locationId: string }) {
  const { can } = useAuth(); const canCost = can('cost.view');
  const [from, setFrom] = useState(today()); const [to, setTo] = useState(today()); const [day, setDay] = useState<string>('ALL'); const [hideIdle, setHideIdle] = useState(false); const [search, setSearch] = useState('');
  const q = useQuery({ queryKey: ['daily-inventory', locationId, from, to], queryFn: () => api.get<DiReport>(`/api/stock/daily-inventory?locationId=${locationId}&from=${from}&to=${to}`), enabled: !!locationId && !!from && !!to && from <= to });
  const rep = q.data;
  const rows = (rep?.products ?? []).map((p) => { const d = day === 'ALL' ? null : p.days.find((x) => x.date === day); const b: DiDay | DiProduct = d ?? p; return { key: p.product.id, sku: p.product.sku, brand: p.product.brand ?? '', name: p.product.name, beg: b.beg, receive: b.receive, transferIn: b.transferIn, returns: b.returns, pullOut: b.pullOut, sales: b.sales, other: b.other, adjust: b.adjust, end: b.end, begCost: b.begCost, transferInCost: b.transferInCost, pullOutCost: b.pullOutCost, salesCost: b.salesCost, endCost: b.endCost, moved: !!(b.receive || b.transferIn || b.returns || b.pullOut || b.sales || b.other || b.adjust) }; }).filter((r) => (!hideIdle || r.moved) && matches(search, r.sku, r.name, r.brand))
    // items with movement first, then items without (the API already orders the whole period; a single day is re-ordered here)
    .sort((a, b) => Number(b.moved) - Number(a.moved));
  const movedCount = rows.filter((r) => r.moved).length;
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((t, r) => t + Number(r[k] ?? 0), 0);
  const num = (v: unknown) => <span className="num block">{String(v ?? 0)}</span>;
  // click a figure (not Sales) to see the forms behind it (owner request 2026-10-01)
  const [docs, setDocs] = useState<{ productId?: string; item: string; bucket: string; label: string } | null>(null);
  const range = day === 'ALL' ? { from, to } : { from: day, to: day };
  const clickable = (bucket: string, label: string) => (c: { getValue: () => unknown; row: { original: { key: string; name: string } } }) => { const v = Number(c.getValue() ?? 0); return v ? <button type="button" className="num block w-full cursor-pointer text-brand underline decoration-dotted underline-offset-2 hover:font-semibold" title={`Which forms made this ${label}?`} onClick={() => setDocs({ productId: c.row.original.key, item: c.row.original.name, bucket, label })}>{v}</button> : num(v); };
  const money = (v: unknown) => <span className="num block">{peso(v)}</span>;
  type Row = (typeof rows)[number];
  const columns: ColumnDef<Row, unknown>[] = [
    { header: 'SKU', accessorKey: 'sku' }, { header: 'Item', accessorKey: 'name', cell: (c) => <span className={c.row.original.moved ? '' : 'text-slate-500'}>{String(c.getValue())}</span> },
    { header: 'Movement', accessorKey: 'moved', cell: (c) => (c.getValue() ? <Badge tone="green">moved</Badge> : <span className="text-xs text-slate-400">none</span>) },
    { header: 'Beg', accessorKey: 'beg', cell: (c) => num(c.getValue()) }, { header: 'Receive', accessorKey: 'receive', cell: clickable('receive', 'receiving') },
    { header: 'Transfer In', accessorKey: 'transferIn', cell: clickable('transferIn', 'transfer in') }, { header: 'Returns', accessorKey: 'returns', cell: clickable('returns', 'return') },
    { header: 'Pull Out', accessorKey: 'pullOut', cell: clickable('pullOut', 'pull-out') }, { header: 'Sales', accessorKey: 'sales', cell: (c) => num(c.getValue()) },
    { header: 'Other Out', accessorKey: 'other', cell: clickable('other', 'movement') }, { header: 'Adj', accessorKey: 'adjust', cell: clickable('adjust', 'adjustment') },
    { header: 'End', accessorKey: 'end', cell: (c) => <span className="num block font-semibold">{String(c.getValue())}</span> },
    ...(canCost ? [
      { header: 'Transfer In Cost', accessorKey: 'transferInCost', cell: (c) => money(c.getValue()) }, { header: 'Pull Out Cost', accessorKey: 'pullOutCost', cell: (c) => money(c.getValue()) },
      { header: 'Cost of Sales', accessorKey: 'salesCost', cell: (c) => money(c.getValue()) }, { header: 'End Value', accessorKey: 'endCost', cell: (c) => money(c.getValue()) },
    ] as ColumnDef<Row, unknown>[] : []),
  ];
  const footer = <tr><td className="px-3 py-2" colSpan={3}>TOTAL ({rows.length} items)</td>{(['beg', 'receive', 'transferIn', 'returns', 'pullOut', 'sales', 'other', 'adjust', 'end'] as const).map((k) => <td key={k} className="num px-3 py-2">{sum(k)}</td>)}{canCost && (['transferInCost', 'pullOutCost', 'salesCost', 'endCost'] as const).map((k) => <td key={k} className="num px-3 py-2">{peso(sum(k))}</td>)}</tr>;
  return <Card title={<span>Daily Inventory Report {canCost && <Badge tone="amber">with costing</Badge>}</span>}>
    <div className="mb-3 flex flex-wrap items-end gap-2">
      <Field label="From"><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setDay('ALL'); }} /></Field>
      <Field label="To"><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setDay('ALL'); }} /></Field>
      <Field label="Show"><Select value={day} onChange={(e) => setDay(e.target.value)}><option value="ALL">Whole period ({rep?.days.length ?? 0} days)</option>{rep?.days.map((d) => <option key={d} value={d}>{d}</option>)}</Select></Field>
      <Field label="Search item"><ItemSearch value={search} onChange={setSearch} /></Field>
      <label className="flex items-center gap-1 pb-2.5 text-xs"><input type="checkbox" checked={hideIdle} onChange={(e) => setHideIdle(e.target.checked)} /> only items that moved</label>
      <div className="ml-auto flex gap-2">
        <Button variant="outline" disabled={!locationId || from > to} onClick={() => api.download(`/api/reports/daily-inventory.xlsx?locationId=${locationId}&from=${from}&to=${to}`, `DailyInventory_${from}_${to}.xlsx`)}>Generate xlsx{canCost ? ' (with costing)' : ''}</Button>
      </div>
    </div>
    {from > to && <p className="text-sm text-red-700">"From" must be on or before "To".</p>}
    {q.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
    {q.error ? <p className="text-sm text-red-700">{(q.error as Error).message}</p> : null}
    {rep && <>
      <p className="mb-2 text-xs text-slate-500"><b>{movedCount} with movement listed first</b>, then {rows.length - movedCount} without. {rep.location.name} · {day === 'ALL' ? `${rep.from} to ${rep.to}` : day} · Receive = supplier receiving, Transfer In = stock received from warehouse/branches, Pull Out = stock sent out, Other Out = freebies/tasting, Adj = count adjustments & write-offs.{canCost ? ' Values at batch cost.' : ''}</p>
      <DataTable data={rows} columns={columns} footer={footer} />
    </>}
    {docs && <MovementDocs locationId={locationId} from={range.from} to={range.to} {...docs} onClose={() => setDocs(null)} />}
  </Card>;
}

/** Case-insensitive match of every typed word against SKU, name, brand or batch. */
function matches(q: string, ...fields: (string | null | undefined)[]) {
  const hay = fields.filter(Boolean).join(' ').toLowerCase();
  return q.trim().toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

/** Search box with a Search button (Enter also searches) and a clear button. */
function ItemSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); onChange(draft); }}>
    <Input type="search" placeholder="SKU, name or brand" value={draft} onChange={(e) => { setDraft(e.target.value); if (!e.target.value) onChange(''); }} className="w-56" />
    <Button type="submit" variant="outline">Search</Button>
    {value && <Button type="button" variant="ghost" onClick={() => { setDraft(''); onChange(''); }}>Clear</Button>}
  </form>;
}

export function InventoryReportsPage() {
  const { me } = useAuth();
  const [locationId, setLocationId] = useState(me!.locations[0]?.id ?? ''); const [ym, setYm] = useState(today().slice(0, 7));
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/locations') });
  useEffect(() => { if (!locationId && locations.data?.length) setLocationId(locations.data.find((l) => l.name === 'Warehouse')?.id ?? locations.data[0].id); }, [locationId, locations.data]);
  const [y, m] = ym.split('-').map(Number);
  const dm = useQuery({ queryKey: ['daily-movement', locationId, ym], queryFn: () => api.get<{ product: { sku: string; name: string }; beg: number; end: number; days: { day: number; inP: number; inT: number; outP: number; outS: number; bal: number; act: number | null; var: number | null; loss: number; end: number }[] }[]>(`/api/stock/daily-movement/${locationId}?year=${y}&month=${m}`), enabled: !!locationId });
  const [search, setSearch] = useState('');
  const ledger = useQuery({ queryKey: ['ledger', locationId], queryFn: () => api.get<{ postedAt: string; movementType: string; qtyDelta: number; documentType: string; documentId: string; documentLabel: string; documentNo: string | null; documentLink: string | null; product: { name: string }; batch: { batchNo: string | null } }[]>(`/api/stock/ledger?locationId=${locationId}`), enabled: !!locationId });
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Inventory Reports</h1><Field label="Search item (movement sheet and ledger)"><ItemSearch value={search} onChange={setSearch} /></Field><Field label="Location"><Select value={locationId} onChange={(e) => setLocationId(e.target.value)}><option value="">—</option>{locations.data?.filter((l) => !me!.locationScoped || me!.locations.some((x) => x.id === l.id)).map((l) => <option key={l.id} value={l.id}>{locLabel(l)}</option>)}</Select></Field></div>
    {!locationId && <p className="text-sm text-slate-500">Pick a location to generate reports.</p>}
    {locationId && <DailyInventoryReport locationId={locationId} />}
    <Card title="Monthly movement sheet (DAILY INVTY COUNT layout)">
      <div className="mb-3 flex flex-wrap items-end gap-2"><Field label="Month"><Input type="month" value={ym} onChange={(e) => setYm(e.target.value)} /></Field><Button variant="outline" disabled={!locationId} onClick={() => api.download(`/api/reports/daily-movement.xlsx?locationId=${locationId}&year=${y}&month=${m}`, `DailyInventoryMovement_${ym}.xlsx`)}>Monthly movement xlsx (Beg / IN-P / IN-T / OUT-P / OUT-S / Bal / Act / Var / Loss / End)</Button><Button variant="outline" onClick={() => api.download(`/api/reports/stock-on-hand.xlsx${locationId ? `?locationId=${locationId}` : ''}`, 'StockOnHand.xlsx')}>Stock on hand xlsx</Button></div>
      <div className="overflow-auto"><Searchable><table className="text-xs"><thead><tr><th className="px-2 text-left">Item</th><th className="px-2">Beg</th><th className="px-2">IN-P</th><th className="px-2">IN-T</th><th className="px-2">OUT-P</th><th className="px-2">OUT-S</th><th className="px-2">Loss</th><th className="px-2">End</th></tr></thead><tbody>{dm.data?.filter((p) => matches(search, p.product.sku, p.product.name)).map((p) => { const s = (k: 'inP' | 'inT' | 'outP' | 'outS' | 'loss') => p.days.reduce((t, d) => t + d[k], 0); return <tr key={p.product.sku} className="border-t"><td className="px-2 py-1">{p.product.name}</td><td className="num px-2">{p.beg}</td><td className="num px-2">{s('inP')}</td><td className="num px-2">{s('inT')}</td><td className="num px-2">{s('outP')}</td><td className="num px-2">{s('outS')}</td><td className="num px-2">{s('loss')}</td><td className="num px-2 font-medium">{p.end}</td></tr>; })}</tbody></table></Searchable></div>
    </Card>
    <Card title="Stock ledger (latest movements) — click a document to open it"><div><Searchable><table className="w-full text-xs [&_td]:py-1.5"><thead className="sticky top-0 bg-slate-50 text-left"><tr><th>When</th><th>Type</th><th>Product</th><th>Batch</th><th className="num">Qty</th><th>Document</th></tr></thead><tbody>{ledger.data?.filter((l) => matches(search, l.product.name, l.batch.batchNo)).map((l, i) => <tr key={i} className="border-t"><td>{new Date(l.postedAt).toLocaleString()}</td><td>{l.movementType}</td><td>{l.product.name}</td><td>{l.batch.batchNo}</td><td className={`num ${l.qtyDelta < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{l.qtyDelta}</td><td>{l.documentLink ? <Link className="text-brand underline" to={l.documentLink} title="Open the document">{l.documentLabel} {l.documentNo ?? ''}</Link> : <span>{l.documentLabel} {l.documentNo ?? ''}</span>}</td></tr>)}</tbody></table></Searchable></div></Card>
  </div>;
}


interface MoveDoc { documentType: string; documentId: string; label: string; number: string | null; link: string | null; qty: number; date: string; items: { name: string; qty: number }[]; from: string | null; to: string | null; status: string | null; note: string | null; forms: { label: string; number: string; pdf: string }[]; attachments: { id: string; name: string; contentType: string }[] }

/** The forms behind a figure of the Daily Inventory Report: pull-out / transfer-in / supplier / count forms to open or print, with their attachments. */
function MovementDocs({ locationId, productId, item, bucket, label, from, to, onClose }: { locationId: string; productId?: string; item: string; bucket: string; label: string; from: string; to: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['movement-docs', locationId, productId, bucket, from, to], queryFn: () => api.get<MoveDoc[]>(`/api/stock/movement-documents?locationId=${locationId}${productId ? `&productId=${productId}` : ''}&from=${from}&to=${to}&bucket=${bucket}`) });
  return <Modal wide title={`Supporting forms: ${label} of ${item}`} onClose={onClose}>
    <p className="mb-2 text-xs text-slate-500">{from === to ? from : `${from} to ${to}`}. Press a form to open or print it.</p>
    {q.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
    {q.error ? <p className="text-sm text-red-700">{(q.error as Error).message}</p> : null}
    {q.data && !q.data.length && <p className="text-sm text-slate-500">No form found for this figure.</p>}
    <div className="max-h-[65vh] space-y-3 overflow-y-auto" data-testid="movement-docs">{q.data?.map((d) => <div key={d.documentType + d.documentId} className="rounded-xl border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2"><b>{d.label}</b>{d.number && <span className="font-mono text-xs">{d.number}</span>}{d.status && <Badge tone={statusTone(d.status)}>{d.status}</Badge>}<span className="ml-auto text-xs text-slate-500">{d.date} · qty {d.qty}</span></div>
      {(d.from || d.to) && <div className="text-xs text-slate-600">{d.from ?? ''}{d.to ? ` → ${d.to}` : ''}</div>}
      <div className="mt-1 text-xs text-slate-600">{d.items.map((i) => `${i.name} × ${i.qty}`).join(' · ')}</div>
      {d.note && <div className="text-xs text-slate-500">{d.note}</div>}
      <div className="mt-2 flex flex-wrap gap-2">{d.forms.map((f) => <Button key={f.label} size="sm" variant="outline" onClick={() => api.download(f.pdf, `${f.number}.pdf`)}>{f.label} {f.number}</Button>)}
        {d.link && <Link className="self-center text-xs font-semibold text-brand underline" to={d.link} onClick={onClose}>Open the document</Link>}
        {d.attachments.map((a) => <Button key={a.id} size="sm" variant="ghost" onClick={() => api.download(`/api/attachments/file/${a.id}`, a.name)}>📎 {a.name}</Button>)}</div>
    </div>)}</div>
  </Modal>;
}
