import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, peso } from '@/lib/api';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Select } from '@/components/ui/primitives';
import { Searchable } from '@/components/Searchable';

interface Row { id: string; sku: string; name: string; brand: string | null; retail: string | null; cc: string | null; tiktok: string | null; shopee: string | null; lazada: string | null }
type Tier = 'TIKTOK' | 'SHOPEE' | 'LAZADA' | 'CC';
const COLS: { key: 'tiktok' | 'shopee' | 'lazada' | 'cc'; tier: Tier; label: string }[] = [{ key: 'cc', tier: 'CC', label: 'Credit card' }, { key: 'tiktok', tier: 'TIKTOK', label: 'TikTok' }, { key: 'shopee', tier: 'SHOPEE', label: 'Shopee' }, { key: 'lazada', tier: 'LAZADA', label: 'Lazada' }];

/** Admin only (owner request 2026-09-30): the credit-card price rule and the TikTok / Shopee / Lazada price lists, edited any time. Every amount is kept to the centavo. */
export function EcomPricesPage() {
  const qc = useQueryClient(); const file = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState(''); const [edits, setEdits] = useState<Record<string, string>>({});
  const list = useQuery({ queryKey: ['ecom-prices', q], queryFn: () => api.get<Row[]>(`/api/pricing/ecom?q=${encodeURIComponent(q)}`) });
  const cc = useQuery({ queryKey: ['cc-markup'], queryFn: () => api.get<{ pct: number; method: string }>('/api/pricing/cc-markup') });
  const [ccForm, setCcForm] = useState<{ pct: string; method: string } | null>(null);
  const f = ccForm ?? { pct: String(cc.data?.pct ?? 4), method: cc.data?.method ?? 'GROSS_UP' };
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['ecom-prices'] }); void qc.invalidateQueries({ queryKey: ['cc-markup'] }); setEdits({}); };
  const saveCc = useMutation({ mutationFn: () => api.put('/api/pricing/cc-markup', { pct: Number(f.pct), method: f.method }), onSuccess: () => { setCcForm(null); refresh(); } });
  const save = useMutation({ mutationFn: () => api.put<{ changed: number }>('/api/pricing/ecom', { rows: Object.entries(edits).map(([k, v]) => { const [productId, tier] = k.split(':'); return { productId, tier, price: v.trim() === '' ? null : Number(v) }; }) }), onSuccess: refresh });
  const imp = useMutation({ mutationFn: (x: File) => api.upload<{ rows: number; matched: number; changed: number; notFound: string[] }>('/api/pricing/ecom/import', x), onSuccess: refresh });
  const rows = list.data ?? []; const dirty = Object.keys(edits).length;
  const shown = (r: Row, c: (typeof COLS)[number]) => edits[`${r.id}:${c.tier}`] ?? (r[c.key] ?? '');
  return <div className="space-y-4">
    <h1 className="text-2xl font-bold tracking-tight text-navy">E-commerce & Credit-card Prices</h1>
    <Card title="Credit-card price">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Card fee %"><Input className="w-24" type="number" step="0.01" value={f.pct} onChange={(e) => setCcForm({ ...f, pct: e.target.value })} /></Field>
        <Field label="How it is applied"><Select value={f.method} onChange={(e) => setCcForm({ ...f, method: e.target.value })}><option value="GROSS_UP">SRP ÷ (1 − %) — recovers the card fee (as in the price memo)</option><option value="ADD">SRP + % — simple markup</option></Select></Field>
        <Button disabled={saveCc.isPending || !ccForm} onClick={() => saveCc.mutate()}>Save</Button>
      </div>
      <p className="mt-2 text-xs text-slate-500">Sales paid by credit card use this price automatically. Example at SRP ₱1,250.00: {f.method === 'ADD' ? peso(1250 * (1 + Number(f.pct) / 100)) : peso(1250 / (1 - Number(f.pct) / 100))}. A product can have its own credit-card price typed in the table below; it then wins over the rule.</p>
      <ErrorBox error={saveCc.error} />
    </Card>
    <Card title="Platform prices">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Find a product"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="name or SKU" /></Field>
        <Button variant="outline" onClick={() => file.current?.click()} disabled={imp.isPending}>Import the masterlist (.xlsx)</Button>
        <input ref={file} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const x = e.target.files?.[0]; if (x) imp.mutate(x); e.target.value = ''; }} />
        <span className="ml-auto flex items-center gap-2">{dirty > 0 && <Badge tone="amber">{dirty} changed</Badge>}<Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>Save prices</Button></span>
      </div>
      {imp.data && <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 p-2 text-sm">Masterlist read: {imp.data.rows} rows, {imp.data.matched} matched to products, {imp.data.changed} prices changed.{imp.data.notFound.length > 0 && <details className="mt-1"><summary className="cursor-pointer text-amber-800">{imp.data.notFound.length} names were not found in the product list (set them by hand, or add the product first)</summary><ul className="ml-4 list-disc text-xs">{imp.data.notFound.map((n) => <li key={n}>{n}</li>)}</ul></details>}</div>}
      <ErrorBox error={imp.error ?? save.error} />
      {rows.length ? <div className="mt-3 overflow-x-auto"><Searchable><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1 pr-3">Product</th><th className="num pr-3">SRP</th>{COLS.map((c) => <th key={c.key} className="num pr-3">{c.label}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id} className="border-t"><td className="py-1.5 pr-3"><div className="font-medium">{r.name}</div><div className="text-xs text-slate-500">{r.sku}</div></td><td className="num pr-3">{r.retail ? peso(r.retail) : '—'}</td>
          {COLS.map((c) => <td key={c.key} className="pr-3"><Input className="num w-28" type="number" step="0.01" value={shown(r, c)} placeholder={c.key === 'lazada' ? 'as Shopee' : undefined} onChange={(e) => setEdits({ ...edits, [`${r.id}:${c.tier}`]: e.target.value })} aria-label={`${c.label} price of ${r.name}`} /></td>)}</tr>)}</tbody></table></Searchable></div>
        : <Empty>No products.</Empty>}
      <p className="mt-2 text-xs text-slate-500">Prices apply from today. Empty Lazada prices follow Shopee. Clearing a box removes the price typed today. The Owner alone can change these; Accounting, the Head Auditor and the E-comm Associate are notified.</p>
    </Card>
  </div>;
}
