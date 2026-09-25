import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Field, Input, Select } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';
import type { ColumnDef } from '@tanstack/react-table';

/** §8.5 Daily Branch Sales Report — on-screen FRONT view + xlsx/PDF exports in the sample layout. */
export function DailySalesReportPage() {
  const { me, can } = useAuth();
  const [locationId, setLocationId] = useState(me!.locations[0]?.id ?? ''); const [date, setDate] = useState(today()); const [audit, setAudit] = useState(false);
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; isSelling: boolean }[]>('/api/locations'), enabled: !me!.locationScoped });
  const q = useQuery({ queryKey: ['dsr', locationId, date, audit], queryFn: () => api.get<Record<string, never>>(`/api/reports/daily-sales?locationId=${locationId}&date=${date}${audit ? '&audit=1' : ''}`), enabled: !!locationId });
  const r = q.data as unknown as { header: { branch: string; date: string }; cash: Record<string, string>; creditCard: Record<string, string>; onlineWalkIn: Record<string, string>; onlineDelivery: Record<string, string>; shipping: Record<string, string>; onlineCcShippingTotal: string; ar: string; channelTotals: { channel: string; amount: string; products: number }[]; productCounts: Record<string, number>; riders: { rider: string; productAmount: string; deliveryFee: string; subtotal: string; incentives: string; total: string }[]; moneyBreakdown: Record<string, number> | null; cashCount: { counted: string; expected: string; variance: string } | null; expenses: { accountTitle: string; payee: string | null; amount: string; group: string }[]; expenseTotals: { major: string; other: string; total: string; riderExpense: string; shippingExpense: { orders: string; marketing: string } }; freebies: { item: string; qty: number }[]; bankDeposit: { cash: string; expenses: string; total: string }; overallSales: string; totalProducts: number; audit?: { costOfSales: string; grossProfit: string; grossMarginPct: number } } | undefined;
  const KV = ({ rows }: { rows: [string, unknown][] }) => <table className="w-full text-sm"><tbody>{rows.map(([k, v]) => <tr key={k} className="border-t"><td className="py-1">{k}</td><td className="num">{typeof v === 'number' ? v : peso(v)}</td></tr>)}</tbody></table>;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-xl font-semibold">Daily Branch Sales Report</h1>{!me!.locationScoped && <Field label="Branch"><Select value={locationId} onChange={(e) => setLocationId(e.target.value)}><option value="">—</option>{locations.data?.filter((l) => l.isSelling).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>}<Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>{can('cost.view') && <label className="flex items-center gap-1 pb-2 text-sm"><input type="checkbox" checked={audit} onChange={(e) => setAudit(e.target.checked)} /> Audit summary (margin)</label>}<Button variant="outline" disabled={!locationId} onClick={() => api.download(`/api/reports/daily-sales.xlsx?locationId=${locationId}&date=${date}`, `DailySalesReport_${date}.xlsx`)}>Export xlsx</Button><Button variant="outline" disabled={!locationId} onClick={() => api.download(`/api/reports/daily-sales.pdf?locationId=${locationId}&date=${date}`, `DailySalesReport_${date}.pdf`)}>PDF</Button></div>
    {r && <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <Card title={`Sales Breakdown (Cash) — ${r.header.branch} ${r.header.date}`}><KV rows={[['Walk-in', r.cash.walkIn], ['Delivery', r.cash.delivery], ['Franchise', r.cash.franchise], ['Prothin Dealer', r.cash.dealer], ['Agent (Cash)', r.cash.agent], ['Delivery Fee', r.cash.deliveryFee], ['Subtotal', r.cash.subtotal]]} /></Card>
        <Card title="Credit Card"><KV rows={[['Walk-in', r.creditCard.walkIn], ['Delivery', r.creditCard.delivery], ['Agent', r.creditCard.agent], ['Total', r.creditCard.total]]} /></Card>
        <Card title="Online & Shipping"><KV rows={[['Walk-in (Online)', r.onlineWalkIn.walkIn], ['Franchise (Online)', r.onlineWalkIn.franchise], ['Prothin Dealer (Online)', r.onlineWalkIn.dealer], ['Agent (Online)', r.onlineWalkIn.agent], ['Delivery (Online)', r.onlineDelivery.delivery], ['Delivery Fee (Online)', r.onlineDelivery.deliveryFee], ['Shipping (LBC/Lalamove)', r.shipping.courier], ['Shipping – Franchise', r.shipping.franchise], ['Shipping – Dealer', r.shipping.dealer], ['Shipping – Agent', r.shipping.agent], ['Shipping (Shopee/Lazada)', r.shipping.marketplace], ['Shipping Fee', r.shipping.shippingFee], ['Total online / CC / shipping', r.onlineCcShippingTotal], ['AR / PDC', r.ar]]} /></Card>
        <Card title="Totals by channel"><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Channel</th><th className="num">Amount</th><th className="num"># products</th></tr></thead><tbody>{r.channelTotals.map((c) => <tr key={c.channel} className="border-t"><td>{c.channel.replace(/_/g, ' ')}</td><td className="num">{peso(c.amount)}</td><td className="num">{c.products}</td></tr>)}<tr className="border-t"><td>Apparels</td><td /><td className="num">{r.productCounts.apparel}</td></tr><tr><td>Equipment</td><td /><td className="num">{r.productCounts.equipment}</td></tr><tr><td>Agent</td><td /><td className="num">{r.productCounts.agent}</td></tr></tbody></table></Card>
      </div>
      <div className="space-y-4">
        <Card title="Rider Delivery Summary"><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Rider</th><th className="num">Product</th><th className="num">Del fee</th><th className="num">Subtotal</th><th className="num">Incentives</th><th className="num">Total</th></tr></thead><tbody>{r.riders.map((x) => <tr key={x.rider} className="border-t"><td>{x.rider}</td><td className="num">{peso(x.productAmount)}</td><td className="num">{peso(x.deliveryFee)}</td><td className="num">{peso(x.subtotal)}</td><td className="num">{peso(x.incentives)}</td><td className="num">{peso(x.total)}</td></tr>)}</tbody></table></Card>
        <Card title="Money Breakdown"><table className="w-full text-sm"><tbody>{[1000, 500, 200, 100, 50, 20, 10, 5, 1].map((d) => <tr key={d} className="border-t"><td>₱{d}</td><td className="num">{r.moneyBreakdown?.[String(d)] ?? 0}</td><td className="num">{peso((r.moneyBreakdown?.[String(d)] ?? 0) * d)}</td></tr>)}{r.cashCount && <><tr className="border-t font-medium"><td colSpan={2}>Counted</td><td className="num">{peso(r.cashCount.counted)}</td></tr><tr><td colSpan={2}>Expected</td><td className="num">{peso(r.cashCount.expected)}</td></tr><tr><td colSpan={2}>Variance</td><td className="num">{peso(r.cashCount.variance)}</td></tr></>}</tbody></table></Card>
        <Card title="Expenses"><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Account</th><th className="num">Major</th><th className="num">Other</th></tr></thead><tbody>{r.expenses.map((e, i) => <tr key={i} className="border-t"><td>{e.accountTitle}{e.payee ? ` – ${e.payee}` : ''}</td><td className="num">{e.group === 'MAJOR' ? peso(e.amount) : ''}</td><td className="num">{e.group === 'OTHER' ? peso(e.amount) : ''}</td></tr>)}<tr className="border-t font-medium"><td>Total</td><td className="num">{peso(r.expenseTotals.major)}</td><td className="num">{peso(r.expenseTotals.other)}</td></tr></tbody></table><KV rows={[['Rider/Driver expense', r.expenseTotals.riderExpense], ['Shipping expense – Orders', r.expenseTotals.shippingExpense.orders], ['Shipping expense – Marketing', r.expenseTotals.shippingExpense.marketing]]} /></Card>
        <Card title="Freebies">{r.freebies.length ? <ul className="text-sm">{r.freebies.map((f, i) => <li key={i}>{f.qty}× {f.item}</li>)}</ul> : <p className="text-sm text-slate-500">none</p>}</Card>
        <Card title="Summary for bank deposit"><KV rows={[['Cash', r.bankDeposit.cash], ['Less: cash expenses', r.bankDeposit.expenses], ['Total cash deposit', r.bankDeposit.total], ['Overall sales', r.overallSales], ['Total products', r.totalProducts]]} />{r.audit && <div className="mt-3 rounded bg-amber-50 p-2 text-sm"><div className="text-xs uppercase text-slate-500">Audit (cost.view only)</div>Cost of sales {peso(r.audit.costOfSales)} · Gross profit {peso(r.audit.grossProfit)} ({r.audit.grossMarginPct}%)</div>}</Card>
      </div>
    </div>}
  </div>;
}

interface DiBuckets { receive: number; transferIn: number; returns: number; pullOut: number; sales: number; other: number; adjust: number; receiveCost?: number; transferInCost?: number; returnsCost?: number; pullOutCost?: number; salesCost?: number; otherCost?: number; adjustCost?: number }
interface DiDay extends DiBuckets { date: string; beg: number; begCost?: number; end: number; endCost?: number }
interface DiProduct extends DiBuckets { product: { id: string; sku: string; name: string; brand?: string | null }; beg: number; begCost?: number; end: number; endCost?: number; unitCost?: number; days: DiDay[] }
interface DiReport { location: { id: string; name: string }; from: string; to: string; days: string[]; products: DiProduct[]; totals: DiBuckets & { beg: number; begCost?: number; end: number; endCost?: number } }

/** Daily Inventory Report: date range + per-day view of Beg / Receive / Transfer In / Returns / Pull Out / Sales / Other / Adj / End.
 *  Cost columns come from the API only for roles with cost.view (the server strips them for everyone else), so the same screen works for all roles. */
function DailyInventoryReport({ locationId }: { locationId: string }) {
  const { can } = useAuth(); const canCost = can('cost.view');
  const [from, setFrom] = useState(today()); const [to, setTo] = useState(today()); const [day, setDay] = useState<string>('ALL'); const [hideIdle, setHideIdle] = useState(true);
  const q = useQuery({ queryKey: ['daily-inventory', locationId, from, to], queryFn: () => api.get<DiReport>(`/api/stock/daily-inventory?locationId=${locationId}&from=${from}&to=${to}`), enabled: !!locationId && !!from && !!to && from <= to });
  const rep = q.data;
  const rows = (rep?.products ?? []).map((p) => { const d = day === 'ALL' ? null : p.days.find((x) => x.date === day); const b: DiDay | DiProduct = d ?? p; return { key: p.product.id, sku: p.product.sku, brand: p.product.brand ?? '', name: p.product.name, beg: b.beg, receive: b.receive, transferIn: b.transferIn, returns: b.returns, pullOut: b.pullOut, sales: b.sales, other: b.other, adjust: b.adjust, end: b.end, begCost: b.begCost, transferInCost: b.transferInCost, pullOutCost: b.pullOutCost, salesCost: b.salesCost, endCost: b.endCost, moved: !!(b.receive || b.transferIn || b.returns || b.pullOut || b.sales || b.other || b.adjust) }; }).filter((r) => !hideIdle || r.moved || day === 'ALL');
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((t, r) => t + Number(r[k] ?? 0), 0);
  const num = (v: unknown) => <span className="num block">{String(v ?? 0)}</span>;
  const money = (v: unknown) => <span className="num block">{peso(v)}</span>;
  type Row = (typeof rows)[number];
  const columns: ColumnDef<Row, unknown>[] = [
    { header: 'SKU', accessorKey: 'sku' }, { header: 'Item', accessorKey: 'name' },
    { header: 'Beg', accessorKey: 'beg', cell: (c) => num(c.getValue()) }, { header: 'Receive', accessorKey: 'receive', cell: (c) => num(c.getValue()) },
    { header: 'Transfer In', accessorKey: 'transferIn', cell: (c) => num(c.getValue()) }, { header: 'Returns', accessorKey: 'returns', cell: (c) => num(c.getValue()) },
    { header: 'Pull Out', accessorKey: 'pullOut', cell: (c) => num(c.getValue()) }, { header: 'Sales', accessorKey: 'sales', cell: (c) => num(c.getValue()) },
    { header: 'Other Out', accessorKey: 'other', cell: (c) => num(c.getValue()) }, { header: 'Adj', accessorKey: 'adjust', cell: (c) => num(c.getValue()) },
    { header: 'End', accessorKey: 'end', cell: (c) => <span className="num block font-semibold">{String(c.getValue())}</span> },
    ...(canCost ? [
      { header: 'Transfer In Cost', accessorKey: 'transferInCost', cell: (c) => money(c.getValue()) }, { header: 'Pull Out Cost', accessorKey: 'pullOutCost', cell: (c) => money(c.getValue()) },
      { header: 'Cost of Sales', accessorKey: 'salesCost', cell: (c) => money(c.getValue()) }, { header: 'End Value', accessorKey: 'endCost', cell: (c) => money(c.getValue()) },
    ] as ColumnDef<Row, unknown>[] : []),
  ];
  const footer = <tr><td className="px-3 py-2" colSpan={2}>TOTAL ({rows.length} items)</td>{(['beg', 'receive', 'transferIn', 'returns', 'pullOut', 'sales', 'other', 'adjust', 'end'] as const).map((k) => <td key={k} className="num px-3 py-2">{sum(k)}</td>)}{canCost && (['transferInCost', 'pullOutCost', 'salesCost', 'endCost'] as const).map((k) => <td key={k} className="num px-3 py-2">{peso(sum(k))}</td>)}</tr>;
  return <Card title={<span>Daily Inventory Report {canCost && <Badge tone="amber">with costing</Badge>}</span>}>
    <div className="mb-3 flex flex-wrap items-end gap-2">
      <Field label="From"><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setDay('ALL'); }} /></Field>
      <Field label="To"><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setDay('ALL'); }} /></Field>
      <Field label="Show"><Select value={day} onChange={(e) => setDay(e.target.value)}><option value="ALL">Whole period ({rep?.days.length ?? 0} days)</option>{rep?.days.map((d) => <option key={d} value={d}>{d}</option>)}</Select></Field>
      {day !== 'ALL' && <label className="flex items-center gap-1 pb-2 text-xs"><input type="checkbox" checked={hideIdle} onChange={(e) => setHideIdle(e.target.checked)} /> only items that moved</label>}
      <div className="ml-auto flex gap-2">
        <Button variant="outline" disabled={!locationId || from > to} onClick={() => api.download(`/api/reports/daily-inventory.xlsx?locationId=${locationId}&from=${from}&to=${to}`, `DailyInventory_${from}_${to}.xlsx`)}>Generate xlsx{canCost ? ' (with costing)' : ''}</Button>
      </div>
    </div>
    {from > to && <p className="text-sm text-red-700">"From" must be on or before "To".</p>}
    {q.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
    {q.error ? <p className="text-sm text-red-700">{(q.error as Error).message}</p> : null}
    {rep && <>
      <p className="mb-2 text-xs text-slate-500">{rep.location.name} · {day === 'ALL' ? `${rep.from} to ${rep.to}` : day} · Receive = supplier receiving, Transfer In = stock received from warehouse/branches, Pull Out = stock sent out, Other Out = freebies/tasting, Adj = count adjustments & write-offs.{canCost ? ' Values at batch cost.' : ''}</p>
      <DataTable data={rows} columns={columns} footer={footer} />
    </>}
  </Card>;
}

export function InventoryReportsPage() {
  const { me } = useAuth();
  const [locationId, setLocationId] = useState(me!.locations[0]?.id ?? ''); const [ym, setYm] = useState(today().slice(0, 7));
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/locations') });
  useEffect(() => { if (!locationId && locations.data?.length) setLocationId(locations.data.find((l) => l.name === 'Warehouse')?.id ?? locations.data[0].id); }, [locationId, locations.data]);
  const [y, m] = ym.split('-').map(Number);
  const dm = useQuery({ queryKey: ['daily-movement', locationId, ym], queryFn: () => api.get<{ product: { sku: string; name: string }; beg: number; end: number; days: { day: number; inP: number; inT: number; outP: number; outS: number; bal: number; act: number | null; var: number | null; loss: number; end: number }[] }[]>(`/api/stock/daily-movement/${locationId}?year=${y}&month=${m}`), enabled: !!locationId });
  const ledger = useQuery({ queryKey: ['ledger', locationId], queryFn: () => api.get<{ postedAt: string; movementType: string; qtyDelta: number; documentType: string; documentId: string; product: { name: string }; batch: { batchNo: string | null } }[]>(`/api/stock/ledger?locationId=${locationId}`), enabled: !!locationId });
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-xl font-semibold">Inventory reports</h1><Field label="Location"><Select value={locationId} onChange={(e) => setLocationId(e.target.value)}><option value="">—</option>{locations.data?.filter((l) => !me!.locationScoped || me!.locations.some((x) => x.id === l.id)).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field></div>
    {!locationId && <p className="text-sm text-slate-500">Pick a location to generate reports.</p>}
    {locationId && <DailyInventoryReport locationId={locationId} />}
    <Card title="Monthly movement sheet (DAILY INVTY COUNT layout)">
      <div className="mb-3 flex flex-wrap items-end gap-2"><Field label="Month"><Input type="month" value={ym} onChange={(e) => setYm(e.target.value)} /></Field><Button variant="outline" disabled={!locationId} onClick={() => api.download(`/api/reports/daily-movement.xlsx?locationId=${locationId}&year=${y}&month=${m}`, `DailyInventoryMovement_${ym}.xlsx`)}>Monthly movement xlsx (Beg / IN-P / IN-T / OUT-P / OUT-S / Bal / Act / Var / Loss / End)</Button><Button variant="outline" onClick={() => api.download(`/api/reports/stock-on-hand.xlsx${locationId ? `?locationId=${locationId}` : ''}`, 'StockOnHand.xlsx')}>Stock on hand xlsx</Button></div>
      <div className="overflow-auto"><table className="text-xs"><thead><tr><th className="px-2 text-left">Item</th><th className="px-2">Beg</th><th className="px-2">IN-P</th><th className="px-2">IN-T</th><th className="px-2">OUT-P</th><th className="px-2">OUT-S</th><th className="px-2">Loss</th><th className="px-2">End</th></tr></thead><tbody>{dm.data?.map((p) => { const s = (k: 'inP' | 'inT' | 'outP' | 'outS' | 'loss') => p.days.reduce((t, d) => t + d[k], 0); return <tr key={p.product.sku} className="border-t"><td className="px-2 py-1">{p.product.name}</td><td className="num px-2">{p.beg}</td><td className="num px-2">{s('inP')}</td><td className="num px-2">{s('inT')}</td><td className="num px-2">{s('outP')}</td><td className="num px-2">{s('outS')}</td><td className="num px-2">{s('loss')}</td><td className="num px-2 font-medium">{p.end}</td></tr>; })}</tbody></table></div>
    </Card>
    <Card title="Stock ledger (latest movements)"><div className="max-h-96 overflow-auto"><table className="w-full text-xs"><thead className="sticky top-0 bg-slate-50 text-left"><tr><th>When</th><th>Type</th><th>Product</th><th>Batch</th><th className="num">Qty</th><th>Document</th></tr></thead><tbody>{ledger.data?.map((l, i) => <tr key={i} className="border-t"><td>{new Date(l.postedAt).toLocaleString()}</td><td>{l.movementType}</td><td>{l.product.name}</td><td>{l.batch.batchNo}</td><td className={`num ${l.qtyDelta < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{l.qtyDelta}</td><td>{l.documentType} {l.documentId.slice(0, 8)}</td></tr>)}</tbody></table></div></Card>
  </div>;
}
