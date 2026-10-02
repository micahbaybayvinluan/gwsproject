import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, peso, today } from '@/lib/api';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Select, Stat } from '@/components/ui/primitives';
import { Searchable } from '@/components/Searchable';

interface Row { productId: string; sku: string; name: string; units: number; price: number | null; cost: number | null; fees?: number; shipping?: number; ads?: number; contribution?: number; marginPct?: number; belowTarget?: boolean; suggestedPrice?: number | null; changePct?: number | null; note?: string }
interface Plat {
  platform: string; name: string; hasData: boolean; orders: number; grossSales: number; sellerDiscounts: number; netSales: number; refunds: number;
  fees: { commission: number; transactionFee: number; shippingFee: number; affiliateFee: number; otherFees: number; total: number; pctOfNet: number };
  ads: number; roas: number | null; afterFeesAndAds: number; costOfSales: number; contribution: number; marginPct: number | null; withholdingTax: number; payout: number;
  rates: { commissionPct: number; transactionPct: number; affiliatePct: number; shippingPerOrder: number; otherPct: number; refundPct: number; adPctOfSales: number };
  targetPct: number; onTarget: boolean | null; neededPriceChangePct: number | null; impossible: boolean; products: Row[];
}
interface Analysis { from: string; to: string; targetPct: number; platforms: Plat[] }
const PLATFORMS: [string, string][] = [['TIKTOK', 'TikTok'], ['SHOPEE', 'Shopee'], ['LAZADA', 'Lazada']];
const pct = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
const monthStart = () => `${today().slice(0, 7)}-01`;

/** The Owner's e-commerce margin tool (owner request 2026-09-30): each platform's fees and charges, the ads, the margin left after cost of goods, and whether the platform prices keep the target. */
export function EcomAnalysisPage() {
  const qc = useQueryClient();
  const [from, setFrom] = useState(monthStart()); const [to, setTo] = useState(today());
  const [target, setTarget] = useState(''); const [what, setWhat] = useState({ commissionPct: '', transactionPct: '', affiliatePct: '', shippingPerOrder: '', adPctOfSales: '' });
  const [platform, setPlatform] = useState('ALL'); const [only, setOnly] = useState(false);
  const qs = new URLSearchParams({ from, to, ...(target ? { target } : {}), ...Object.fromEntries(Object.entries(what).filter(([, v]) => v !== '')) }).toString();
  const q = useQuery({ queryKey: ['ecom-analysis', qs], queryFn: () => api.get<Analysis>(`/api/ecommerce-analysis?${qs}`) });
  const saveTarget = useMutation({ mutationFn: (p: number) => api.put('/api/ecommerce-analysis/target', { pct: p }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['ecom-analysis'] }) });
  const plats = (q.data?.platforms ?? []).filter((p) => platform === 'ALL' || p.platform === platform);
  return <div className="space-y-4">
    <h1 className="text-2xl font-bold tracking-tight text-navy">E-commerce Margin Analysis</h1>
    <Card>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Platform"><Select value={platform} onChange={(e) => setPlatform(e.target.value)}><option value="ALL">All three</option>{PLATFORMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="Target margin %" hint={`saved: ${q.data?.targetPct ?? 20}%`}><div className="flex gap-1"><Input className="w-24" type="number" step="0.1" value={target} placeholder={String(q.data?.targetPct ?? 20)} onChange={(e) => setTarget(e.target.value)} /><Button variant="outline" disabled={!target || saveTarget.isPending} onClick={() => saveTarget.mutate(Number(target))}>Save</Button></div></Field>
        <label className="flex items-center gap-1 pb-2 text-sm"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> only products below target</label>
      </div>
      <details className="mt-2"><summary className="cursor-pointer text-sm font-medium">What if the fees change? (leave empty to use each platform’s actual rates)</summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-5">{([['commissionPct', 'Commission % of net'], ['transactionPct', 'Transaction / payment %'], ['affiliatePct', 'Affiliate %'], ['shippingPerOrder', 'Shipping fee per order (₱)'], ['adPctOfSales', 'Ads % of sales']] as const).map(([k, l]) => <Field key={k} label={l}><Input type="number" step="0.01" value={what[k]} onChange={(e) => setWhat({ ...what, [k]: e.target.value })} /></Field>)}</div></details>
      <p className="mt-2 text-xs text-slate-500">Sales and fees come from the payout files Accounting has posted; ads from the ad expenses below; cost from the products. Every amount keeps its centavos.</p>
    </Card>
    <ErrorBox error={q.error ?? saveTarget.error} />
    {q.isLoading ? <Empty>Loading…</Empty> : plats.map((p) => <PlatformCard key={p.platform} p={p} only={only} />)}
    <AdSpend onSaved={() => void qc.invalidateQueries({ queryKey: ['ecom-analysis'] })} />
  </div>;
}

function PlatformCard({ p, only }: { p: Plat; only: boolean }) {
  const rows = p.products.filter((r) => !only || r.belowTarget);
  const fee = (label: string, v: number) => <tr className="border-t"><td className="py-1 pr-3">{label}</td><td className="num pr-3">{peso(v)}</td><td className="num">{p.netSales ? pct((v / p.netSales) * 100) : '—'}</td></tr>;
  return <Card title={<span className="flex flex-wrap items-center gap-2">{p.name}{p.hasData ? (p.onTarget ? <Badge tone="green">on target</Badge> : <Badge tone="red">below target</Badge>) : <Badge>no posted payout in this period</Badge>}</span>}>
    {p.hasData && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Stat label="Net sales" value={peso(p.netSales)} sub={`${p.orders} orders · gross ${peso(p.grossSales)}`} /><Stat label="Platform fees & charges" value={peso(p.fees.total)} sub={`${pct(p.fees.pctOfNet)} of net sales`} tone="amber" /><Stat label="Ads" value={peso(p.ads)} sub={p.roas ? `ROAS ${p.roas.toFixed(2)}` : undefined} />
      <Stat label="Contribution after cost" value={peso(p.contribution)} sub={`cost of goods ${peso(p.costOfSales)}`} tone={p.contribution < 0 ? 'red' : undefined} /><Stat label="Margin" value={pct(p.marginPct)} sub={`target ${pct(p.targetPct)}`} tone={p.onTarget ? 'green' : 'red'} />
    </div>}
    {p.hasData && <div className="mt-3 grid gap-4 md:grid-cols-2">
      <div className="sticky-head"><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1 pr-3">Where the money goes</th><th className="num pr-3">Amount</th><th className="num">% of net</th></tr></thead><tbody>
        <tr className="border-t"><td className="py-1 pr-3">Gross sales</td><td className="num pr-3">{peso(p.grossSales)}</td><td /></tr>{fee('− Seller discounts & vouchers', p.sellerDiscounts)}{fee('− Refunds', p.refunds)}{fee('− Commission', p.fees.commission)}{fee('− Transaction / payment fee', p.fees.transactionFee)}{fee('− Shipping fee', p.fees.shippingFee)}{fee('− Affiliate commission', p.fees.affiliateFee)}{fee('− Other fees & adjustments', p.fees.otherFees)}{fee('− Ads', p.ads)}{fee('− Cost of goods', p.costOfSales)}
        <tr className="border-t font-semibold"><td className="py-1 pr-3">= Contribution</td><td className="num pr-3">{peso(p.contribution)}</td><td className="num">{pct(p.marginPct)}</td></tr>
        <tr className="border-t text-slate-500"><td className="py-1 pr-3">Withholding tax (credit)</td><td className="num pr-3">{peso(p.withholdingTax)}</td><td /></tr><tr className="border-t text-slate-500"><td className="py-1 pr-3">Payout received</td><td className="num pr-3">{peso(p.payout)}</td><td /></tr></tbody></table></div>
      <div className="space-y-2 text-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Is the pricing right?</div>
        {p.onTarget ? <p className="rounded border border-emerald-200 bg-emerald-50 p-2">The margin {pct(p.marginPct)} keeps the {pct(p.targetPct)} target. No price change is needed overall.</p>
          : p.impossible ? <p className="rounded border border-red-200 bg-brand-soft p-2">Fees and refunds alone take more than the room left by the {pct(p.targetPct)} target, so raising prices cannot fix it. Lower the fees (vouchers, affiliate %, shipping programs) or lower the target.</p>
            : <p className="rounded border border-amber-200 bg-amber-50 p-2">To keep {pct(p.targetPct)}, raise the platform prices by about <b>{pct(p.neededPriceChangePct)}</b> (percent fees grow with the price; ads, per-order shipping and cost of goods do not). The product table shows the exact price for each item.</p>}
        <div className="text-xs text-slate-500">Rates used: commission {pct(p.rates.commissionPct)}, transaction {pct(p.rates.transactionPct)}, affiliate {pct(p.rates.affiliatePct)}, other {pct(p.rates.otherPct)}, refunds {pct(p.rates.refundPct)}, shipping {peso(p.rates.shippingPerOrder)} per order, ads {pct(p.rates.adPctOfSales)} of sales.</div>
      </div></div>}
    <div className="mt-3 overflow-x-auto">{rows.length ? <Searchable><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1 pr-3">Product</th><th className="num pr-3">Units</th><th className="num pr-3">{p.name} price</th><th className="num pr-3">Fees</th><th className="num pr-3">Shipping</th><th className="num pr-3">Ads</th><th className="num pr-3">Cost</th><th className="num pr-3">Contribution</th><th className="num pr-3">Margin</th><th className="num pr-3">Price for target</th><th className="num">Change</th></tr></thead>
      <tbody>{rows.map((r) => r.price == null ? <tr key={r.productId} className="border-t text-slate-500"><td className="py-1.5 pr-3">{r.name}</td><td className="num pr-3">{r.units}</td><td colSpan={9}>{r.note}. Set it in E-com & Card Prices.</td></tr>
        : <tr key={r.productId} className={`border-t ${r.belowTarget ? 'bg-brand-soft/40' : ''}`}><td className="py-1.5 pr-3"><div className="font-medium">{r.name}</div><div className="text-xs text-slate-500">{r.sku}</div></td><td className="num pr-3">{r.units}</td><td className="num pr-3">{peso(r.price)}</td><td className="num pr-3">{peso(r.fees)}</td><td className="num pr-3">{peso(r.shipping)}</td><td className="num pr-3">{peso(r.ads)}</td><td className="num pr-3">{peso(r.cost)}</td><td className="num pr-3">{peso(r.contribution)}</td><td className="num pr-3 font-semibold">{pct(r.marginPct)}</td><td className="num pr-3">{r.suggestedPrice != null ? peso(r.suggestedPrice) : '—'}</td><td className="num">{r.changePct != null ? <span className={r.changePct > 0 ? 'text-brand' : 'text-emerald-700'}>{r.changePct > 0 ? '+' : ''}{pct(r.changePct)}</span> : '—'}</td></tr>)}</tbody></table></Searchable>
      : <Empty>{p.products.length ? 'Every product is on target.' : 'No paid orders in this period yet.'}</Empty>}</div>
  </Card>;
}

function AdSpend({ onSaved }: { onSaved: () => void }) {
  const [f, setF] = useState({ platform: 'TIKTOK', month: today().slice(0, 7), amount: '', accountId: '', reference: '', notes: '' });
  const accts = useQuery({ queryKey: ['ecom-pay-accounts'], queryFn: () => api.get<{ id: string; title: string }[]>('/api/ecommerce/payment-accounts') });
  const ads = useQuery({ queryKey: ['ecom-ads', f.platform], queryFn: () => api.get<{ id: string; month: string; amount: string; paidFrom: string; reference: string | null; notes: string | null }[]>(`/api/ecommerce/${f.platform.toLowerCase()}/ads`) });
  const add = useMutation({ mutationFn: () => api.post(`/api/ecommerce/${f.platform.toLowerCase()}/ads`, { month: f.month, amount: Number(f.amount), paidFromAccountId: f.accountId || null, reference: f.reference || undefined, notes: f.notes || undefined }), onSuccess: () => { setF({ ...f, amount: '', reference: '', notes: '' }); void ads.refetch(); onSaved(); } });
  return <Card title="Ad expenses">
    <div className="grid gap-3 md:grid-cols-6">
      <Field label="Platform"><Select value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>{PLATFORMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
      <Field label="Month"><Input type="month" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} /></Field>
      <Field label="Ad spend (₱)"><Input type="number" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
      <Field label="Paid from"><Select value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}><option value="">Platform balance (deducted from sales)</option>{accts.data?.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</Select></Field>
      <Field label="Reference"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
      <div className="flex items-end"><Button disabled={add.isPending || !(Number(f.amount) > 0)} onClick={() => add.mutate()}>Add ad expense</Button></div>
    </div>
    <ErrorBox error={add.error} />
    <p className="mt-2 text-xs text-slate-500">It is booked as advertising expense for the platform and feeds the analysis above.</p>
    {ads.data?.length ? <div className="sticky-head"><table className="mt-2 w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1 pr-3">Month</th><th className="num pr-3">Amount</th><th className="pr-3">Paid from</th><th>Reference</th></tr></thead><tbody>{ads.data.slice(0, 12).map((a) => <tr key={a.id} className="border-t"><td className="py-1 pr-3">{a.month}</td><td className="num pr-3">{peso(a.amount)}</td><td className="pr-3">{a.paidFrom}</td><td>{a.reference ?? a.notes ?? ''}</td></tr>)}</tbody></table></div> : null}
  </Card>;
}
