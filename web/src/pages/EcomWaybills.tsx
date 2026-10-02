import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, peso, today } from '@/lib/api';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Select, Stat } from '@/components/ui/primitives';
import { Segmented } from '@/components/ui/widgets';
import { Searchable } from '@/components/Searchable';

interface Row { id: string; platform: string; platformName: string; orderId: string; trackingNo: string | null; qty: number; weightG: number | null; uploaded: string; product: { id: string; sku: string; name: string } | null; guessed: boolean; unitSrp: number | null; priceFrom: string | null; srp: number | null; commission: number | null; transactionFee: number | null; affiliateFee: number | null; shippingFee: number | null; fees: number | null; income: number | null }
interface Rates { commissionPct: number; transactionPct: number; affiliatePct: number; shippingPerOrder: number }
interface Report { rows: Row[]; totals: { waybills: number; priced: number; unassigned: number; srp: number; fees: number; income: number; commission: number; transactionFee: number; affiliateFee: number; shippingFee: number }; byPlatform: { platform: string; name: string; waybills: number; priced: number; srp: number; fees: number; income: number }[]; rates: { platform: string; name: string; rates: Rates; actual: (Rates & { basedOn: number }) | null }[] }
interface Product { id: string; sku: string; name: string }
const PLATFORMS: [string, string][] = [['', 'All'], ['TIKTOK', 'TikTok'], ['SHOPEE', 'Shopee'], ['LAZADA', 'Lazada']];
const monthStart = () => `${today().slice(0, 7)}-01`;

/** Waybill report (owner request 2026-09-30): upload the shipping labels; choose the product once; get the SRP, fees and order income per order and in total. */
export function EcomWaybillsPage() {
  const qc = useQueryClient(); const file = useRef<HTMLInputElement>(null);
  const [platform, setPlatform] = useState(''); const [from, setFrom] = useState(monthStart()); const [to, setTo] = useState(today()); const [open, setOpen] = useState(false);
  const qs = new URLSearchParams({ ...(platform ? { platform } : {}), from, to, ...(open ? { open: '1' } : {}) }).toString();
  const q = useQuery({ queryKey: ['waybills', qs], queryFn: () => api.get<Report>(`/api/ecommerce-waybills?${qs}`) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['waybills'] });
  const up = useMutation({ mutationFn: (files: File[]) => api.uploadMany<{ added: number; duplicates: number; guessed: number; unreadable: { file: string; pages: number[] }[]; failed: string[] }>('/api/ecommerce-waybills/upload', files), onSuccess: refresh });
  const confirmAll = useMutation({ mutationFn: (ids: string[]) => api.post('/api/ecommerce-waybills/confirm', { ids }), onSuccess: refresh });
  const r = q.data; const guessedIds = (r?.rows ?? []).filter((x) => x.guessed).map((x) => x.id);
  return <div className="space-y-4">
    <h1 className="text-2xl font-extrabold tracking-tight text-navy">Waybill Report</h1>
    <Card title="Upload waybills">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => file.current?.click()} disabled={up.isPending}>{up.isPending ? 'Reading the labels…' : 'Choose waybill PDF files'}</Button>
        <input ref={file} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => { const fs = [...(e.target.files ?? [])]; if (fs.length) up.mutate(fs); e.target.value = ''; }} />
        <span className="text-sm text-slate-500">TikTok, Shopee and Lazada shipping labels, one label per page. You can pick many files at once.</span>
      </div>
      {up.data && <div className="mt-3 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-900">Read {up.data.added} new waybill{up.data.added === 1 ? '' : 's'}{up.data.duplicates ? `; ${up.data.duplicates} were uploaded before and skipped` : ''}{up.data.guessed ? `; ${up.data.guessed} got their product from the weight (please confirm)` : ''}.
        {up.data.unreadable.length > 0 && <div className="text-amber-800">Could not read: {up.data.unreadable.map((u) => `${u.file} page ${u.pages.join(', ')}`).join('; ')}.</div>}{up.data.failed.length > 0 && <div className="text-red-700">Not a readable PDF: {up.data.failed.join(', ')}.</div>}</div>}
      <ErrorBox error={up.error} />
      <p className="mt-2 text-xs text-slate-500">A label shows the order, tracking number, quantity and weight, not the product or price. Choose the product once per order (the same weight on the same platform is filled in next time); the SRP comes from the platform price list.</p>
    </Card>
    <Card>
      <div className="flex flex-wrap items-end gap-3">
        <Segmented value={platform} onChange={setPlatform} options={PLATFORMS} />
        <Field label="Uploaded from"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="to"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} /> only waybills without a product</label>
        <span className="ml-auto flex gap-2">{guessedIds.length > 0 && <Button variant="outline" disabled={confirmAll.isPending} onClick={() => confirmAll.mutate(guessedIds)}>Confirm the {guessedIds.length} suggested products</Button>}<Button variant="outline" onClick={() => api.download(`/api/ecommerce-waybills/export.xlsx?${qs}`, `Waybill-report-${today()}.xlsx`)}>Download Excel</Button></span>
      </div>
    </Card>
    {r && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Stat label="Waybills" value={r.totals.waybills} sub={r.totals.unassigned ? `${r.totals.unassigned} still need a product` : 'all have a product'} tone={r.totals.unassigned ? 'amber' : 'green'} />
      <Stat label="SRP (total)" value={peso(r.totals.srp)} sub="platform price list" /><Stat label="Platform fees" value={peso(r.totals.fees)} sub={`commission ${peso(r.totals.commission)} · transaction ${peso(r.totals.transactionFee)} · affiliate ${peso(r.totals.affiliateFee)} · shipping ${peso(r.totals.shippingFee)}`} tone="amber" />
      <Stat label="Total order income" value={peso(r.totals.income)} sub="SRP less fees" tone="green" /><Stat label="Fees as % of SRP" value={r.totals.srp ? `${((r.totals.fees / r.totals.srp) * 100).toFixed(2)}%` : '—'} />
    </div>}
    {r && r.byPlatform.length > 1 && <Card title="Per platform"><div className="overflow-x-auto"><div className="sticky-head"><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1">Platform</th><th className="num">Waybills</th><th className="num">With product</th><th className="num">SRP</th><th className="num">Fees</th><th className="num">Order income</th></tr></thead><tbody>{r.byPlatform.map((p) => <tr key={p.platform} className="border-t"><td className="py-1.5 font-medium">{p.name}</td><td className="num">{p.waybills}</td><td className="num">{p.priced}</td><td className="num">{peso(p.srp)}</td><td className="num">{peso(p.fees)}</td><td className="num font-semibold">{peso(p.income)}</td></tr>)}</tbody></table></div></div></Card>}
    <Card title="Waybills">
      {q.isLoading ? <Empty>Loading…</Empty> : r?.rows.length ? <div className="overflow-x-auto"><Searchable><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1 pr-3">Platform</th><th className="pr-3">Order / tracking</th><th className="pr-3">Product</th><th className="pr-3">Qty</th><th className="num pr-3">SRP each</th><th className="num pr-3">SRP total</th><th className="num pr-3">Fees</th><th className="num pr-3">Order income</th><th /></tr></thead>
        <tbody>{r.rows.map((x) => <WaybillRow key={x.id} row={x} onChanged={refresh} />)}</tbody></table></Searchable></div> : <Empty>No waybills yet: upload the labels above.</Empty>}
    </Card>
    {r && <Card title="Platform fee rates used"><p className="mb-3 text-sm text-slate-600">Fees are worked out at these rates on the SRP. “Use actual” copies what the platform really charged, from the payout files Accounting posted.</p>
      <div className="grid gap-4 lg:grid-cols-3">{r.rates.map((p) => <RatesForm key={p.platform} p={p} onSaved={refresh} />)}</div></Card>}
  </div>;
}

function WaybillRow({ row: x, onChanged }: { row: Row; onChanged: () => void }) {
  const [edit, setEdit] = useState(false); const [search, setSearch] = useState('');
  const prods = useQuery({ queryKey: ['wb-products', search], queryFn: () => api.get<Product[]>(`/api/products?search=${encodeURIComponent(search)}&take=8&ecomFirst=1`), enabled: edit && search.length >= 2 });
  const set = useMutation({ mutationFn: (b: { productId?: string | null; qty?: number }) => api.patch(`/api/ecommerce-waybills/${x.id}`, b), onSuccess: () => { setEdit(false); setSearch(''); onChanged(); } });
  const del = useMutation({ mutationFn: () => api.delete(`/api/ecommerce-waybills/${x.id}`), onSuccess: onChanged });
  return <tr className="border-t align-top">
    <td className="py-2 pr-3"><Badge tone={x.platform === 'TIKTOK' ? 'slate' : x.platform === 'SHOPEE' ? 'amber' : 'blue'}>{x.platformName}</Badge><div className="mt-1 text-xs text-slate-500">{x.uploaded}</div></td>
    <td className="pr-3"><div className="font-medium">{x.orderId}</div><div className="text-xs text-slate-500">{x.trackingNo}{x.weightG != null ? ` · ${x.weightG} g` : ''}</div></td>
    <td className="pr-3">{edit || !x.product ? <div className="w-64"><Input autoFocus={edit} placeholder="Find the product…" value={search} onChange={(e) => { setSearch(e.target.value); setEdit(true); }} />
      {prods.data && search.length >= 2 && <ul className="mt-1 max-h-48 overflow-auto rounded-2xl bg-white shadow-card">{prods.data.map((p) => <li key={p.id}><button className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => set.mutate({ productId: p.id })}>{p.name}<span className="ml-1 text-xs text-slate-500">{p.sku}</span></button></li>)}{!prods.data.length && <li className="px-3 py-2 text-xs text-slate-500">No product found.</li>}</ul>}</div>
      : <div><button className="text-left font-medium hover:underline" onClick={() => setEdit(true)} title="Change the product">{x.product.name}</button>{x.guessed && <div className="flex items-center gap-1"><Badge tone="amber">from the weight: confirm</Badge><button className="text-xs text-brand underline" onClick={() => set.mutate({ productId: x.product!.id })}>Confirm</button></div>}{x.priceFrom === 'RETAIL' && <div className="text-xs text-amber-700">no {x.platformName} price set: SRP used</div>}</div>}</td>
    <td className="pr-3"><Input className="w-16" type="number" min={1} value={x.qty} onChange={(e) => { const n = Number(e.target.value); if (n >= 1) set.mutate({ qty: n }); }} aria-label="Quantity" /></td>
    <td className="num pr-3">{x.unitSrp != null ? peso(x.unitSrp) : '—'}</td><td className="num pr-3">{x.srp != null ? peso(x.srp) : '—'}</td><td className="num pr-3">{x.fees != null ? peso(x.fees) : '—'}</td><td className="num pr-3 font-semibold">{x.income != null ? peso(x.income) : '—'}</td>
    <td><button className="text-xs text-slate-400 hover:text-brand" onClick={() => { if (window.confirm('Remove this waybill from the report?')) del.mutate(); }} aria-label="Remove">✕</button></td></tr>;
}

function RatesForm({ p, onSaved }: { p: Report['rates'][number]; onSaved: () => void }) {
  const [f, setF] = useState<Record<keyof Rates, string>>({ commissionPct: String(p.rates.commissionPct), transactionPct: String(p.rates.transactionPct), affiliatePct: String(p.rates.affiliatePct), shippingPerOrder: String(p.rates.shippingPerOrder) });
  const save = useMutation({ mutationFn: () => api.put(`/api/ecommerce-waybills/rates/${p.platform}`, { commissionPct: Number(f.commissionPct), transactionPct: Number(f.transactionPct), affiliatePct: Number(f.affiliatePct), shippingPerOrder: Number(f.shippingPerOrder) }), onSuccess: onSaved });
  const set = (k: keyof Rates, v: string) => setF({ ...f, [k]: v });
  const allZero = Object.values(p.rates).every((v) => !v);
  return <div className="rounded-2xl bg-slate-50 p-4 shadow-inset">
    <div className="mb-2 flex items-center gap-2 font-bold text-navy">{p.name}{allZero && <Badge tone="amber">no rates set</Badge>}</div>
    <div className="grid grid-cols-2 gap-2">{([['commissionPct', 'Commission %'], ['transactionPct', 'Transaction %'], ['affiliatePct', 'Affiliate %'], ['shippingPerOrder', 'Shipping per order ₱']] as const).map(([k, l]) => <Field key={k} label={l}><Input type="number" step="0.01" value={f[k]} onChange={(e) => set(k, e.target.value)} /></Field>)}</div>
    <div className="mt-2 flex flex-wrap gap-2"><Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Save rates</Button>{p.actual && <Button size="sm" variant="outline" onClick={() => setF({ commissionPct: String(p.actual!.commissionPct), transactionPct: String(p.actual!.transactionPct), affiliatePct: String(p.actual!.affiliatePct), shippingPerOrder: String(p.actual!.shippingPerOrder) })}>Use actual ({p.actual.basedOn} paid orders)</Button>}</div>
    <ErrorBox error={save.error} />
  </div>;
}
