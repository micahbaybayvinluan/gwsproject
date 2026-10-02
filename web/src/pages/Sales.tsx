import { locLabel } from '@/lib/utils';
import { ApprovalTimeline } from '@/components/ApprovalTimeline';
import { History, CorrectionRequest } from '@/components/DocEdits';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, fmtDate, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, Select, Textarea, statusTone } from '@/components/ui/primitives';
import { BatchChooser, batchText, loadBatches, type BatchOpt } from '@/components/BatchPicker';
import { DataTable } from '@/components/ui/table';
import { Attachments } from '@/components/Attachments';

type Product = { id: string; sku: string; name: string; tierPrices: Record<string, string>; category: { accountingClass: string }; onHand?: number; isBundle?: boolean };
type Line = { productId: string; name: string; qty: number; unitPrice: number | null; tierPrice: number | null; isFreebie: boolean; plastic?: boolean; batchId?: string | null; batchLabel?: string; maxQty?: number; tierPrices?: Record<string, string>; supplement?: boolean };
const CHANNELS = ['WALK_IN', 'DELIVERY', 'SHIPPING_COURIER', 'SHIPPING_MARKETPLACE', 'FRANCHISE', 'DEALER', 'AGENT', 'PERSONAL', 'OTHER'];
const TIER: Record<string, string> = { WALK_IN: 'RETAIL', DELIVERY: 'RETAIL', SHIPPING_COURIER: 'RETAIL', SHIPPING_MARKETPLACE: 'RETAIL', FRANCHISE: 'FRANCHISE', DEALER: 'DEALER', AGENT: 'AGENT', PERSONAL: 'RETAIL', OTHER: 'RETAIL' };

/** §8.1 New Sale — phone-first: search product, qty, tier auto by channel, editable price (→ SPECIAL_PRICE), proof upload for ONLINE/CC. */
export function NewSalePage() {
  const { me, can } = useAuth(); const nav = useNavigate(); const qc = useQueryClient();
  const [inc, setInc] = useState<{ open: boolean; amount: string; payee: string; kind: 'SALES' | 'RIDER' }>({ open: false, amount: '', payee: '', kind: 'SALES' });
  const loc = me!.locations[0];
  const [locationId, setLocationId] = useState(loc?.id ?? '');
  // a Franchise Coordinator records sales from the warehouse: franchises and every other channel (owner requests 2026-10-01, 2026-10-02)
  const warehouseOnly = !can('sale.create');
  const [channel, setChannel] = useState('WALK_IN'); const [channelSub, setChannelSub] = useState(''); const [paymentMode, setPaymentMode] = useState('CASH');
  // shipping charged to a franchise: none / to follow (the Franchise Coordinator fills it in within 2 days) / typed now; it becomes its own franchise invoice
  const [ship, setShip] = useState<{ mode: 'NONE' | 'TO_FOLLOW' | 'AMOUNT'; amount: string; courier: string; reference: string }>({ mode: 'TO_FOLLOW', amount: '', courier: '', reference: '' });
  const [drSiNo, setDrSiNo] = useState(''); const [search, setSearch] = useState(''); const [lines, setLines] = useState<Line[]>([]);
  // AR: which kind of customer is picked (a Dealer sale lists dealers only, a Franchise sale franchisees only); a PDC only when ticked
  const [sixPack, setSixPack] = useState(false); const [custType, setCustType] = useState(''); const [withPdc, setWithPdc] = useState(false);
  const [hdr, setHdr] = useState<Record<string, string>>({ deliveryFee: '', riderIncentive: '', shippingFee: '', shippingExpense: '', marketplaceCharges: '', dueDate: '', notes: '' });
  const [draftId] = useState(() => crypto.randomUUID()); const [proofId, setProofId] = useState<string | null>(null);
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; isSelling: boolean; type?: string }[]>('/api/locations'), enabled: !me!.locationScoped });
  // the Franchise Coordinator sells from the warehouse
  useEffect(() => { if (warehouseOnly && !locationId && locations.data) { const w = locations.data.find((l) => l.isSelling && l.type === 'WAREHOUSE'); if (w) setLocationId(w.id); } }, [warehouseOnly, locationId, locations.data]);
  // only what this branch has on hand (owner request 2026-09-30): 0 stock is not offered
  const products = useQuery({ queryKey: ['products', search, 'in-stock', locationId], queryFn: () => api.get<Product[]>(`/api/products?search=${encodeURIComponent(search)}&take=30&inStockAt=${locationId}`), enabled: search.length >= 2 && !!locationId });
  const customers = useQuery({ queryKey: ['customers'], queryFn: () => api.get<{ id: string; name: string; type: string }[]>('/api/customers') });
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/agents') });
  const riders = useQuery({ queryKey: ['riders', locationId], queryFn: () => api.get<{ id: string; name: string }[]>(`/api/riders?locationId=${locationId}`), enabled: !!locationId });
  const payAccts = useQuery({ queryKey: ['payment-accounts', locationId], queryFn: () => api.get<{ id: string; title: string; paymentAccountType: string }[]>(`/api/accounts/payment?locationId=${locationId}`), enabled: paymentMode === 'ONLINE' || paymentMode === 'CREDIT_CARD' });
  // price list: agent sale → Agent; a marketplace channel → that platform's list; paid by credit card → the credit-card price (owner request 2026-09-30)
  const platform = channel === 'SHIPPING_MARKETPLACE' && ['TIKTOK', 'SHOPEE', 'LAZADA'].includes(channelSub.toUpperCase()) ? channelSub.toUpperCase() : null;
  const tier = hdr.agentId && channel !== 'AGENT' ? 'AGENT' : platform ?? (paymentMode === 'CREDIT_CARD' && TIER[channel] === 'RETAIL' ? 'CC' : TIER[channel]);
  const stickerCount = lines.filter((l) => l.supplement && !l.isFreebie).reduce((t, l) => t + l.qty, 0);
  const sixPackReady = stickerCount > 0 && (hdr.customerName ?? '').trim().length >= 3 && (hdr.customerPhone ?? '').replace(/\D/g, '').length >= 10;
  // lines already added follow the list when it changes (unless the price was typed by hand)
  // plastic bags: priced only on a franchise sale (its franchise price); free for stores and other customers unless the price is typed because it was sold
  const plasticPrice = (tp: Record<string, string> | undefined, t: string) => (t === 'FRANCHISE' && tp?.FRANCHISE != null ? Number(tp.FRANCHISE) : 0);
  useEffect(() => { setLines((ls) => ls.map((l) => { if (l.plastic) { const np = plasticPrice(l.tierPrices, tier); return l.tierPrice === np ? l : { ...l, tierPrice: np, unitPrice: l.unitPrice === l.tierPrice ? np : l.unitPrice }; } const tp = l.tierPrices?.[tier] != null ? Number(l.tierPrices[tier]) : null; if (l.isFreebie || tp == null || l.tierPrice === tp) return l; return { ...l, tierPrice: tp, unitPrice: l.unitPrice === l.tierPrice ? tp : l.unitPrice }; })); }, [tier]);
  // flavor / expiry: each batch of the SKU is chosen on screen and sold from that batch only (owner request 2026-09-30)
  const [choosing, setChoosing] = useState<{ p: Product; batches: BatchOpt[] } | null>(null); const [picking, setPicking] = useState(false); const [review, setReview] = useState(false);
  const pushLine = (p: Product, b?: BatchOpt) => {
    const plastic = p.category.accountingClass === 'PLASTIC'; const tp = plastic ? plasticPrice(p.tierPrices, tier) : p.tierPrices[tier] != null ? Number(p.tierPrices[tier]) : null; const freebie = p.category.accountingClass === 'FREEBIE';
    setLines((ls) => { const i = ls.findIndex((x) => x.productId === p.id && (x.batchId ?? null) === (b?.batchId ?? null)); if (i >= 0) return ls.map((x, k) => (k === i ? { ...x, qty: x.qty + 1 } : x));
      return [...ls, { productId: p.id, name: p.name, qty: 1, unitPrice: freebie ? 0 : tp, tierPrice: tp, isFreebie: freebie, plastic, supplement: p.category.accountingClass === 'SUPPLEMENT', tierPrices: p.tierPrices, batchId: b?.batchId ?? null, batchLabel: b ? batchText(b) : undefined, maxQty: b?.qty ?? p.onHand }]; });
    setSearch(''); setChoosing(null);
  };
  const add = async (p: Product) => {
    if (p.isBundle) return pushLine(p);
    setPicking(true);
    try { const bs = await loadBatches(p.id, locationId); if (bs.length <= 1) pushLine(p, bs[0]); else { setChoosing({ p, batches: bs }); setSearch(''); } } finally { setPicking(false); }
  };
  const total = useMemo(() => lines.reduce((s, l) => s + (l.unitPrice ?? 0) * l.qty, 0) + Number(hdr.deliveryFee || 0) + Number(hdr.shippingFee || 0), [lines, hdr]);
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/api/sales', { locationId, channel, channelSub: channelSub || null, paymentMode, drSiNo, customerId: hdr.customerId || null, agentId: hdr.agentId || null, riderId: hdr.riderId || null, customerName: hdr.customerName || null, customerPhone: hdr.customerPhone || null, customerEmail: hdr.customerEmail || null, paymentAccountId: hdr.paymentAccountId || null, proofOfPaymentAttachmentId: proofId, cardMid: hdr.cardMid, cardSlipNo: hdr.cardSlipNo, cardApprovalCode: hdr.cardApprovalCode, cardBatchNo: hdr.cardBatchNo, deliveryFee: Number(hdr.deliveryFee || 0), riderIncentive: Number(hdr.riderIncentive || 0), incentive: inc.open && Number(inc.amount) > 0 ? { amount: Number(inc.amount), payee: inc.payee, kind: inc.kind } : null, sixPackSticker: sixPack, franchiseShipping: channel === 'FRANCHISE' && hdr.customerId ? { mode: ship.mode, amount: ship.mode === 'AMOUNT' ? Number(ship.amount) : undefined, courier: ship.courier || undefined, reference: ship.reference || undefined } : undefined, shippingFee: Number(hdr.shippingFee || 0), shippingExpense: Number(hdr.shippingExpense || 0), marketplaceCharges: Number(hdr.marketplaceCharges || 0), dueDate: hdr.dueDate || null, pdcBank: withPdc ? hdr.pdcBank || undefined : undefined, pdcChequeNo: withPdc ? hdr.pdcChequeNo || undefined : undefined, pdcDate: withPdc ? hdr.pdcDate || null : null, notes: hdr.notes, lines: lines.map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: l.isFreebie ? 0 : l.unitPrice, isFreebie: l.isFreebie, priceTier: tier, batchId: l.batchId ?? null, exactBatch: !!l.batchId })) }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['dashboard'] }); nav(`/sales/${r.id}`); },
  });
  const set = (k: string, v: string) => setHdr((h) => ({ ...h, [k]: v }));
  const needsProof = paymentMode === 'ONLINE' || paymentMode === 'CREDIT_CARD';
  return <div className="mx-auto max-w-3xl space-y-4">
    <h1 className="text-2xl font-bold tracking-tight text-navy">New Sale</h1>
    <Card>
      <div className="grid gap-3 md:grid-cols-3">
        {!me!.locationScoped && <Field label="Branch"><Select value={locationId} onChange={(e) => setLocationId(e.target.value)}><option value="">—</option>{locations.data?.filter((l) => l.isSelling && (!warehouseOnly || l.type === 'WAREHOUSE')).map((l) => <option key={l.id} value={l.id}>{locLabel(l)}</option>)}</Select></Field>}
        <Field label="DR / SI number (paper)"><Input value={drSiNo} onChange={(e) => setDrSiNo(e.target.value)} placeholder="e.g. 10234" required data-testid="dr" /></Field>
        <Field label="Channel"><Select value={channel} onChange={(e) => setChannel(e.target.value)}>{CHANNELS.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}</Select></Field>
        <Field label="Payment mode"><Select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}><option value="CASH">Cash</option><option value="ONLINE">Online (bank / GCash)</option><option value="CREDIT_CARD">Credit card</option><option value="AR_PDC">AR / PDC (credit)</option></Select></Field>
        {(channel === 'SHIPPING_COURIER' || channel === 'SHIPPING_MARKETPLACE') && <Field label="Sub-channel"><Select value={channelSub} onChange={(e) => setChannelSub(e.target.value)}><option value="">—</option>{channel === 'SHIPPING_MARKETPLACE' ? ['SHOPEE', 'LAZADA', 'TIKTOK'].map((s) => <option key={s}>{s}</option>) : ['FRANCHISE', 'DEALER', 'AGENT'].map((s) => <option key={s}>{s}</option>)}</Select></Field>}
        {(channel === 'DEALER' || channel === 'FRANCHISE' || paymentMode === 'AR_PDC') && (() => {
          const kind = channel === 'DEALER' ? 'DEALER' : channel === 'FRANCHISE' ? 'FRANCHISE' : custType;
          const list = (customers.data ?? []).filter((c) => (kind ? c.type === kind : true) && c.type !== 'CONSIGNEE');
          return <>
            {channel !== 'DEALER' && channel !== 'FRANCHISE' && <Field label="Customer is a"><div className="flex flex-wrap gap-1">{([['DEALER', 'Dealer'], ['FRANCHISE', 'Franchisee'], ['AGENT', 'Agent'], ['CUSTOMER', 'Other customer']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => { setCustType(k); set('customerId', ''); }} className={`rounded-lg border px-3 py-1.5 text-sm ${custType === k ? 'border-navy bg-navy text-white' : 'border-slate-200 bg-white text-slate-700'}`}>{l}</button>)}</div></Field>}
            {(kind || channel === 'DEALER' || channel === 'FRANCHISE') && kind !== 'AGENT' && <Field label={kind === 'DEALER' ? 'Dealer' : kind === 'FRANCHISE' ? 'Franchisee' : 'Customer'}><Select value={hdr.customerId ?? ''} onChange={(e) => set('customerId', e.target.value)}><option value="">— choose —</option>{list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>}
          </>;
        })()}
        {(channel === 'AGENT' || (paymentMode === 'AR_PDC' && custType === 'AGENT' && channel !== 'DEALER' && channel !== 'FRANCHISE')) && <Field label="Agent"><Select value={hdr.agentId ?? ''} onChange={(e) => set('agentId', e.target.value)}><option value="">—</option>{agents.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>}
        {(channel === 'WALK_IN' || sixPack) && <Field label={sixPack ? 'Customer full name (required for the sticker)' : 'Customer name (optional)'}><Input value={hdr.customerName ?? ''} onChange={(e) => set('customerName', e.target.value)} /></Field>}
        <Field label="Customer contact no. (optional)"><Input type="tel" inputMode="tel" placeholder="09xx xxx xxxx" value={hdr.customerPhone ?? ''} onChange={(e) => set('customerPhone', e.target.value)} /></Field>
        <Field label="Customer email (optional)"><Input type="email" inputMode="email" value={hdr.customerEmail ?? ''} onChange={(e) => set('customerEmail', e.target.value)} /></Field>
        {can('sixpack.issue') && <div className="md:col-span-2 lg:col-span-3"><label className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-sm" data-testid="sixpack-tick"><input type="checkbox" className="mt-1" checked={sixPack} onChange={(e) => setSixPack(e.target.checked)} /><span><b>6-Pack sticker given</b> — one sticker for each supplement on this DR ({stickerCount} now). The customer's full name and mobile number are required so the stickers are tagged to the customer.{sixPack && !sixPackReady && <span className="block text-red-700">{stickerCount === 0 ? 'Add a supplement to the DR first.' : 'Type the customer\'s full name and mobile number.'}</span>}</span></label></div>}
        {channel === 'DELIVERY' && <><Field label="Rider"><Select value={hdr.riderId ?? ''} onChange={(e) => set('riderId', e.target.value)}><option value="">—</option>{riders.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field><Field label="Delivery fee"><Input type="number" inputMode="decimal" value={hdr.deliveryFee} onChange={(e) => set('deliveryFee', e.target.value)} /></Field>{!can('sale.incentive') && <Field label="Rider incentive"><Input type="number" inputMode="decimal" value={hdr.riderIncentive} onChange={(e) => set('riderIncentive', e.target.value)} /></Field>}</>}
        {channel.startsWith('SHIPPING') && <><Field label="Shipping fee (charged)"><Input type="number" inputMode="decimal" value={hdr.shippingFee} onChange={(e) => set('shippingFee', e.target.value)} /></Field><Field label="Shipping expense (paid)"><Input type="number" inputMode="decimal" value={hdr.shippingExpense} onChange={(e) => set('shippingExpense', e.target.value)} /></Field>{channel === 'SHIPPING_MARKETPLACE' && <Field label="Platform charges"><Input type="number" inputMode="decimal" value={hdr.marketplaceCharges} onChange={(e) => set('marketplaceCharges', e.target.value)} /></Field>}</>}
        {needsProof && <Field label="Payment account"><Select value={hdr.paymentAccountId ?? ''} onChange={(e) => set('paymentAccountId', e.target.value)}><option value="">—</option>{payAccts.data?.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</Select></Field>}
        {paymentMode === 'CREDIT_CARD' && <><Field label="MID"><Input value={hdr.cardMid ?? ''} onChange={(e) => set('cardMid', e.target.value)} /></Field><Field label="Slip no."><Input value={hdr.cardSlipNo ?? ''} onChange={(e) => set('cardSlipNo', e.target.value)} /></Field><Field label="Approval code"><Input value={hdr.cardApprovalCode ?? ''} onChange={(e) => set('cardApprovalCode', e.target.value)} /></Field><Field label="Batch no."><Input value={hdr.cardBatchNo ?? ''} onChange={(e) => set('cardBatchNo', e.target.value)} /></Field></>}
        {paymentMode === 'AR_PDC' && <><Field label="Due date"><Input type="date" value={hdr.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></Field><Field label="Post-dated cheque"><label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={withPdc} onChange={(e) => { setWithPdc(e.target.checked); if (!e.target.checked) setHdr((h) => ({ ...h, pdcBank: '', pdcChequeNo: '', pdcDate: '' })); }} /> There is a PDC</label></Field></>}
        {paymentMode === 'AR_PDC' && withPdc && <><Field label="PDC bank"><Input value={hdr.pdcBank ?? ''} onChange={(e) => set('pdcBank', e.target.value)} /></Field><Field label="Cheque no."><Input value={hdr.pdcChequeNo ?? ''} onChange={(e) => set('pdcChequeNo', e.target.value)} /></Field><Field label="Cheque date"><Input type="date" value={hdr.pdcDate ?? ''} onChange={(e) => set('pdcDate', e.target.value)} /></Field></>}
      </div>
      {channel === 'FRANCHISE' && hdr.customerId && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm" data-testid="franchise-shipping">
        <div className="mb-2 font-semibold">Shipping charged to the franchise</div>
        <div className="flex flex-wrap gap-1">{([['TO_FOLLOW', 'To follow'], ['AMOUNT', 'Type the amount now'], ['NONE', 'No shipping charge']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setShip((x) => ({ ...x, mode: k }))} className={`rounded-full border px-3 py-1 text-xs font-medium ${ship.mode === k ? 'border-brand bg-brand text-white' : 'bg-white text-slate-700'}`}>{l}</button>)}</div>
        {ship.mode === 'TO_FOLLOW' && <p className="mt-2 text-xs text-slate-600">The Franchise Coordinator is told and fills in the amount within 2 days. It then becomes a <b>separate franchise invoice</b> (not part of this order). The franchise owner, Owner, auditors and Accounting are told.</p>}
        {ship.mode === 'AMOUNT' && <div className="mt-2 grid gap-3 md:grid-cols-3"><Field label="Shipping amount (₱)"><Input type="number" inputMode="decimal" step="0.01" min={0} value={ship.amount} onChange={(e) => setShip({ ...ship, amount: e.target.value })} /></Field><Field label="Courier (optional)"><Input value={ship.courier} onChange={(e) => setShip({ ...ship, courier: e.target.value })} /></Field><Field label="Waybill / reference (optional)"><Input value={ship.reference} onChange={(e) => setShip({ ...ship, reference: e.target.value })} /></Field></div>}
      </div>}
      {channel === 'FRANCHISE' && <p className="mt-3 text-xs text-slate-500">Franchise price applied automatically to each item; you may change a price (a price below the list needs the Owner's approval). Plastic bags are charged to franchises: L ₱4, M ₱3, S ₱3, XL ₱5.</p>}
    </Card>
    <Card title={<>Items <Badge>{tier} tier</Badge></>}>
      <Input placeholder="Search product by name, SKU or scan barcode…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && products.data?.length === 1) add(products.data[0]); }} autoFocus data-testid="product-search" />
      {search.length >= 2 && <ul className="mt-1 max-h-60 divide-y overflow-auto rounded border bg-white">{products.data?.map((p) => <li key={p.id}><button className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => add(p)}><span>{p.name} <span className="text-xs text-slate-500">{p.sku}</span></span><span className="flex items-center gap-3"><span className="text-xs text-slate-500">{p.onHand ?? 0} on hand</span><span className="num">{p.tierPrices[tier] != null ? peso(p.tierPrices[tier]) : '—'}</span></span></button></li>)}{products.data?.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No match with stock at this branch</li>}</ul>}
      {!locationId && search.length >= 2 && <p className="mt-1 text-sm text-amber-700">Choose the branch first.</p>}
      {picking && <p className="mt-1 text-xs text-slate-500">Checking flavors and expiry…</p>}
      {choosing && <BatchChooser name={choosing.p.name} batches={choosing.batches} onPick={(b) => pushLine(choosing.p, b)} onCancel={() => setChoosing(null)} />}
      <div className="mt-3 space-y-2">{lines.map((l, i) => <div key={i} className="grid grid-cols-12 items-center gap-2 rounded border p-2 text-sm">
        <div className="col-span-12 md:col-span-5 font-medium">{l.name}{l.plastic && <div className="text-xs font-normal text-slate-600">{tier === 'FRANCHISE' ? 'Plastic: charged to the franchise' : 'Plastic: free for stores and other customers; type a price only if it was sold'}</div>}{l.batchLabel && <div className="text-xs font-normal text-slate-600" data-testid="line-batch">{l.batchLabel}{l.maxQty != null ? ` · ${l.maxQty} on hand` : ''}</div>}{l.maxQty != null && l.qty > l.maxQty && <div className="text-xs font-semibold text-red-700">Only {l.maxQty} on hand: add the rest from another flavor / expiry</div>}{l.isFreebie && <Badge tone="blue">FREEBIE</Badge>}{!l.isFreebie && l.unitPrice != null && l.tierPrice != null && l.unitPrice < l.tierPrice && <Badge tone="amber">special price → Admin approval</Badge>}</div>
        <div className="col-span-4 md:col-span-2"><Input type="number" inputMode="numeric" min={1} value={l.qty} onChange={(e) => setLines((ls) => ls.map((x, k) => (k === i ? { ...x, qty: Number(e.target.value) } : x)))} aria-label="Qty" /></div>
        <div className="col-span-5 md:col-span-3"><Input type="number" inputMode="decimal" step="0.01" disabled={l.isFreebie} value={l.unitPrice ?? ''} onChange={(e) => setLines((ls) => ls.map((x, k) => (k === i ? { ...x, unitPrice: e.target.value === '' ? null : Number(e.target.value) } : x)))} aria-label="Unit price" /></div>
        <div className="col-span-2 num md:col-span-1">{peso((l.unitPrice ?? 0) * l.qty)}</div>
        <button className="col-span-1 text-red-600" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))} aria-label="Remove">✕</button>
      </div>)}</div>
      {!lines.length && <Empty>Add at least one item.</Empty>}
    </Card>
    {needsProof && <Attachments type="SalesDoc" id={draftId} onUploaded={(a) => setProofId(a.id)} />}
    {needsProof && <p className="text-xs text-slate-500">Proof of payment is mandatory for online / card sales. {proofId ? '✔ uploaded' : 'Upload the screenshot / slip above.'}</p>}
    {can('sale.incentive') && (!inc.open
      ? <Button type="button" variant="outline" onClick={() => setInc({ ...inc, open: true, kind: channel === 'DELIVERY' ? 'RIDER' : 'SALES', payee: channel === 'DELIVERY' ? riders.data?.find((r) => r.id === hdr.riderId)?.name ?? '' : inc.payee })}>+ Add incentive expense</Button>
      : <Card title="Incentive expense" actions={<Button size="sm" variant="ghost" onClick={() => setInc({ open: false, amount: '', payee: '', kind: 'SALES' })}>Remove</Button>}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Type"><Select value={inc.kind} onChange={(e) => setInc({ ...inc, kind: e.target.value as 'SALES' | 'RIDER' })}><option value="SALES">Sales incentive</option><option value="RIDER">Rider / driver incentive</option></Select></Field>
          <Field label="Given to"><Input value={inc.payee} onChange={(e) => setInc({ ...inc, payee: e.target.value })} placeholder="name of the person" /></Field>
          <Field label="Amount (₱)"><Input type="number" inputMode="decimal" min={0} step="0.01" value={inc.amount} onChange={(e) => setInc({ ...inc, amount: e.target.value })} /></Field>
        </div>
        <p className="mt-2 text-xs text-slate-500">Paid from this sale's cash: it is deducted from the cash to deposit and recorded as an expense of this branch.</p>
      </Card>)}
    <Field label="Notes"><Textarea rows={2} value={hdr.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
    <ErrorBox error={create.error} />
    {review && <SaleReview onClose={() => setReview(false)} onConfirm={() => { setReview(false); create.mutate(); }} pending={create.isPending} data={{
      branch: me!.locationScoped ? loc?.name ?? '' : locations.data?.find((l) => l.id === locationId)?.name ?? '', drSiNo, channel: channel.replace(/_/g, ' ').toLowerCase() + (channelSub ? ` · ${channelSub}` : ''), tier,
      paymentMode: paymentMode === 'AR_PDC' ? 'AR / PDC (credit)' : paymentMode === 'CREDIT_CARD' ? 'Credit card' : paymentMode === 'ONLINE' ? 'Online' : 'Cash',
      account: payAccts.data?.find((a) => a.id === hdr.paymentAccountId)?.title ?? null, proof: needsProof ? !!proofId : null,
      customer: customers.data?.find((c) => c.id === hdr.customerId)?.name ?? (hdr.customerName || null), agent: agents.data?.find((a) => a.id === hdr.agentId)?.name ?? null, rider: riders.data?.find((r) => r.id === hdr.riderId)?.name ?? null,
      dueDate: paymentMode === 'AR_PDC' ? hdr.dueDate || null : null, pdc: paymentMode === 'AR_PDC' && withPdc ? [hdr.pdcBank, hdr.pdcChequeNo, hdr.pdcDate].filter(Boolean).join(' · ') : null,
      lines, fees: Number(hdr.deliveryFee || 0) + Number(hdr.shippingFee || 0), shipping: channel === 'FRANCHISE' && hdr.customerId ? (ship.mode === 'TO_FOLLOW' ? 'To follow: the Franchise Coordinator fills it in within 2 days (separate invoice)' : ship.mode === 'AMOUNT' ? `${peso(Number(ship.amount || 0))} (separate invoice)` : 'No shipping charge') : null, total, incentive: inc.open && Number(inc.amount) > 0 ? { amount: Number(inc.amount), payee: inc.payee } : null, sixPack: sixPack ? `${stickerCount} sticker${stickerCount === 1 ? '' : 's'} for ${hdr.customerName} (${hdr.customerPhone})` : null, notes: hdr.notes,
    }} />}
    <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-lg border bg-white p-3 shadow-lg"><div><div className="text-xs text-slate-500">Total</div><div className="text-2xl font-semibold">{peso(total)}</div>{inc.open && Number(inc.amount) > 0 && <div className="text-xs text-slate-500">Less incentive {peso(Number(inc.amount))} · cash to remit {peso(total - Number(inc.amount))}</div>}</div><Button size="lg" disabled={!lines.length || !drSiNo || create.isPending || lines.some((l) => l.qty < 1 || (l.maxQty != null && l.qty > l.maxQty)) || (inc.open && Number(inc.amount) > 0 && !inc.payee.trim()) || (sixPack && !sixPackReady)} onClick={() => setReview(true)} data-testid="save-sale">Review sale</Button></div>
  </div>;
}

interface Sale { id: string; sixPackStickers?: number; incentiveAmount?: string; incentivePayee?: string | null; controlNo: string; docDate: string; drSiNo: string; channel: string; channelSub: string | null; paymentMode: string; grandTotal: string; productTotal: string; amountPaid: string; balance?: string; specialPriceStatus: string | null; status: string; location: { name: string }; customer: { name: string } | null; agent: { name: string } | null; rider: { name: string } | null; customerName: string | null; customerPhone?: string | null; customerEmail?: string | null; deliveryFee: string; shippingFee: string; dueDate: string | null; notes: string | null; voidedAt: string | null; voidReason: string | null; lines: { id: string; qty: number; unitPrice: string; amount: string; isFreebie: boolean; priceTier: string; specialPriceFlag: string | null; nearExpiryWarn: boolean; product: { name: string; sku: string }; batch: { batchNo: string | null; expiryDate: string | null; flavor?: string | null } }[] }

export function SalesListPage() {
  const nav = useNavigate(); const { me } = useAuth(); const [sp] = useSearchParams();
  const [from, setFrom] = useState(sp.get('from') ?? today()); const [to, setTo] = useState(sp.get('to') ?? today()); const [locationId, setLocationId] = useState(sp.get('locationId') ?? '');
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/locations') });
  const q = useQuery({ queryKey: ['sales', from, to, locationId], queryFn: () => api.get<Sale[]>(`/api/sales?from=${from}&to=${to}${locationId ? `&locationId=${locationId}` : ''}`) });
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Sales List</h1>{!me!.locationScoped && <Field label="Branch"><Select value={locationId} onChange={(e) => setLocationId(e.target.value)}><option value="">All</option>{locations.data?.map((l) => <option key={l.id} value={l.id}>{locLabel(l)}</option>)}</Select></Field>}<Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field><Link to="/sales/new"><Button>New sale</Button></Link></div>
    <DataTable exportName="Sales" data={q.data ?? []} onRowClick={(r) => nav(`/sales/${r.id}`)} columns={[
      { header: 'Date', accessorKey: 'docDate', cell: (c) => fmtDate(c.getValue()) }, { header: 'DR/SI', accessorKey: 'drSiNo' }, { header: 'Branch', accessorFn: (r) => r.location.name }, { header: 'Channel', accessorFn: (r) => r.channel.replace(/_/g, ' ') }, { header: 'Customer', accessorFn: (r) => r.customer?.name ?? r.agent?.name ?? r.customerName ?? '' }, { header: 'Payment', accessorKey: 'paymentMode' },
      { header: 'Total', accessorKey: 'grandTotal', cell: (c) => <span className="num block">{peso(c.getValue())}</span> }, { header: 'Status', cell: (c) => <Badge tone={statusTone(c.row.original.status)}>{c.row.original.status}{c.row.original.specialPriceStatus === 'PENDING' ? ' · special price' : ''}</Badge> },
    ]} />
  </div>;
}

export function SaleDetailPage() {
  const { id } = useParams(); const nav = useNavigate(); const qc = useQueryClient(); const { can } = useAuth();
  const q = useQuery({ queryKey: ['sale', id], queryFn: () => api.get<Sale>(`/api/sales/${id}`) });
  const [reason, setReason] = useState('');
  const voidM = useMutation({ mutationFn: () => api.post(`/api/sales/${id}/void`, { reason }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['sale', id] }) });
  const edit = useMutation({ mutationFn: () => api.post('/api/closing/edits', { documentType: 'SalesDoc', documentId: id, reason, after: { voidReason: reason } }), onSuccess: () => nav('/closing') });
  const s = q.data; if (!s) return null;
  const closedErr = (voidM.error as { code?: string } | null)?.code === 'DAY_CLOSED';
  return <div className="mx-auto max-w-4xl space-y-4">
    <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold tracking-tight text-navy">DR/SI {s.drSiNo}</h1><Badge tone={statusTone(s.status)}>{s.status}</Badge>{s.specialPriceStatus && <Badge tone={s.specialPriceStatus === 'APPROVED' ? 'green' : s.specialPriceStatus === 'REJECTED' ? 'red' : 'amber'}>special price {s.specialPriceStatus}</Badge>}<span className="ml-auto flex gap-2"><Button variant="outline" size="sm" onClick={() => api.download(`/api/reports/forms/dr-sales/${s.id}.pdf`, `DR-${s.drSiNo}.pdf`)}>Print DR</Button><Button variant="outline" size="sm" onClick={() => api.download(`/api/reports/forms/dr-sales/${s.id}.xlsx`, `DR-${s.drSiNo}.xlsx`)}>Export xlsx</Button></span></div>
    <Card><dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">{[['Date', fmtDate(s.docDate)], ['Branch', s.location.name], ['Channel', `${s.channel.replace(/_/g, ' ')}${s.channelSub ? ` / ${s.channelSub}` : ''}`], ['Payment', s.paymentMode], ['Customer', s.customer?.name ?? s.agent?.name ?? s.customerName ?? '—'], ['Contact', [s.customerPhone, s.customerEmail].filter(Boolean).join(' · ') || '—'], ['Rider', s.rider?.name ?? '—'], ['Control #', s.controlNo], ['Due', s.dueDate ? fmtDate(s.dueDate) : '—'], ...(Number(s.incentiveAmount ?? 0) > 0 ? [['Incentive (from cash)', `${peso(s.incentiveAmount)} to ${s.incentivePayee ?? ''}`]] : []), ...(Number(s.sixPackStickers ?? 0) > 0 ? [['6-Pack stickers', `☑ ${s.sixPackStickers} given`]] : [])].map(([k, v]) => <div key={k}><dt className="text-xs uppercase text-slate-500">{k}</dt><dd>{v}</dd></div>)}</dl></Card>
    <Card title="Lines"><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Item</th><th>Flavor / expiry / batch</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Amount</th></tr></thead><tbody>{s.lines.map((l) => <tr key={l.id} className="border-t"><td>{l.product.name}{l.isFreebie && <Badge tone="blue">FREEBIE</Badge>}{l.specialPriceFlag && <Badge tone="amber">{l.priceTier} special {l.specialPriceFlag}</Badge>}{l.nearExpiryWarn && <Badge tone="red">near expiry</Badge>}</td><td className="text-xs text-slate-500">{batchText(l.batch)}</td><td className="num">{l.qty}</td><td className="num">{peso(l.unitPrice)}</td><td className="num">{peso(l.amount)}</td></tr>)}</tbody><tfoot className="font-medium"><tr className="border-t"><td colSpan={4}>Product total</td><td className="num">{peso(s.productTotal)}</td></tr>{Number(s.deliveryFee) > 0 && <tr><td colSpan={4}>Delivery fee</td><td className="num">{peso(s.deliveryFee)}</td></tr>}{Number(s.shippingFee) > 0 && <tr><td colSpan={4}>Shipping fee</td><td className="num">{peso(s.shippingFee)}</td></tr>}<tr><td colSpan={4}>Grand total</td><td className="num">{peso(s.grandTotal)}</td></tr>{s.paymentMode === 'AR_PDC' && <tr><td colSpan={4}>Balance</td><td className="num">{peso(s.balance)}</td></tr>}</tfoot></table></Card>
    {can('replacement.create') && s.status !== 'VOIDED' && <p className="text-sm"><Link className="font-semibold text-brand underline" to={`/replacements?dr=${encodeURIComponent(s.drSiNo)}`} data-testid="return-link">The customer returned an item from this DR? Open a replacement ticket</Link></p>}
    <Attachments type="SalesDoc" id={s.id} />
    {!s.voidedAt && (can('sale.void') || can('sale.edit.sameday')) && <Card title="Void / correct"><div className="flex flex-wrap items-end gap-2"><Field label="Reason" className="flex-1"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field><Button variant="danger" disabled={!reason} onClick={() => voidM.mutate()}>Void sale</Button>{closedErr && <Button variant="outline" onClick={() => edit.mutate()}>Request post-close void (needs Head + Asst Auditor)</Button>}</div><ErrorBox error={voidM.error} /><ErrorBox error={edit.error} /></Card>}
    {s.voidedAt && <div className="rounded bg-red-50 p-3 text-sm text-red-800">Voided: {s.voidReason}</div>}
    {!s.voidedAt && can('revision.request') && <CorrectionRequest documentType="SalesDoc" documentId={s.id} fields={[{ key: 'drSiNo', label: 'DR/SI number', current: s.drSiNo }, { key: 'customerName', label: 'Customer name', current: s.customerName }, { key: 'deliveryFee', label: 'Delivery fee', current: s.deliveryFee, type: 'number' }, { key: 'shippingFee', label: 'Shipping fee', current: s.shippingFee, type: 'number' }, { key: 'notes', label: 'Notes', current: s.notes }]} />}
    <ApprovalTimeline documentType="SalesDoc" documentId={s.id} />
    <History entityType="SalesDoc" id={s.id} />
  </div>;
}

/** The check of every detail before the sale is saved and posted (owner request 2026-09-30). */
function SaleReview({ data: d, onConfirm, onClose, pending }: { onConfirm: () => void; onClose: () => void; pending: boolean; data: {
  branch: string; drSiNo: string; channel: string; tier: string; paymentMode: string; account: string | null; proof: boolean | null; customer: string | null; agent: string | null; rider: string | null;
  dueDate: string | null; pdc: string | null; shipping?: string | null; lines: Line[]; fees: number; total: number; incentive: { amount: number; payee: string } | null; sixPack?: string | null; notes: string } }) {
  const row = (k: string, v: React.ReactNode) => (v === null || v === '' || v === undefined ? null : <div className="flex justify-between gap-4 py-0.5"><span className="text-slate-500">{k}</span><span className="text-right font-medium">{v}</span></div>);
  const special = d.lines.filter((l) => !l.isFreebie && l.unitPrice != null && l.tierPrice != null && l.unitPrice < l.tierPrice).length;
  return <Modal wide title="Check the sale before saving" onClose={onClose}>
    <div className="max-h-[70vh] space-y-3 overflow-y-auto text-sm" data-testid="sale-review">
      <div className="grid gap-x-6 md:grid-cols-2">
        <div>{row('Branch', d.branch)}{row('DR / SI no.', d.drSiNo)}{row('Channel', d.channel)}{row('Price tier', d.tier)}{row('Customer', d.customer)}{row('Agent', d.agent)}{row('Rider', d.rider)}</div>
        <div>{row('Payment', d.paymentMode)}{row('Account', d.account)}{d.proof !== null && row('Proof of payment', d.proof ? '✔ uploaded' : <span className="text-red-700">missing</span>)}{row('Due date', d.dueDate)}{row('PDC', d.pdc)}{row('6-Pack stickers', d.sixPack)}{row('Shipping to the franchise', d.shipping)}</div>
      </div>
      <table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1">Item</th><th>Flavor / expiry</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Amount</th></tr></thead>
        <tbody>{d.lines.map((l, i) => <tr key={i} className="border-t align-top"><td className="py-1">{l.name}{l.isFreebie && <Badge tone="blue">FREEBIE</Badge>}{!l.isFreebie && l.unitPrice != null && l.tierPrice != null && l.unitPrice < l.tierPrice && <div className="text-xs text-amber-700">special price (list {peso(l.tierPrice)})</div>}</td><td className="text-xs text-slate-600">{l.batchLabel ?? '—'}</td><td className="num">{l.qty}</td><td className="num">{peso(l.unitPrice ?? 0)}</td><td className="num">{peso((l.unitPrice ?? 0) * l.qty)}</td></tr>)}</tbody></table>
      <div className="border-t pt-2">{d.fees > 0 && row('Delivery / shipping fees', peso(d.fees))}{row('Total', <span className="text-lg">{peso(d.total)}</span>)}{d.incentive && row(`Less incentive to ${d.incentive.payee}`, peso(d.incentive.amount))}{d.incentive && row('Cash to remit', peso(d.total - d.incentive.amount))}</div>
      {special > 0 && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">{special} item(s) at a special price: saved now, the Owner approves the price.</p>}
      {d.notes && <p className="text-xs text-slate-600">Notes: {d.notes}</p>}
      <p className="text-xs text-slate-500">Saving posts the sale: stock is deducted at once and it counts in today's report.</p>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Go back and edit</Button><Button disabled={pending} onClick={onConfirm} data-testid="confirm-sale">Confirm and save sale</Button></div>
    </div>
  </Modal>;
}
