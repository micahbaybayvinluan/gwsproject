import { locLabel } from '@/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Select } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';

interface Consignee { id: string; code: string; name: string; active: boolean; agreementId: string | null; priceBasis: string | null; settlementTerms: string | null; contactPerson: string | null; phone: string | null; address: string | null }
interface Item { productId: string; name: string; qty: number; unitPrice?: string }
const BASIS: Record<string, string> = { SRP: 'Retail price (SRP)', CONSIGNEE_PRICE: 'Consignee price list', COST: 'Agreed price (cost based)' };

/** Product search + a list of items with quantities (and prices when `withPrice`). */
function ItemPicker({ items, setItems, withPrice, onAdd, inStockAt }: { items: Item[]; setItems: (x: Item[]) => void; withPrice?: boolean; onAdd?: (productId: string) => void; inStockAt?: string }) {
  const [search, setSearch] = useState('');
  // sending goods out: only what the branch has on hand (owner request 2026-09-30)
  const products = useQuery({ queryKey: ['products', search, inStockAt ?? ''], queryFn: () => api.get<{ id: string; name: string; sku: string; onHand?: number }[]>(`/api/products?search=${encodeURIComponent(search)}&take=20${inStockAt ? `&inStockAt=${inStockAt}` : ''}`), enabled: search.length >= 2 });
  return <div>
    <Input placeholder="Add an item: type the name or SKU…" value={search} onChange={(e) => setSearch(e.target.value)} />
    {search.length >= 2 && <ul className="mt-1 max-h-48 divide-y overflow-auto rounded-xl border bg-white text-sm">{products.data?.map((p) => <li key={p.id}><button className="w-full px-3 py-2 text-left hover:bg-slate-50" onClick={() => { if (!items.some((i) => i.productId === p.id)) { setItems([...items, { productId: p.id, name: p.name, qty: 1 }]); onAdd?.(p.id); } setSearch(''); }}>{p.name} <span className="text-xs text-slate-500">{p.sku}</span></button></li>)}</ul>}
    {items.length > 0 && <table className="mt-3 w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1">Item</th><th className="text-center">Qty</th>{withPrice && <th>Unit price (₱)</th>}<th /></tr></thead><tbody>{items.map((l, i) => <tr key={l.productId} className="border-t">
      <td className="py-2">{l.name}</td>
      <td className="text-center"><Input type="number" min={1} className="mx-auto w-20 text-center" value={l.qty} onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) } : x)))} /></td>
      {withPrice && <td><Input type="number" min={0} step="0.01" className="w-32" placeholder="per agreement" value={l.unitPrice ?? ''} onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, unitPrice: e.target.value } : x)))} /></td>}
      <td className="text-right"><button className="text-red-600" onClick={() => setItems(items.filter((_, k) => k !== i))}>✕</button></td></tr>)}</tbody></table>}
  </div>;
}

/** Consignment: send goods to a consignee, record what they sold, take goods back — each needs the manager and then the Owner. */
export function ConsignmentPage() {
  const { me, can } = useAuth(); const qc = useQueryClient();
  const [tab, setTab] = useState<'send' | 'sales' | 'return' | 'stock'>('send');
  const consignees = useQuery({ queryKey: ['consignees'], queryFn: () => api.get<Consignee[]>('/api/consignment/consignees') });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; type: string }[]>('/api/locations') });
  const mine = me!.locationScoped ? me!.locations : (locations.data ?? []).filter((l) => ['BRANCH', 'WAREHOUSE'].includes(l.type));
  const [cn, setCn] = useState(''); const [loc, setLoc] = useState(me!.locations[0]?.id ?? ''); const [items, setItems] = useState<Item[]>([]);
  const [period, setPeriod] = useState({ from: today(), to: today() }); const [draftId, setDraftId] = useState<{ id: string; controlNo: string } | null>(null); const [msg, setMsg] = useState('');
  const c = consignees.data?.find((x) => x.id === cn);
  const reset = () => { setItems([]); setDraftId(null); };
  const approvalNote = me!.roleKey === 'ADMIN' ? 'You approve it yourself.' : ['SALES_ASSOCIATE', 'WAREHOUSE_ASSOCIATE'].includes(me!.roleKey) ? 'It goes to your manager first, then to the Owner for final approval.' : 'It goes to the Owner for final approval.';
  // goods out / back are transfers: save a draft (printable), then submit
  const saveDraft = useMutation({ mutationFn: () => api.post<{ id: string; controlNo: string }>('/api/transfers', tab === 'send' ? { fromLocationId: loc, toLocationId: cn, transferType: 'CONSIGNMENT_OUT', lines: items.map((i) => ({ productId: i.productId, qty: i.qty })) } : { fromLocationId: cn, toLocationId: loc, transferType: 'CONSIGNMENT_RETURN', lines: items.map((i) => ({ productId: i.productId, qty: i.qty })) }), onSuccess: (r) => setDraftId({ id: r.id, controlNo: r.controlNo }) });
  const submitDraft = useMutation({ mutationFn: () => api.post(`/api/transfers/${draftId!.id}/submit`), onSuccess: () => { setMsg(`${draftId!.controlNo} sent for approval. ${approvalNote}`); reset(); void qc.invalidateQueries({ queryKey: ['csg-out'] }); } });
  // consignee sales: prices pre-filled from the agreement, editable; print a draft before sending
  const prefill = async (productIds: string[]) => {
    if (!c?.agreementId || !productIds.length) return;
    const r = await api.post<{ prices: Record<string, number | null> }>('/api/consignment/sale-reports/prefill', { agreementId: c.agreementId, productIds, date: period.to });
    setItems((xs) => xs.map((x) => (r.prices[x.productId] != null && !x.unitPrice ? { ...x, unitPrice: String(r.prices[x.productId]) } : x)));
  };
  const reportBody = () => ({ agreementId: c!.agreementId, periodFrom: period.from, periodTo: period.to, lines: items.map((i) => ({ productId: i.productId, qty: i.qty, unitPrice: i.unitPrice === undefined || i.unitPrice === '' ? null : Number(i.unitPrice) })) });
  const sendReport = useMutation({ mutationFn: () => api.post<{ pending?: boolean; message?: string }>('/api/consignment/sale-reports', reportBody()), onSuccess: (r) => { setMsg(r.pending ? r.message ?? 'Sent for approval.' : 'Posted: the consignee now owes the amount (AR).'); reset(); void qc.invalidateQueries({ queryKey: ['csg-out'] }); } });
  const summary = useQuery({ queryKey: ['csg-out'], queryFn: () => api.get<{ consignee: { id: string; name: string }; unpaidAr: string; products: { product: { name: string }; qty: number; valueAtCost?: string; valueAtSrp: string; soldToDate: number }[] }[]>('/api/consignment/out-summary'), enabled: tab === 'stock' });
  const hasPrice = items.some((i) => i.unitPrice);
  const total = items.reduce((t, i) => t + (Number(i.unitPrice) || 0) * i.qty, 0);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Consignment</h1>{can('consignment.manage') && <Link className="text-sm text-brand underline" to="/consignees">Consignee accounts</Link>}</div>
    <div className="inline-flex flex-wrap rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">{([['send', '1. Send goods to a consignee'], ['sales', '2. Record consignee sales'], ['return', '3. Goods returned by a consignee'], ['stock', 'Stock at consignees']] as const).map(([k, l]) => <button key={k} onClick={() => { setTab(k); reset(); setMsg(''); }} className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold ${tab === k ? 'bg-navy text-white shadow' : 'text-slate-600 hover:text-navy'}`}>{l}</button>)}</div>
    {msg && <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{msg}</p>}
    {tab !== 'stock' && <Card>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Consignee"><Select value={cn} onChange={(e) => { setCn(e.target.value); reset(); }}><option value="">— choose —</option>{consignees.data?.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
        {tab !== 'sales' && <Field label={tab === 'send' ? 'Send from' : 'Returned to'}><Select value={loc} onChange={(e) => { setLoc(e.target.value); setDraftId(null); }}><option value="">— choose —</option>{mine.map((l) => <option key={l.id} value={l.id}>{locLabel(l)}</option>)}</Select></Field>}
        {tab === 'sales' && <><Field label="Sold from"><Input type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} /></Field><Field label="Sold until"><Input type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} /></Field></>}
      </div>
      {c && <p className="mt-2 text-xs text-slate-500">{c.name}{c.priceBasis ? ` · pays at ${BASIS[c.priceBasis] ?? c.priceBasis}` : ''}{c.settlementTerms ? ` · ${c.settlementTerms}` : ''}</p>}
      {cn && (tab !== 'sales' ? loc : true) && !draftId && <div className="mt-4"><ItemPicker items={items} setItems={setItems} inStockAt={tab === 'send' ? loc : undefined} withPrice={tab === 'sales'} onAdd={tab === 'sales' ? (id) => void prefill([id]) : undefined} /></div>}
      {tab === 'sales' && items.length > 0 && <p className="mt-2 text-sm">Prices are filled in from the agreement; you may change them.{hasPrice ? <> Total <b>{peso(total)}</b>.</> : ''}</p>}
      {tab !== 'sales' && !draftId && items.length > 0 && <div className="mt-4 flex gap-2"><Button disabled={!loc || saveDraft.isPending} onClick={() => saveDraft.mutate()}>Save draft</Button></div>}
      {draftId && <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm"><Badge tone="amber">Draft {draftId.controlNo}</Badge><Button variant="outline" onClick={() => api.download(`/api/reports/forms/pull-out/${draftId.id}.pdf`, `Consignment-${draftId.controlNo}-DRAFT.pdf`)}>Print draft</Button><Button disabled={submitDraft.isPending} onClick={() => submitDraft.mutate()}>Submit for approval</Button><span className="text-xs text-slate-500">{approvalNote}</span></div>}
      {tab === 'sales' && items.length > 0 && <div className="mt-4 flex flex-wrap items-center gap-2"><Button variant="outline" onClick={() => api.downloadPost('/api/consignment/sale-reports/draft', reportBody(), 'ConsigneeSales-DRAFT.pdf')}>Print draft</Button><Button disabled={sendReport.isPending} onClick={() => sendReport.mutate()}>{me!.roleKey === 'ADMIN' ? 'Post consignee sales' : 'Submit for approval'}</Button><span className="text-xs text-slate-500">{approvalNote}</span></div>}
      <ErrorBox error={saveDraft.error || submitDraft.error || sendReport.error} />
      {!consignees.data?.length && <Empty>No consignee accounts yet. The Owner creates them under Catalogue → Consignees.</Empty>}
    </Card>}
    {tab === 'stock' && (summary.data?.length ? summary.data.map((s) => <Card key={s.consignee.id} title={<span>{s.consignee.name} <span className="text-sm font-normal text-slate-500">· still owes {peso(s.unpaidAr)}</span></span>}>
      <DataTable data={s.products} columns={[{ header: 'Item', accessorFn: (r) => r.product.name }, { header: 'Qty at consignee', accessorKey: 'qty' }, { header: 'Sold to date', accessorKey: 'soldToDate' }, { header: 'Value at SRP', accessorFn: (r) => peso(r.valueAtSrp) }, ...(can('cost.view') ? [{ header: 'Value at cost', accessorFn: (r: { valueAtCost?: string }) => peso(r.valueAtCost ?? 0) }] : [])]} />
    </Card>) : <Card><Empty>No stock at consignees.</Empty></Card>)}
  </div>;
}

/** Catalogue → Consignees: the Owner creates consignee accounts in one step. */
export function ConsigneesPage() {
  const { me } = useAuth(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['consignees'], queryFn: () => api.get<Consignee[]>('/api/consignment/consignees') });
  const blank = { name: '', code: '', contactPerson: '', phone: '', address: '', priceBasis: 'SRP', settlementDays: '30', notes: '' };
  const [f, setF] = useState(blank); const [done, setDone] = useState('');
  const create = useMutation({ mutationFn: () => api.post<{ name: string; code: string }>('/api/consignment/consignees', { ...f, code: f.code || undefined, settlementDays: f.settlementDays ? Number(f.settlementDays) : undefined }), onSuccess: (r) => { setDone(`${r.name} (${r.code}) created. Staff can now send goods to it under Consignment.`); setF(blank); void qc.invalidateQueries({ queryKey: ['consignees'] }); } });
  return <div className="space-y-4">
    <h1 className="text-2xl font-bold tracking-tight text-navy">Consignees</h1>
    {me!.roleKey === 'ADMIN' && <Card title="New consignee">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Anytime Fitness Katipunan" /></Field>
        <Field label="Code (optional)" hint="Made from the name if empty"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="Pays at"><Select value={f.priceBasis} onChange={(e) => setF({ ...f, priceBasis: e.target.value })}>{Object.entries(BASIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Contact person"><Input value={f.contactPerson} onChange={(e) => setF({ ...f, contactPerson: e.target.value })} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Pays within (days)"><Input type="number" min={0} value={f.settlementDays} onChange={(e) => setF({ ...f, settlementDays: e.target.value })} /></Field>
        <Field label="Address" className="md:col-span-2"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="Notes"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <div className="mt-3 flex items-center gap-2"><Button disabled={f.name.trim().length < 2 || create.isPending} onClick={() => create.mutate()}>Create consignee</Button><span className="text-xs text-slate-500">Creates the consignee's stock location, customer and receivable account, and the agreement.</span></div>
      <ErrorBox error={create.error} />{done && <p className="mt-2 text-sm text-emerald-700">{done}</p>}
    </Card>}
    <ConsignorsCard />
    <Card title="Consignees">{q.data?.length ? <DataTable data={q.data} columns={[{ header: 'Code', accessorKey: 'code' }, { header: 'Name', accessorKey: 'name' }, { header: 'Pays at', accessorFn: (r) => (r.priceBasis ? BASIS[r.priceBasis] ?? r.priceBasis : '—') }, { header: 'Terms', accessorFn: (r) => r.settlementTerms ?? '' }, { header: 'Contact', accessorFn: (r) => [r.contactPerson, r.phone].filter(Boolean).join(' · ') }, { header: 'Address', accessorFn: (r) => r.address ?? '' }, { header: 'Active', accessorFn: (r) => (r.active ? 'yes' : 'no') }]} /> : <Empty>No consignees yet.</Empty>}</Card>
  </div>;
}

/** Goods suppliers leave with GWS on consignment (IN): the agreement and what GWS owes them for what was sold. */
function ConsignorsCard() {
  const qc = useQueryClient(); const { can } = useAuth();
  const agreements = useQuery({ queryKey: ['agreements'], queryFn: () => api.get<{ id: string; direction: string; valuationBasis: string; supplier: { code: string; name?: string } | null }[]>('/api/consignment/agreements') });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<{ id: string; code: string; supplierName?: string; name?: string }[]>('/api/suppliers') });
  const [sup, setSup] = useState(''); const [range, setRange] = useState({ from: today().slice(0, 8) + '01', to: today() });
  const add = useMutation({ mutationFn: () => api.post('/api/consignment/agreements', { direction: 'IN', supplierId: sup, valuationBasis: 'COST' }), onSuccess: () => { setSup(''); void qc.invalidateQueries({ queryKey: ['agreements'] }); } });
  const settle = useQuery({ queryKey: ['csg-in', range], queryFn: () => api.get<{ supplier: { code: string; name?: string } | null; qtySold: number; costPayable: string }[]>(`/api/consignment/in-settlement?from=${range.from}&to=${range.to}`), enabled: can('cost.view') });
  const ins = agreements.data?.filter((a) => a.direction === 'IN') ?? [];
  return <Card title="Consigned to us by suppliers (IN)">
    <p className="text-sm text-slate-600">Suppliers whose goods GWS sells on consignment: GWS pays them only for what is sold.</p>
    <ul className="mt-2 text-sm">{ins.length ? ins.map((a) => <li key={a.id}>• {a.supplier?.name ?? a.supplier?.code}</li>) : <li className="text-slate-500">none yet</li>}</ul>
    <div className="mt-3 flex flex-wrap items-end gap-2"><Field label="Add a consignor supplier"><Select value={sup} onChange={(e) => setSup(e.target.value)}><option value="">— choose —</option>{suppliers.data?.map((x) => <option key={x.id} value={x.id}>{x.supplierName ?? x.name ?? x.code}</option>)}</Select></Field><Button disabled={!sup || add.isPending} onClick={() => add.mutate()}>Add</Button></div>
    {can('cost.view') && <div className="mt-4"><div className="flex flex-wrap items-end gap-2"><Field label="Sold from"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field><Field label="Until"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field></div>
      <table className="mt-2 w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th>Supplier</th><th className="num">Qty sold</th><th className="num">GWS owes (at cost)</th></tr></thead><tbody>{settle.data?.map((r, i) => <tr key={i} className="border-t"><td className="py-1">{r.supplier?.name ?? r.supplier?.code ?? '—'}</td><td className="num">{r.qtySold}</td><td className="num">{peso(r.costPayable)}</td></tr>)}</tbody></table></div>}
    <ErrorBox error={add.error} />
  </Card>;
}
