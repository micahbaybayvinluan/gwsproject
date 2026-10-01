import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fmtDate, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Select, Stat } from '@/components/ui/primitives';

type P = 'TIKTOK' | 'SHOPEE' | 'LAZADA';
const PLATFORMS: { key: P; name: string; color: string; seller: string }[] = [
  { key: 'TIKTOK', name: 'TikTok Shop', color: '#0b1f3a', seller: 'TikTok Seller Center' },
  { key: 'SHOPEE', name: 'Shopee', color: '#eb6834', seller: 'Shopee Seller Centre' },
  { key: 'LAZADA', name: 'Lazada', color: '#4a3aa7', seller: 'Lazada Seller Center' },
];
const slug = (p: P) => p.toLowerCase();
const ORDER_STATUS: Record<string, { label: string; tone: 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'purple' }> = {
  PENDING: { label: 'Waiting for the Warehouse', tone: 'amber' }, SHIPPED: { label: 'Shipped, not yet paid', tone: 'blue' }, SETTLED: { label: 'Paid', tone: 'green' },
  RETURNED: { label: 'Returned', tone: 'purple' }, CANCELLED: { label: 'Cancelled', tone: 'slate' }, REJECTED: { label: 'Pull-out not approved', tone: 'red' },
};
const KIND: Record<string, string> = { SALE: 'Sale (items leave the holding place)', MONEY_ONLY: 'Refund / fee on an earlier order', NOT_SHIPPED: 'Not shipped yet — skipped', ALREADY_SETTLED: 'Already paid — skipped', UNKNOWN: 'Not in GWS-ERP' };
const STATUS_TONE = (s: string) => (/POSTED|RECEIVED/.test(s) ? 'green' : /SUBMITTED|PENDING|DRAFT/.test(s) ? 'amber' : /REJECTED|VOIDED/.test(s) ? 'red' : 'slate') as 'green' | 'amber' | 'red' | 'slate';

interface Overview { platforms: { platform: P; name: string; pendingPullOut: number; awaitingPayment: number; overdue: number; returnsWaiting: number; settlementsOpen: number; lastSettlement: { controlNo: string; payout: string; postedAt: string } | null }[]; overdueDays: number; warehouses: { id: string; code: string; name: string }[] }

/** E-commerce: one tab per platform (TikTok, Shopee, Lazada kept separate) and a report comparing them. */
export function EcommercePage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const manage = can('ecom.manage'); const view = manage || can('ecom.view'); const receive = can('ecom.receive');
  const overview = useQuery({ queryKey: ['ecom-overview'], queryFn: () => api.get<Overview>('/api/ecommerce/overview') });
  // opened from Approvals: go straight to that payout
  const payoutId = params.get('payout');
  const payout = useQuery({ queryKey: ['ecom-settlement', payoutId], queryFn: () => api.get<{ platform: P }>(`/api/ecommerce/settlements/${payoutId}`), enabled: !!payoutId && view });
  const tab = (params.get('p') ?? payout.data?.platform ?? (view ? 'TIKTOK' : 'RETURNS')) as P | 'REPORT' | 'RETURNS';
  const setTab = (t: string) => setParams({ p: t });
  const tabs: [string, string][] = [...(view ? PLATFORMS.map((x) => [x.key, x.name] as [string, string]) : []), ...(view ? [['REPORT', 'All platforms: profit report'] as [string, string]] : []), ...(receive ? [['RETURNS', 'Returned parcels to receive'] as [string, string]] : [])];
  return <div className="space-y-4">
    <h1 className="text-2xl font-bold tracking-tight text-navy">E-commerce</h1>
    {view && <div className="grid gap-3 md:grid-cols-3">{overview.data?.platforms.map((o) => {
      const pf = PLATFORMS.find((x) => x.key === o.platform)!;
      return <button key={o.platform} onClick={() => setTab(o.platform)} className={`rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:shadow ${tab === o.platform ? 'ring-2 ring-brand' : ''}`}>
        <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: pf.color }} /><span className="font-semibold text-navy">{o.name}</span>{o.overdue > 0 && <Badge tone="red">{o.overdue} overdue</Badge>}</div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-600">
          <div><div className="text-lg font-bold text-navy">{o.pendingPullOut}</div>waiting for the Warehouse</div>
          <div><div className="text-lg font-bold text-navy">{o.awaitingPayment}</div>shipped, not yet paid</div>
          <div><div className="text-lg font-bold text-navy">{o.returnsWaiting}</div>returns to receive</div>
        </div>
        {o.lastSettlement && <div className="mt-2 text-xs text-slate-500">Last payout {o.lastSettlement.controlNo}: {peso(o.lastSettlement.payout)}</div>}
      </button>;
    })}</div>}
    <div className="inline-flex flex-wrap rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">{tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold ${tab === k ? 'bg-navy text-white shadow' : 'text-slate-600 hover:text-navy'}`}>{l}</button>)}</div>
    {tab === 'REPORT' && view && <ReportTab />}
    {tab === 'RETURNS' && receive && <ReceiveReturns />}
    {PLATFORMS.some((x) => x.key === tab) && view && <PlatformTab key={`${tab}${payoutId ?? ''}`} p={tab as P} openPayout={payout.data?.platform === tab ? payoutId : null} manage={manage} warehouses={overview.data?.warehouses ?? []} overdueDays={overview.data?.overdueDays ?? 30} />}
  </div>;
}

function PlatformTab({ p, manage, warehouses, overdueDays, openPayout }: { p: P; manage: boolean; warehouses: Overview['warehouses']; overdueDays: number; openPayout?: string | null }) {
  const pf = PLATFORMS.find((x) => x.key === p)!;
  const [sub, setSub] = useState<'orders' | 'payouts' | 'returns' | 'ads' | 'tracker' | 'skus'>(openPayout ? 'payouts' : manage ? 'orders' : 'tracker');
  const subs: [typeof sub, string][] = [['orders', '1. Orders → pull-out'], ['payouts', '2. Payouts (settlements)'], ['returns', '3. Returns'], ['ads', '4. Ads'], ['tracker', 'Order tracker'], ['skus', 'SKU matches']];
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-1 border-b border-slate-200">{subs.map(([k, l]) => <button key={k} onClick={() => setSub(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${sub === k ? 'border-brand text-navy' : 'border-transparent text-slate-500 hover:text-navy'}`} style={sub === k ? { borderColor: pf.color } : undefined}>{l}</button>)}</div>
    {sub === 'orders' && <OrdersTab p={p} manage={manage} warehouses={warehouses} />}
    {sub === 'payouts' && <PayoutsTab p={p} manage={manage} initialOpen={openPayout ?? null} />}
    {sub === 'returns' && <ReturnsTab p={p} manage={manage} />}
    {sub === 'ads' && <AdsTab p={p} manage={manage} />}
    {sub === 'tracker' && <TrackerTab p={p} overdueDays={overdueDays} />}
    {sub === 'skus' && <SkuTab p={p} manage={manage} />}
  </div>;
}

/** Product search box that returns the chosen product. */
function ProductSearch({ onPick, placeholder = 'Type the GWS product name or SKU…' }: { onPick: (p: { id: string; name: string; sku: string }) => void; placeholder?: string }) {
  const [search, setSearch] = useState('');
  const products = useQuery({ queryKey: ['products', search], queryFn: () => api.get<{ id: string; name: string; sku: string }[]>(`/api/products?search=${encodeURIComponent(search)}&take=15&ecomFirst=1`), enabled: search.length >= 2 });
  return <div className="relative">
    <Input placeholder={placeholder} value={search} onChange={(e) => setSearch(e.target.value)} />
    {search.length >= 2 && <ul className="absolute z-10 mt-1 max-h-56 w-full divide-y overflow-auto rounded-xl border bg-white text-sm shadow">{products.data?.map((x) => <li key={x.id}><button className="w-full px-3 py-2 text-left hover:bg-slate-50" onClick={() => { onPick(x); setSearch(''); }}>{x.name} <span className="text-xs text-slate-500">{x.sku}</span></button></li>)}{products.data?.length === 0 && <li className="px-3 py-2 text-slate-500">No product found</li>}</ul>}
  </div>;
}

interface UploadResult { pullOut: { id: string; controlNo: string } | null; ordersAdded: number; duplicates: string[]; cancelled: string[]; unknownSkus: { platformSku: string; name: string | null; orders: number }[]; notEnoughStock: { orderId: string; item: string }[]; errors: string[]; warehouse: string }
interface PulloutRow { id: string; controlNo: string; docDate: string; status: string; from: string; notes: string | null; units: number; orders: number }
interface PulloutDetail { id: string; controlNo: string; status: string; docDate: string; fromLocation: { name: string }; toLocation: { name: string }; picking: { sku: string; product: string; batchNo: string | null; expiryDate: string | null; qty: number }[]; orders: { id: string; orderId: string; trackingNo: string | null; status: string; lines: { platformSku: string; productName: string | null; qty: number }[] }[] }

function OrdersTab({ p, manage, warehouses }: { p: P; manage: boolean; warehouses: Overview['warehouses'] }) {
  const pf = PLATFORMS.find((x) => x.key === p)!; const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null); const [wh, setWh] = useState(''); const [result, setResult] = useState<UploadResult | null>(null); const [open, setOpen] = useState<string | null>(null);
  const [matched, setMatched] = useState<Record<string, string>>({});
  const list = useQuery({ queryKey: ['ecom-pullouts', p], queryFn: () => api.get<PulloutRow[]>(`/api/ecommerce/${slug(p)}/pullouts`) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['ecom-pullouts', p] }); void qc.invalidateQueries({ queryKey: ['ecom-overview'] }); };
  const upload = useMutation({ mutationFn: (f: File) => api.upload<UploadResult>(`/api/ecommerce/${slug(p)}/orders/upload${wh ? `?warehouseId=${wh}` : ''}`, f), onSuccess: (r) => { setResult(r); setMatched({}); if (r.pullOut) setOpen(r.pullOut.id); refresh(); } });
  const saveMatch = useMutation({ mutationFn: (x: { platformSku: string; productId: string; name: string }) => api.post(`/api/ecommerce/${slug(p)}/sku-maps`, { platformSku: x.platformSku, productId: x.productId }), onSuccess: (_r, x) => setMatched((m) => ({ ...m, [x.platformSku]: x.name })) });
  const allMatched = !!result?.unknownSkus.length && result.unknownSkus.every((u) => matched[u.platformSku]);
  return <div className="space-y-3">
    {manage && <Card title={`Upload the ${pf.name} order / waybill file`}>
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-slate-600">
        <li>In {pf.seller}, open the orders <b>to ship</b> and <b>Export</b> them (Excel or CSV).</li>
        <li>Upload the file here. Every new order goes on one <b>draft pull-out</b> from the Warehouse (items totalled, oldest expiry first).</li>
        <li>Check the draft, print the picking list and <b>Submit</b>: the Warehouse In-Charge approves and packs.</li>
      </ol>
      <div className="flex flex-wrap items-end gap-3">
        {warehouses.length > 1 && <Field label="Items come from"><Select value={wh} onChange={(e) => setWh(e.target.value)}><option value="">Main warehouse</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>}
        <label className="inline-flex min-h-9 cursor-pointer items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white shadow-sm">{upload.isPending ? 'Reading…' : 'Choose file and upload'}<input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); upload.mutate(f); } e.target.value = ''; }} /></label>
        <Button variant="ghost" size="sm" onClick={() => api.download('/api/ecommerce/templates/orders.xlsx', 'gws-ecommerce-orders-template.xlsx')}>GWS orders template</Button>
      </div>
      <ErrorBox error={upload.error} />
      {result && <div className="mt-3 space-y-2 text-sm">
        <p className={result.ordersAdded ? 'rounded-lg bg-emerald-50 p-2 text-emerald-800' : 'rounded-lg bg-slate-50 p-2 text-slate-700'}>{result.ordersAdded ? <>✓ {result.ordersAdded} order(s) put on draft pull-out <b>{result.pullOut?.controlNo}</b> from {result.warehouse}.</> : 'No new order was added.'}</p>
        {result.duplicates.length > 0 && <p className="text-slate-600">Already uploaded before (skipped): {result.duplicates.length} order(s).</p>}
        {result.cancelled.length > 0 && <p className="text-slate-600">Cancelled in the file (skipped): {result.cancelled.join(', ')}</p>}
        {result.notEnoughStock.length > 0 && <div className="rounded-lg bg-amber-50 p-2 text-amber-800">Not enough stock in the Warehouse — these orders were not added: {result.notEnoughStock.map((x) => `${x.orderId} (${x.item})`).join(', ')}</div>}
        {result.errors.map((e) => <p key={e} className="text-red-700">{e}</p>)}
        {result.unknownSkus.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 font-semibold text-amber-900">New {pf.name} SKUs: pick the matching GWS product once (it is remembered), then upload the same file again.</p>
          <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2"><tbody>{result.unknownSkus.map((u) => <tr key={u.platformSku} className="border-t border-amber-200"><td className="py-2 pr-2"><div className="font-mono text-xs">{u.platformSku}</div><div className="text-xs text-slate-600">{u.name} · {u.orders} order(s)</div></td><td className="w-1/2 py-2">{matched[u.platformSku] ? <span className="text-emerald-700">✓ {matched[u.platformSku]}</span> : <ProductSearch onPick={(x) => saveMatch.mutate({ platformSku: u.platformSku, productId: x.id, name: x.name })} />}</td></tr>)}</tbody></table>
          {file && <Button className="mt-2" disabled={!allMatched || upload.isPending} onClick={() => upload.mutate(file)}>Upload the same file again</Button>}
        </div>}
      </div>}
    </Card>}
    <Card title="E-commerce pull-outs">
      {list.data?.length ? <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1">Pull-out</th><th>Date</th><th>From</th><th className="text-right">Orders</th><th className="text-right">Units</th><th>Status</th><th /></tr></thead><tbody>
        {list.data.map((d) => <Fragment key={d.id}><tr className="border-t"><td className="py-2 font-medium">{d.controlNo}</td><td>{fmtDate(d.docDate)}</td><td>{d.from}</td><td className="text-right">{d.orders}</td><td className="text-right">{d.units}</td><td><Badge tone={STATUS_TONE(d.status === 'RECEIVED' ? 'POSTED' : d.status)}>{d.status === 'RECEIVED' ? 'Approved – shipped' : d.status === 'SUBMITTED' ? 'Waiting for In-Charge' : d.status}</Badge></td><td className="text-right"><Button size="sm" variant="outline" onClick={() => setOpen(open === d.id ? null : d.id)}>{open === d.id ? 'Close' : 'Open'}</Button></td></tr>
          {open === d.id && <tr><td colSpan={7} className="bg-slate-50 p-3"><PulloutView id={d.id} manage={manage} onChange={refresh} /></td></tr>}</Fragment>)}
      </tbody></table> : <Empty>No pull-out yet. Upload an order file to create one.</Empty>}
    </Card>
  </div>;
}

function printPicking(d: PulloutDetail, platform: string) {
  const w = window.open('', '_blank', 'width=900,height=700'); if (!w) return;
  const rows = d.picking.map((l) => `<tr><td>${l.sku}</td><td>${l.product}</td><td>${l.batchNo ?? ''}</td><td>${fmtDate(l.expiryDate)}</td><td style="text-align:right">${l.qty}</td><td></td></tr>`).join('');
  const orders = d.orders.filter((o) => o.status !== 'CANCELLED').map((o) => `<tr><td>${o.orderId}</td><td>${o.trackingNo ?? ''}</td><td>${o.lines.map((l) => `${l.qty}× ${l.productName ?? l.platformSku}`).join(', ')}</td></tr>`).join('');
  w.document.write(`<html><head><title>${d.controlNo}</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:24px}table{border-collapse:collapse;width:100%;margin-bottom:16px}td,th{border:1px solid #999;padding:4px 6px;text-align:left}h1{font-size:18px;margin:0}</style></head><body>
    <h1>E-commerce Pull-out ${d.controlNo}${d.status === 'DRAFT' ? ' (DRAFT)' : ''}</h1><p>${platform} · ${d.fromLocation.name} → ${d.toLocation.name} · ${fmtDate(d.docDate)}</p>
    <h3>Picking list</h3><table><tr><th>SKU</th><th>Item</th><th>Batch</th><th>Expiry</th><th>Qty</th><th>Picked ✓</th></tr>${rows}</table>
    <h3>Orders / waybills (${d.orders.filter((o) => o.status !== 'CANCELLED').length})</h3><table><tr><th>Order ID</th><th>Tracking no.</th><th>Items</th></tr>${orders}</table>
    <p>Prepared by: ____________________ &nbsp;&nbsp; Checked & approved (Warehouse In-Charge): ____________________</p></body></html>`);
  w.document.close(); w.focus(); w.print();
}

function PulloutView({ id, manage, onChange }: { id: string; manage: boolean; onChange: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ecom-pullout', id], queryFn: () => api.get<PulloutDetail & { platform: P | null }>(`/api/ecommerce/pullouts/${id}`) });
  const done = () => { void qc.invalidateQueries({ queryKey: ['ecom-pullout', id] }); onChange(); };
  const remove = useMutation({ mutationFn: (orderId: string) => api.post(`/api/ecommerce/pullouts/${id}/remove-order/${orderId}`), onSuccess: done });
  const submit = useMutation({ mutationFn: () => api.post(`/api/ecommerce/pullouts/${id}/submit`), onSuccess: done });
  const voidIt = useMutation({ mutationFn: () => api.post(`/api/ecommerce/pullouts/${id}/void`, { reason: 'Cancelled by the E-comm Associate' }), onSuccess: done });
  const d = q.data; if (!d) return <p className="text-sm text-slate-500">Loading…</p>;
  const draft = d.status === 'DRAFT';
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={() => printPicking(d, PLATFORMS.find((x) => x.key === d.platform)?.name ?? '')}>Print picking list</Button>
      {manage && draft && <Button size="sm" onClick={() => submit.mutate()} disabled={submit.isPending}>Submit to the Warehouse In-Charge</Button>}
      {manage && draft && <Button size="sm" variant="danger" onClick={() => { if (confirm('Cancel this whole pull-out?')) voidIt.mutate(); }}>Cancel pull-out</Button>}
      {d.status === 'SUBMITTED' && <span className="self-center text-sm text-amber-700">Waiting for the Warehouse In-Charge to approve.</span>}
    </div>
    <ErrorBox error={submit.error ?? remove.error ?? voidIt.error} />
    <div className="grid gap-3 lg:grid-cols-2">
      <div><h4 className="mb-1 text-sm font-semibold text-navy">Picking list (oldest expiry first)</h4><table className="w-full text-sm [&_td]:px-2 [&_th]:px-2"><thead className="text-left text-xs text-slate-500"><tr><th>Item</th><th>Batch / expiry</th><th className="text-right">Qty</th></tr></thead><tbody>{d.picking.map((l, i) => <tr key={i} className="border-t"><td className="py-1">{l.product}<div className="text-xs text-slate-500">{l.sku}</div></td><td className="text-xs">{l.batchNo ?? '—'} · {fmtDate(l.expiryDate) || 'no expiry'}</td><td className="text-right font-semibold">{l.qty}</td></tr>)}</tbody></table></div>
      <div><h4 className="mb-1 text-sm font-semibold text-navy">Orders on this pull-out</h4><table className="w-full text-sm [&_td]:px-2 [&_th]:px-2"><tbody>{d.orders.map((o) => <tr key={o.id} className="border-t"><td className="py-1 font-mono text-xs">{o.orderId}<div className="text-slate-500">{o.trackingNo}</div></td><td className="text-xs">{o.lines.map((l) => `${l.qty}× ${l.productName ?? l.platformSku}`).join(', ')}</td><td><Badge tone={ORDER_STATUS[o.status]?.tone ?? 'slate'}>{ORDER_STATUS[o.status]?.label ?? o.status}</Badge></td><td className="text-right">{manage && draft && <button className="text-xs text-red-600" onClick={() => remove.mutate(o.id)}>Remove</button>}</td></tr>)}</tbody></table></div>
    </div>
  </div>;
}

interface SettlementRow { id: string; controlNo: string; docDate: string; status: string; sourceFile: string | null; orders: number; grossSales: string; payout: string; filePayout: string }
interface Settlement extends SettlementRow { sellerDiscounts: string; commission: string; transactionFee: string; shippingFee: string; affiliateFee: string; otherFees: string; adjustments: string; refunds: string; withholdingTax: string; netSales: string; totalFees: string; costOfSales?: string; counts: Record<string, number>; details: { orderId: string; kind: string; included: boolean; trackingNo?: string | null; amounts: Record<string, number> }[]; check: { computed: string; payout: string; notInBatch: string } }

function PayoutsTab({ p, manage, initialOpen }: { p: P; manage: boolean; initialOpen: string | null }) {
  const pf = PLATFORMS.find((x) => x.key === p)!; const qc = useQueryClient();
  const [inc, setInc] = useState(false); const [open, setOpen] = useState<string | null>(initialOpen); const [warn, setWarn] = useState<string[]>([]);
  const list = useQuery({ queryKey: ['ecom-settlements', p], queryFn: () => api.get<SettlementRow[]>(`/api/ecommerce/${slug(p)}/settlements`) });
  const upload = useMutation({ mutationFn: (f: File) => api.upload<Settlement & { warnings: string[] }>(`/api/ecommerce/${slug(p)}/settlements/upload?includeUnmatched=${inc}`, f), onSuccess: (r) => { setOpen(r.id); setWarn(r.warnings ?? []); void qc.invalidateQueries({ queryKey: ['ecom-settlements', p] }); } });
  return <div className="space-y-3">
    {manage && <Card title={`Upload the ${pf.name} payout file`}>
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-slate-600">
        <li>In {pf.seller} → <b>Finance</b> (statements / income / transaction overview), export the payout you received.</li>
        <li>Upload it here: each order is matched to the orders you shipped. Check that the <b>payout</b> shown equals the money {pf.name} released.</li>
        <li><b>Send to Accounting</b>: the Accounting Head approves, then the sale, every fee, refunds, withholding tax and the payout are posted.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex min-h-9 cursor-pointer items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white shadow-sm">{upload.isPending ? 'Reading…' : 'Choose payout file and upload'}<input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} /></label>
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={inc} onChange={(e) => setInc(e.target.checked)} /> Also book orders not in GWS-ERP (shipped before GWS-ERP) — money only, no stock</label>
        <Button variant="ghost" size="sm" onClick={() => api.download('/api/ecommerce/templates/settlement.xlsx', 'gws-ecommerce-payout-template.xlsx')}>GWS payout template</Button>
      </div>
      <ErrorBox error={upload.error} />
      {warn.map((w) => <p key={w} className="mt-2 text-sm text-amber-700">{w}</p>)}
    </Card>}
    <Card title="Payouts">
      {list.data?.length ? <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1">No.</th><th>Date</th><th>File</th><th className="text-right">Orders</th><th className="text-right">Gross sales</th><th className="text-right">Payout</th><th>Status</th><th /></tr></thead><tbody>
        {list.data.map((s) => <Fragment key={s.id}><tr className="border-t"><td className="py-2 font-medium">{s.controlNo}</td><td>{fmtDate(s.docDate)}</td><td className="max-w-48 truncate text-xs text-slate-500">{s.sourceFile}</td><td className="text-right">{s.orders}</td><td className="text-right">{peso(s.grossSales)}</td><td className="text-right font-semibold">{peso(s.payout)}</td><td><Badge tone={STATUS_TONE(s.status)}>{s.status === 'SUBMITTED' ? 'With Accounting' : s.status}</Badge></td><td className="text-right"><Button size="sm" variant="outline" onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? 'Close' : 'Open'}</Button></td></tr>
          {open === s.id && <tr><td colSpan={8} className="bg-slate-50 p-3"><SettlementView id={s.id} manage={manage} p={p} /></td></tr>}</Fragment>)}
      </tbody></table> : <Empty>No payout uploaded yet.</Empty>}
    </Card>
  </div>;
}

function SettlementView({ id, manage, p }: { id: string; manage: boolean; p: P }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ecom-settlement', id], queryFn: () => api.get<Settlement>(`/api/ecommerce/settlements/${id}`) });
  const done = () => { void qc.invalidateQueries({ queryKey: ['ecom-settlement', id] }); void qc.invalidateQueries({ queryKey: ['ecom-settlements', p] }); };
  const submit = useMutation({ mutationFn: () => api.post(`/api/ecommerce/settlements/${id}/submit`), onSuccess: done });
  const del = useMutation({ mutationFn: () => api.delete(`/api/ecommerce/settlements/${id}`), onSuccess: done });
  const s = q.data; if (!s) return <p className="text-sm text-slate-500">Loading…</p>;
  const line = (label: string, v: string | number, strong = false, minus = false) => <tr className={strong ? 'border-t font-semibold' : ''}><td className="py-0.5">{label}</td><td className="text-right tabular-nums">{minus && Number(v) ? '− ' : ''}{peso(v)}</td></tr>;
  const ties = Math.abs(Number(s.check.computed) - Number(s.payout)) < 0.01;
  return <div className="space-y-3">
    <div className="grid gap-4 lg:grid-cols-2">
      <table className="w-full max-w-md text-sm [&_td]:px-2 [&_th]:px-2"><tbody>
        {line('Gross sales (item price)', s.grossSales)}
        {line('Seller discounts & vouchers', s.sellerDiscounts, false, true)}
        {line('Net sales', s.netSales, true)}
        {line('Commission', s.commission, false, true)}
        {line('Transaction / payment fee', s.transactionFee, false, true)}
        {line('Shipping fee', s.shippingFee, false, true)}
        {line('Affiliate / creator commission', s.affiliateFee, false, true)}
        {line('Other fees and adjustments', (Number(s.otherFees) - Number(s.adjustments)).toFixed(2), false, true)}
        {line('Refunds', s.refunds, false, true)}
        {line('Withholding tax (creditable)', s.withholdingTax, false, true)}
        {line('Payout received', s.payout, true)}
        {s.costOfSales !== undefined && s.status === 'POSTED' && line('Cost of goods sold', s.costOfSales)}
      </tbody></table>
      <div className="space-y-2 text-sm">
        <p className={ties ? 'text-emerald-700' : 'text-red-700'}>{ties ? '✓ Net sales − fees − refunds − tax = payout' : `Check: computed ${peso(s.check.computed)} vs payout ${peso(s.payout)}`}</p>
        {Number(s.check.notInBatch) !== 0 && <p className="rounded-lg bg-amber-50 p-2 text-amber-800">{peso(s.check.notInBatch)} of the file's payout is for orders not in this batch (see the list: not in GWS-ERP, not shipped yet or already paid).</p>}
        <p className="text-slate-600">{Object.entries(s.counts).map(([k, n]) => `${n} ${KIND[k]?.split(' (')[0].toLowerCase() ?? k}`).join(' · ')}</p>
        <div className="flex flex-wrap gap-2">
          {manage && s.status === 'DRAFT' && <Button size="sm" onClick={() => submit.mutate()} disabled={submit.isPending}>Send to Accounting</Button>}
          {manage && ['DRAFT', 'REJECTED'].includes(s.status) && <Button size="sm" variant="danger" onClick={() => { if (confirm('Delete this payout upload?')) del.mutate(); }}>Delete</Button>}
          {s.status === 'SUBMITTED' && <span className="text-amber-700">Waiting for the Accounting Head.</span>}
          {s.status === 'POSTED' && <span className="text-emerald-700">Posted.</span>}
        </div>
        <ErrorBox error={submit.error ?? del.error} />
      </div>
    </div>
    <details><summary className="cursor-pointer text-sm font-semibold text-navy">Orders in the file ({s.details.length})</summary>
      <table className="mt-2 w-full text-xs [&_td]:px-2 [&_th]:px-2"><thead className="text-left text-slate-500"><tr><th>Order ID</th><th>What happens</th><th className="text-right">Gross</th><th className="text-right">Fees</th><th className="text-right">Refund</th><th className="text-right">Payout</th></tr></thead><tbody>{s.details.map((d) => {
        const a = d.amounts; const fees = a.commission + a.transactionFee + a.shippingFee + a.affiliateFee + a.otherFees - a.adjustments;
        return <tr key={d.orderId} className={`border-t ${d.included ? '' : 'text-slate-400'}`}><td className="py-1 font-mono">{d.orderId}</td><td>{KIND[d.kind]}{d.kind === 'UNKNOWN' && d.included ? ' — booked, no stock' : d.kind === 'UNKNOWN' ? ' — skipped' : ''}</td><td className="text-right">{peso(a.grossSales)}</td><td className="text-right">{peso(fees)}</td><td className="text-right">{peso(a.refunds)}</td><td className="text-right">{peso(a.payout)}</td></tr>;
      })}</tbody></table></details>
  </div>;
}

interface ReturnRow { id: string; controlNo: string; platform: P; platformName: string; reason: string | null; notes: string | null; status: string; createdAt: string; receivedAt: string | null; writeoffId: string | null; lines: { productId: string; name?: string; qty: number; goodQty?: number; damagedQty?: number }[]; order: { orderId: string; trackingNo: string | null; status: string } | null }
const REASON: Record<string, string> = { FAILED_DELIVERY: 'Failed delivery / returned to seller', BUYER_RETURN: 'Buyer return (refund)', OTHER: 'Other' };

function ReturnsTab({ p, manage }: { p: P; manage: boolean }) {
  const qc = useQueryClient(); const [ref, setRef] = useState(''); const [reason, setReason] = useState(''); const [notes, setNotes] = useState(''); const [msg, setMsg] = useState('');
  const list = useQuery({ queryKey: ['ecom-returns', p], queryFn: () => api.get<ReturnRow[]>(`/api/ecommerce/${slug(p)}/returns`) });
  const create = useMutation({ mutationFn: () => api.post<{ controlNo: string }>(`/api/ecommerce/${slug(p)}/returns`, { ref, reason: reason || undefined, notes: notes || undefined }), onSuccess: (r) => { setMsg(`${r.controlNo} recorded. The Warehouse In-Charge was told to receive it.`); setRef(''); setNotes(''); void qc.invalidateQueries({ queryKey: ['ecom-returns', p] }); } });
  return <div className="space-y-3">
    {manage && <Card title="A parcel came back">
      <p className="mb-3 text-sm text-slate-600">Scan or type the order ID or tracking number, then hand the parcel to the Warehouse In-Charge, who marks each item <b>good</b> (back to stock) or <b>damaged</b> (write-off for the Head Auditor).</p>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Order ID or tracking no."><Input value={ref} onChange={(e) => setRef(e.target.value)} autoFocus /></Field>
        <Field label="Reason"><Select value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Automatic (not paid = failed delivery)</option>{Object.entries(REASON).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="Notes" className="md:col-span-2"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. box crushed, buyer changed mind" /></Field>
      </div>
      <Button className="mt-3" disabled={!ref.trim() || create.isPending} onClick={() => create.mutate()}>Record the return</Button>
      <ErrorBox error={create.error} />{msg && <p className="mt-2 text-sm text-emerald-700">{msg}</p>}
    </Card>}
    <Card title="Returns"><ReturnsTable rows={list.data ?? []} /></Card>
  </div>;
}

function ReturnsTable({ rows, receiving }: { rows: ReturnRow[]; receiving?: boolean }) {
  const qc = useQueryClient();
  const [qty, setQty] = useState<Record<string, { good: number; damaged: number }>>({});
  const receive = useMutation({ mutationFn: (r: ReturnRow) => api.post<{ writeoffId: string | null }>(`/api/ecommerce/returns/${r.id}/receive`, { lines: r.lines.map((l) => ({ productId: l.productId, goodQty: qty[`${r.id}|${l.productId}`]?.good ?? l.qty, damagedQty: qty[`${r.id}|${l.productId}`]?.damaged ?? 0 })) }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['ecom-returns'] }); void qc.invalidateQueries({ queryKey: ['ecom-returns-all'] }); void qc.invalidateQueries({ queryKey: ['ecom-overview'] }); } });
  if (!rows.length) return <Empty>No returns.</Empty>;
  return <div className="space-y-2"><ErrorBox error={receive.error} />
    {rows.map((r) => <div key={r.id} className="rounded-xl border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2"><b>{r.controlNo}</b>{receiving && <Badge tone="blue">{r.platformName}</Badge>}<span className="font-mono text-xs">{r.order?.orderId}</span><span className="text-xs text-slate-500">{r.order?.trackingNo}</span><span className="text-xs text-slate-500">{REASON[r.reason ?? ''] ?? r.reason}</span><Badge tone={r.status === 'RECEIVED' ? 'green' : 'amber'}>{r.status === 'RECEIVED' ? `Received ${fmtDate(r.receivedAt)}` : 'Waiting for the Warehouse'}</Badge>{r.writeoffId && <Badge tone="red">damaged → write-off</Badge>}</div>
      {r.notes && <p className="mt-1 text-xs text-slate-500">{r.notes}</p>}
      <table className="mt-2 w-full [&_td]:px-2 [&_th]:px-2"><thead className="text-left text-xs text-slate-500"><tr><th>Item</th><th className="text-right">Qty</th><th className="text-right">Good</th><th className="text-right">Damaged</th></tr></thead><tbody>{r.lines.map((l) => {
        const k = `${r.id}|${l.productId}`; const v = qty[k] ?? { good: l.qty, damaged: 0 };
        return <tr key={l.productId} className="border-t"><td className="py-1">{l.name}</td><td className="text-right">{l.qty}</td>
          {r.status === 'PENDING' && receiving ? <><td className="text-right"><Input type="number" min={0} max={l.qty} className="ml-auto w-20 text-right" value={v.good} onChange={(e) => setQty({ ...qty, [k]: { ...v, good: Math.max(0, Math.floor(Number(e.target.value) || 0)) } })} /></td><td className="text-right"><Input type="number" min={0} max={l.qty} className="ml-auto w-20 text-right" value={v.damaged} onChange={(e) => setQty({ ...qty, [k]: { ...v, damaged: Math.max(0, Math.floor(Number(e.target.value) || 0)) } })} /></td></> : <><td className="text-right">{l.goodQty ?? '—'}</td><td className="text-right">{l.damagedQty ?? '—'}</td></>}</tr>;
      })}</tbody></table>
      {r.status === 'PENDING' && receiving && <Button size="sm" className="mt-2" disabled={receive.isPending} onClick={() => receive.mutate(r)}>Receive: good back to stock, damaged to write-off</Button>}
    </div>)}
  </div>;
}

/** Warehouse In-Charge: returned parcels from every platform. */
function ReceiveReturns() {
  const q = useQuery({ queryKey: ['ecom-returns-all'], queryFn: () => api.get<ReturnRow[]>('/api/ecommerce/returns') });
  return <Card title="Returned e-commerce parcels"><p className="mb-3 text-sm text-slate-600">Open the parcel, count each item and enter how many are <b>good</b> (they go back to Warehouse stock) and how many are <b>damaged or expired</b> (they come in and a write-off goes to the Head Auditor). E-commerce pull-outs to approve are in <b>Approvals</b>.</p><ReturnsTable rows={q.data ?? []} receiving /></Card>;
}

function AdsTab({ p, manage }: { p: P; manage: boolean }) {
  const pf = PLATFORMS.find((x) => x.key === p)!; const qc = useQueryClient();
  const [f, setF] = useState({ month: today().slice(0, 7), amount: '', paidFrom: '', reference: '' });
  const list = useQuery({ queryKey: ['ecom-ads', p], queryFn: () => api.get<{ id: string; month: string; amount: string; paidFrom: string; reference: string | null; createdAt: string }[]>(`/api/ecommerce/${slug(p)}/ads`) });
  const accounts = useQuery({ queryKey: ['ecom-pay-accounts'], queryFn: () => api.get<{ id: string; code: string; title: string }[]>('/api/ecommerce/payment-accounts'), enabled: manage });
  const done = () => { void qc.invalidateQueries({ queryKey: ['ecom-ads', p] }); setF({ ...f, amount: '', reference: '' }); };
  const add = useMutation({ mutationFn: () => api.post(`/api/ecommerce/${slug(p)}/ads`, { month: f.month, amount: Number(f.amount), paidFromAccountId: f.paidFrom || null, reference: f.reference || undefined }), onSuccess: done });
  const upload = useMutation({ mutationFn: (file: File) => api.upload<{ months: { month: string; amount: number }[] }>(`/api/ecommerce/${slug(p)}/ads/upload?month=${f.month}${f.paidFrom ? `&paidFromAccountId=${f.paidFrom}` : ''}`, file), onSuccess: done });
  const total = (list.data ?? []).reduce((t, a) => t + Number(a.amount), 0);
  return <div className="space-y-3">
    {manage && <Card title={`${pf.name} ads spend (expense)`}>
      <p className="mb-3 text-sm text-slate-600">Once a month, download the ads billing / invoice from the {pf.name} ads centre and upload it (amounts are added up per month), or type the amount. Choose how the ads were paid: from the {pf.name} balance (deducted from sales) or by a bank / card account.</p>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Month"><Input type="month" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} /></Field>
        <Field label="Paid from"><Select value={f.paidFrom} onChange={(e) => setF({ ...f, paidFrom: e.target.value })}><option value="">{pf.name} balance (deducted from sales)</option>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.code} {a.title}</option>)}</Select></Field>
        <Field label="Amount (₱)"><Input type="number" min={0} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Invoice / reference"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button disabled={!(Number(f.amount) > 0) || add.isPending} onClick={() => add.mutate()}>Record ads expense</Button>
        <label className="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-navy">{upload.isPending ? 'Reading…' : 'Or upload the ads billing file'}<input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) upload.mutate(file); e.target.value = ''; }} /></label>
        {upload.data && <span className="text-sm text-emerald-700">✓ {upload.data.months.map((m) => `${m.month}: ${peso(m.amount)}`).join(', ')}</span>}
      </div>
      <ErrorBox error={add.error ?? upload.error} />
    </Card>}
    <Card title={`Ads recorded · total ${peso(total)}`}>{list.data?.length ? <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1">Month</th><th className="text-right">Amount</th><th>Paid from</th><th>Reference</th></tr></thead><tbody>{list.data.map((a) => <tr key={a.id} className="border-t"><td className="py-1.5">{a.month}</td><td className="text-right">{peso(a.amount)}</td><td>{a.paidFrom}</td><td className="text-xs text-slate-500">{a.reference}</td></tr>)}</tbody></table> : <Empty>No ads recorded yet.</Empty>}</Card>
  </div>;
}

function TrackerTab({ p, overdueDays }: { p: P; overdueDays: number }) {
  const [status, setStatus] = useState(''); const [search, setSearch] = useState(''); const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(search), 300); return () => clearTimeout(t); }, [search]);
  const list = useQuery({ queryKey: ['ecom-orders', p, status, q], queryFn: () => api.get<{ overdueDays: number; orders: { id: string; orderId: string; trackingNo: string | null; status: string; pullOutNo: string | null; shippedAt: string | null; settledAt: string | null; daysSinceShipped: number | null; overdue: boolean; units: number }[] }>(`/api/ecommerce/${slug(p)}/orders?status=${status}&search=${encodeURIComponent(q)}`) });
  return <Card title="Order tracker">
    <p className="mb-3 text-sm text-slate-600">Every order pulled out, until it is paid or comes back. Shipped more than {overdueDays} days ago and neither paid nor returned = <b className="text-red-700">overdue</b>: follow it up with the platform (or claim a lost parcel). You are reminded every Friday.</p>
    <div className="mb-3 flex flex-wrap gap-2"><Select className="w-56" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All orders</option><option value="OVERDUE">Overdue</option>{Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select><Input className="w-64" placeholder="Search order ID or tracking no." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
    {list.data?.orders.length ? <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1">Order ID</th><th>Tracking</th><th>Pull-out</th><th className="text-right">Units</th><th>Status</th><th className="text-right">Days since shipped</th></tr></thead><tbody>{list.data.orders.map((o) => <tr key={o.id} className={`border-t ${o.overdue ? 'bg-red-50' : ''}`}><td className="py-1.5 font-mono text-xs">{o.orderId}</td><td className="text-xs">{o.trackingNo}</td><td className="text-xs">{o.pullOutNo}</td><td className="text-right">{o.units}</td><td><Badge tone={o.overdue ? 'red' : ORDER_STATUS[o.status]?.tone ?? 'slate'}>{o.overdue ? 'Overdue' : ORDER_STATUS[o.status]?.label ?? o.status}</Badge></td><td className="text-right">{o.daysSinceShipped ?? '—'}</td></tr>)}</tbody></table> : <Empty>No orders.</Empty>}
  </Card>;
}

function SkuTab({ p, manage }: { p: P; manage: boolean }) {
  const pf = PLATFORMS.find((x) => x.key === p)!; const qc = useQueryClient(); const [sku, setSku] = useState('');
  const list = useQuery({ queryKey: ['ecom-skus', p], queryFn: () => api.get<{ id: string; platformSku: string; product: { name: string; sku: string } | null }[]>(`/api/ecommerce/${slug(p)}/sku-maps`) });
  const save = useMutation({ mutationFn: (productId: string) => api.post(`/api/ecommerce/${slug(p)}/sku-maps`, { platformSku: sku, productId }), onSuccess: () => { setSku(''); void qc.invalidateQueries({ queryKey: ['ecom-skus', p] }); } });
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/api/ecommerce/sku-maps/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['ecom-skus', p] }) });
  return <Card title={`${pf.name} SKU matches`}>
    <p className="mb-3 text-sm text-slate-600">When the Seller SKU in {pf.name} is the same as the GWS SKU (or barcode), nothing needs to be done. Otherwise the match is saved here the first time an order file shows the SKU.</p>
    {manage && <div className="mb-3 grid gap-3 md:grid-cols-2"><Field label={`${pf.name} Seller SKU`}><Input value={sku} onChange={(e) => setSku(e.target.value)} /></Field><Field label="GWS product">{sku.trim() ? <ProductSearch onPick={(x) => save.mutate(x.id)} /> : <Input disabled placeholder="Type the platform SKU first" />}</Field></div>}
    <ErrorBox error={save.error} />
    {list.data?.length ? <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1">{pf.name} SKU</th><th>GWS product</th><th /></tr></thead><tbody>{list.data.map((m) => <tr key={m.id} className="border-t"><td className="py-1.5 font-mono text-xs">{m.platformSku}</td><td>{m.product?.name} <span className="text-xs text-slate-500">{m.product?.sku}</span></td><td className="text-right">{manage && <button className="text-xs text-red-600" onClick={() => del.mutate(m.id)}>Remove</button>}</td></tr>)}</tbody></table> : <Empty>No saved matches.</Empty>}
  </Card>;
}

interface Col { platform: string; name: string; grossSales: number; sellerDiscounts: number; netSales: number; refunds: number; commission: number; transactionFee: number; shippingFee: number; affiliateFee: number; otherFees: number; totalFees: number; ads: number; afterFeesAndAds: number; withholdingTax: number; payout: number; costOfSales?: number; contribution?: number; feesPct: number | null; roas: number | null; ordersShipped: number; ordersPaid: number; ordersReturned: number; overdueNow: number; returnRatePct: number | null }

function ReportTab() {
  const [from, setFrom] = useState(`${today().slice(0, 8)}01`); const [to, setTo] = useState(today());
  const q = useQuery({ queryKey: ['ecom-report', from, to], queryFn: () => api.get<{ canCost: boolean; columns: Col[] }>(`/api/ecommerce/report?from=${from}&to=${to}`) });
  const cols = q.data?.columns ?? [];
  const rows: [string, (c: Col) => string, string?][] = [
    ['Gross sales (item price)', (c) => peso(c.grossSales)],
    ['Less: seller discounts & vouchers', (c) => peso(c.sellerDiscounts)],
    ['Net sales', (c) => peso(c.netSales), 'strong'],
    ['Less: refunds', (c) => peso(c.refunds)],
    ['Less: commission', (c) => peso(c.commission)],
    ['Less: transaction / payment fee', (c) => peso(c.transactionFee)],
    ['Less: shipping fee', (c) => peso(c.shippingFee)],
    ['Less: affiliate / creator commission', (c) => peso(c.affiliateFee)],
    ['Less: other fees & adjustments', (c) => peso(c.otherFees)],
    ['Less: ads', (c) => peso(c.ads)],
    ['After platform fees and ads', (c) => peso(c.afterFeesAndAds), 'strong'],
    ...(q.data?.canCost ? [['Less: cost of goods sold', (c: Col) => peso(c.costOfSales), undefined], ['Contribution (profit before overhead)', (c: Col) => peso(c.contribution), 'strong']] as [string, (c: Col) => string, string?][] : []),
    ['Fees as % of net sales', (c) => (c.feesPct == null ? '—' : `${c.feesPct}%`)],
    ['Return on ad spend (net sales ÷ ads)', (c) => (c.roas == null ? '—' : `${c.roas}×`)],
    ['Withholding tax withheld (claimable)', (c) => peso(c.withholdingTax)],
    ['Payouts received', (c) => peso(c.payout)],
    ['Orders shipped / paid / returned', (c) => `${c.ordersShipped} / ${c.ordersPaid} / ${c.ordersReturned}`],
    ['Return rate', (c) => (c.returnRatePct == null ? '—' : `${c.returnRatePct}%`)],
    ['Overdue now (not paid, not returned)', (c) => String(c.overdueNow)],
  ];
  const max = Math.max(1, ...cols.filter((c) => c.platform !== 'ALL').map((c) => c.netSales));
  return <div className="space-y-3">
    <Card>
      <div className="flex flex-wrap items-end gap-3"><Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field><p className="text-sm text-slate-500">Sales and fees from payouts posted in the period; ads of the months in the period.</p></div>
    </Card>
    <ErrorBox error={q.error} />
    <div className="grid gap-3 md:grid-cols-4">{cols.map((c) => <Stat key={c.platform} label={c.name} value={peso(c.netSales)} sub={`net sales · ${c.ordersPaid} paid orders`} />)}</div>
    <Card title="Net sales vs. what is left after fees and ads">
      <div className="space-y-2">{cols.filter((c) => c.platform !== 'ALL').map((c) => { const pf = PLATFORMS.find((x) => x.key === c.platform)!; return <div key={c.platform} className="grid grid-cols-[110px_1fr] items-center gap-2 text-sm"><span className="font-medium">{c.name}</span><div className="space-y-1"><div className="h-3 rounded" style={{ width: `${(c.netSales / max) * 100}%`, background: pf.color, minWidth: c.netSales ? 4 : 0 }} title={`Net sales ${peso(c.netSales)}`} /><div className="h-3 rounded opacity-50" style={{ width: `${(Math.max(0, c.afterFeesAndAds) / max) * 100}%`, background: pf.color, minWidth: c.afterFeesAndAds > 0 ? 4 : 0 }} title={`After fees and ads ${peso(c.afterFeesAndAds)}`} /></div></div>; })}
        <p className="text-xs text-slate-500">Solid bar: net sales. Light bar: what is left after platform fees, refunds and ads.</p></div>
    </Card>
    <Card title="E-commerce profit report">
      <div className="overflow-x-auto"><table className="w-full text-sm [&_td]:px-2 [&_th]:px-2"><thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="py-1" />{cols.map((c) => <th key={c.platform} className="text-right">{c.name}</th>)}</tr></thead><tbody>
        {rows.map(([label, f, strong]) => <tr key={label} className={`border-t ${strong ? 'font-semibold text-navy' : ''}`}><td className="py-1.5">{label}</td>{cols.map((c) => <td key={c.platform} className={`text-right tabular-nums ${c.platform === 'ALL' ? 'bg-slate-50' : ''}`}>{f(c)}</td>)}</tr>)}
      </tbody></table></div>
      {!q.data?.canCost && <p className="mt-2 text-xs text-slate-500">Cost of goods and profit after cost are shown only to people allowed to see cost.</p>}
    </Card>
  </div>;
}
