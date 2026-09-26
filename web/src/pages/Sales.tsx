import { ApprovalTimeline } from '@/components/ApprovalTimeline';
import { History, CorrectionRequest } from '@/components/DocEdits';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, fmtDate, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Select, Textarea, statusTone } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';
import { Attachments } from '@/components/Attachments';

type Product = { id: string; sku: string; name: string; tierPrices: Record<string, string>; category: { accountingClass: string } };
type Line = { productId: string; name: string; qty: number; unitPrice: number | null; tierPrice: number | null; isFreebie: boolean; batchId?: string | null };
const CHANNELS = ['WALK_IN', 'DELIVERY', 'SHIPPING_COURIER', 'SHIPPING_MARKETPLACE', 'FRANCHISE', 'DEALER', 'AGENT', 'PERSONAL', 'OTHER'];
const TIER: Record<string, string> = { WALK_IN: 'RETAIL', DELIVERY: 'RETAIL', SHIPPING_COURIER: 'RETAIL', SHIPPING_MARKETPLACE: 'RETAIL', FRANCHISE: 'FRANCHISE', DEALER: 'DEALER', AGENT: 'AGENT', PERSONAL: 'RETAIL', OTHER: 'RETAIL' };

/** §8.1 New Sale — phone-first: search product, qty, tier auto by channel, editable price (→ SPECIAL_PRICE), proof upload for ONLINE/CC. */
export function NewSalePage() {
  const { me } = useAuth(); const nav = useNavigate(); const qc = useQueryClient();
  const loc = me!.locations[0];
  const [locationId, setLocationId] = useState(loc?.id ?? '');
  const [channel, setChannel] = useState('WALK_IN'); const [channelSub, setChannelSub] = useState(''); const [paymentMode, setPaymentMode] = useState('CASH');
  const [drSiNo, setDrSiNo] = useState(''); const [search, setSearch] = useState(''); const [lines, setLines] = useState<Line[]>([]);
  const [hdr, setHdr] = useState<Record<string, string>>({ deliveryFee: '', riderIncentive: '', shippingFee: '', shippingExpense: '', marketplaceCharges: '', dueDate: '', notes: '' });
  const [draftId] = useState(() => crypto.randomUUID()); const [proofId, setProofId] = useState<string | null>(null);
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; isSelling: boolean }[]>('/api/locations'), enabled: !me!.locationScoped });
  const products = useQuery({ queryKey: ['products', search], queryFn: () => api.get<Product[]>(`/api/products?search=${encodeURIComponent(search)}&take=30`), enabled: search.length >= 2 });
  const customers = useQuery({ queryKey: ['customers'], queryFn: () => api.get<{ id: string; name: string; type: string }[]>('/api/customers') });
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/agents') });
  const riders = useQuery({ queryKey: ['riders', locationId], queryFn: () => api.get<{ id: string; name: string }[]>(`/api/riders?locationId=${locationId}`), enabled: !!locationId });
  const payAccts = useQuery({ queryKey: ['payment-accounts', locationId], queryFn: () => api.get<{ id: string; title: string; paymentAccountType: string }[]>(`/api/accounts/payment?locationId=${locationId}`), enabled: paymentMode === 'ONLINE' || paymentMode === 'CREDIT_CARD' });
  const tier = TIER[channel];
  const add = (p: Product) => { const tp = p.tierPrices[tier] != null ? Number(p.tierPrices[tier]) : null; const freebie = ['FREEBIE', 'PLASTIC'].includes(p.category.accountingClass); setLines((ls) => [...ls, { productId: p.id, name: p.name, qty: 1, unitPrice: freebie ? 0 : tp, tierPrice: tp, isFreebie: freebie }]); setSearch(''); };
  const total = useMemo(() => lines.reduce((s, l) => s + (l.unitPrice ?? 0) * l.qty, 0) + Number(hdr.deliveryFee || 0) + Number(hdr.shippingFee || 0), [lines, hdr]);
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/api/sales', { locationId, channel, channelSub: channelSub || null, paymentMode, drSiNo, customerId: hdr.customerId || null, agentId: hdr.agentId || null, riderId: hdr.riderId || null, customerName: hdr.customerName || null, customerPhone: hdr.customerPhone || null, customerEmail: hdr.customerEmail || null, paymentAccountId: hdr.paymentAccountId || null, proofOfPaymentAttachmentId: proofId, cardMid: hdr.cardMid, cardSlipNo: hdr.cardSlipNo, cardApprovalCode: hdr.cardApprovalCode, cardBatchNo: hdr.cardBatchNo, deliveryFee: Number(hdr.deliveryFee || 0), riderIncentive: Number(hdr.riderIncentive || 0), shippingFee: Number(hdr.shippingFee || 0), shippingExpense: Number(hdr.shippingExpense || 0), marketplaceCharges: Number(hdr.marketplaceCharges || 0), dueDate: hdr.dueDate || null, pdcBank: hdr.pdcBank, pdcChequeNo: hdr.pdcChequeNo, pdcDate: hdr.pdcDate || null, notes: hdr.notes, lines: lines.map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: l.isFreebie ? 0 : l.unitPrice, isFreebie: l.isFreebie, priceTier: tier })) }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['dashboard'] }); nav(`/sales/${r.id}`); },
  });
  const set = (k: string, v: string) => setHdr((h) => ({ ...h, [k]: v }));
  const needsProof = paymentMode === 'ONLINE' || paymentMode === 'CREDIT_CARD';
  return <div className="mx-auto max-w-3xl space-y-4">
    <h1 className="text-xl font-semibold">New Sale</h1>
    <Card>
      <div className="grid gap-3 md:grid-cols-3">
        {!me!.locationScoped && <Field label="Branch"><Select value={locationId} onChange={(e) => setLocationId(e.target.value)}><option value="">—</option>{locations.data?.filter((l) => l.isSelling).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>}
        <Field label="DR / SI number (paper)"><Input value={drSiNo} onChange={(e) => setDrSiNo(e.target.value)} placeholder="e.g. 10234" required data-testid="dr" /></Field>
        <Field label="Channel"><Select value={channel} onChange={(e) => setChannel(e.target.value)}>{CHANNELS.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}</Select></Field>
        <Field label="Payment mode"><Select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}><option value="CASH">Cash</option><option value="ONLINE">Online (bank / GCash)</option><option value="CREDIT_CARD">Credit card</option><option value="AR_PDC">AR / PDC (credit)</option></Select></Field>
        {(channel === 'SHIPPING_COURIER' || channel === 'SHIPPING_MARKETPLACE') && <Field label="Sub-channel"><Select value={channelSub} onChange={(e) => setChannelSub(e.target.value)}><option value="">—</option>{channel === 'SHIPPING_MARKETPLACE' ? ['SHOPEE', 'LAZADA', 'TIKTOK'].map((s) => <option key={s}>{s}</option>) : ['FRANCHISE', 'DEALER', 'AGENT'].map((s) => <option key={s}>{s}</option>)}</Select></Field>}
        {(channel === 'DEALER' || channel === 'FRANCHISE' || paymentMode === 'AR_PDC') && <Field label="Customer"><Select value={hdr.customerId ?? ''} onChange={(e) => set('customerId', e.target.value)}><option value="">—</option>{customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}</Select></Field>}
        {(channel === 'AGENT' || paymentMode === 'AR_PDC') && <Field label="Agent"><Select value={hdr.agentId ?? ''} onChange={(e) => set('agentId', e.target.value)}><option value="">—</option>{agents.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>}
        {channel === 'WALK_IN' && <Field label="Customer name (optional)"><Input value={hdr.customerName ?? ''} onChange={(e) => set('customerName', e.target.value)} /></Field>}
        <Field label="Customer contact no. (optional)"><Input type="tel" inputMode="tel" placeholder="09xx xxx xxxx" value={hdr.customerPhone ?? ''} onChange={(e) => set('customerPhone', e.target.value)} /></Field>
        <Field label="Customer email (optional)"><Input type="email" inputMode="email" value={hdr.customerEmail ?? ''} onChange={(e) => set('customerEmail', e.target.value)} /></Field>
        {channel === 'DELIVERY' && <><Field label="Rider"><Select value={hdr.riderId ?? ''} onChange={(e) => set('riderId', e.target.value)}><option value="">—</option>{riders.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field><Field label="Delivery fee"><Input type="number" inputMode="decimal" value={hdr.deliveryFee} onChange={(e) => set('deliveryFee', e.target.value)} /></Field><Field label="Rider incentive"><Input type="number" inputMode="decimal" value={hdr.riderIncentive} onChange={(e) => set('riderIncentive', e.target.value)} /></Field></>}
        {channel.startsWith('SHIPPING') && <><Field label="Shipping fee (charged)"><Input type="number" inputMode="decimal" value={hdr.shippingFee} onChange={(e) => set('shippingFee', e.target.value)} /></Field><Field label="Shipping expense (paid)"><Input type="number" inputMode="decimal" value={hdr.shippingExpense} onChange={(e) => set('shippingExpense', e.target.value)} /></Field>{channel === 'SHIPPING_MARKETPLACE' && <Field label="Platform charges"><Input type="number" inputMode="decimal" value={hdr.marketplaceCharges} onChange={(e) => set('marketplaceCharges', e.target.value)} /></Field>}</>}
        {needsProof && <Field label="Payment account"><Select value={hdr.paymentAccountId ?? ''} onChange={(e) => set('paymentAccountId', e.target.value)}><option value="">—</option>{payAccts.data?.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</Select></Field>}
        {paymentMode === 'CREDIT_CARD' && <><Field label="MID"><Input value={hdr.cardMid ?? ''} onChange={(e) => set('cardMid', e.target.value)} /></Field><Field label="Slip no."><Input value={hdr.cardSlipNo ?? ''} onChange={(e) => set('cardSlipNo', e.target.value)} /></Field><Field label="Approval code"><Input value={hdr.cardApprovalCode ?? ''} onChange={(e) => set('cardApprovalCode', e.target.value)} /></Field><Field label="Batch no."><Input value={hdr.cardBatchNo ?? ''} onChange={(e) => set('cardBatchNo', e.target.value)} /></Field></>}
        {paymentMode === 'AR_PDC' && <><Field label="Due date"><Input type="date" value={hdr.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></Field><Field label="PDC bank"><Input value={hdr.pdcBank ?? ''} onChange={(e) => set('pdcBank', e.target.value)} /></Field><Field label="Cheque no."><Input value={hdr.pdcChequeNo ?? ''} onChange={(e) => set('pdcChequeNo', e.target.value)} /></Field><Field label="Cheque date"><Input type="date" value={hdr.pdcDate ?? ''} onChange={(e) => set('pdcDate', e.target.value)} /></Field></>}
      </div>
    </Card>
    <Card title={<>Items <Badge>{tier} tier</Badge></>}>
      <Input placeholder="Search product by name, SKU or scan barcode…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && products.data?.length === 1) add(products.data[0]); }} autoFocus data-testid="product-search" />
      {search.length >= 2 && <ul className="mt-1 max-h-60 divide-y overflow-auto rounded border bg-white">{products.data?.map((p) => <li key={p.id}><button className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => add(p)}><span>{p.name} <span className="text-xs text-slate-500">{p.sku}</span></span><span className="num">{p.tierPrices[tier] != null ? peso(p.tierPrices[tier]) : '—'}</span></button></li>)}{products.data?.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No match</li>}</ul>}
      <div className="mt-3 space-y-2">{lines.map((l, i) => <div key={i} className="grid grid-cols-12 items-center gap-2 rounded border p-2 text-sm">
        <div className="col-span-12 md:col-span-5 font-medium">{l.name}{l.isFreebie && <Badge tone="blue">FREEBIE</Badge>}{!l.isFreebie && l.unitPrice != null && l.tierPrice != null && l.unitPrice < l.tierPrice && <Badge tone="amber">special price → Admin approval</Badge>}</div>
        <div className="col-span-4 md:col-span-2"><Input type="number" inputMode="numeric" min={1} value={l.qty} onChange={(e) => setLines((ls) => ls.map((x, k) => (k === i ? { ...x, qty: Number(e.target.value) } : x)))} aria-label="Qty" /></div>
        <div className="col-span-5 md:col-span-3"><Input type="number" inputMode="decimal" step="0.01" disabled={l.isFreebie} value={l.unitPrice ?? ''} onChange={(e) => setLines((ls) => ls.map((x, k) => (k === i ? { ...x, unitPrice: e.target.value === '' ? null : Number(e.target.value) } : x)))} aria-label="Unit price" /></div>
        <div className="col-span-2 num md:col-span-1">{peso((l.unitPrice ?? 0) * l.qty)}</div>
        <button className="col-span-1 text-red-600" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))} aria-label="Remove">✕</button>
      </div>)}</div>
      {!lines.length && <Empty>Add at least one item.</Empty>}
    </Card>
    {needsProof && <Attachments type="SalesDoc" id={draftId} onUploaded={(a) => setProofId(a.id)} />}
    {needsProof && <p className="text-xs text-slate-500">Proof of payment is mandatory for online / card sales. {proofId ? '✔ uploaded' : 'Upload the screenshot / slip above.'}</p>}
    <Field label="Notes"><Textarea rows={2} value={hdr.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
    <ErrorBox error={create.error} />
    <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-lg border bg-white p-3 shadow-lg"><div><div className="text-xs text-slate-500">Total</div><div className="text-2xl font-semibold">{peso(total)}</div></div><Button size="lg" disabled={!lines.length || !drSiNo || create.isPending} onClick={() => create.mutate()} data-testid="save-sale">Save sale</Button></div>
  </div>;
}

interface Sale { id: string; controlNo: string; docDate: string; drSiNo: string; channel: string; channelSub: string | null; paymentMode: string; grandTotal: string; productTotal: string; amountPaid: string; balance?: string; specialPriceStatus: string | null; status: string; location: { name: string }; customer: { name: string } | null; agent: { name: string } | null; rider: { name: string } | null; customerName: string | null; customerPhone?: string | null; customerEmail?: string | null; deliveryFee: string; shippingFee: string; dueDate: string | null; notes: string | null; voidedAt: string | null; voidReason: string | null; lines: { id: string; qty: number; unitPrice: string; amount: string; isFreebie: boolean; priceTier: string; specialPriceFlag: string | null; nearExpiryWarn: boolean; product: { name: string; sku: string }; batch: { batchNo: string | null; expiryDate: string | null } }[] }

export function SalesListPage() {
  const nav = useNavigate(); const { me } = useAuth(); const [sp] = useSearchParams();
  const [from, setFrom] = useState(sp.get('from') ?? today()); const [to, setTo] = useState(sp.get('to') ?? today()); const [locationId, setLocationId] = useState(sp.get('locationId') ?? '');
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/locations') });
  const q = useQuery({ queryKey: ['sales', from, to, locationId], queryFn: () => api.get<Sale[]>(`/api/sales?from=${from}&to=${to}${locationId ? `&locationId=${locationId}` : ''}`) });
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-xl font-semibold">Sales</h1>{!me!.locationScoped && <Field label="Branch"><Select value={locationId} onChange={(e) => setLocationId(e.target.value)}><option value="">All</option>{locations.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>}<Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field><Link to="/sales/new"><Button>New sale</Button></Link></div>
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
    <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">DR/SI {s.drSiNo}</h1><Badge tone={statusTone(s.status)}>{s.status}</Badge>{s.specialPriceStatus && <Badge tone={s.specialPriceStatus === 'APPROVED' ? 'green' : s.specialPriceStatus === 'REJECTED' ? 'red' : 'amber'}>special price {s.specialPriceStatus}</Badge>}<span className="ml-auto flex gap-2"><Button variant="outline" size="sm" onClick={() => api.download(`/api/reports/forms/dr-sales/${s.id}.pdf`, `DR-${s.drSiNo}.pdf`)}>Print DR</Button><Button variant="outline" size="sm" onClick={() => api.download(`/api/reports/forms/dr-sales/${s.id}.xlsx`, `DR-${s.drSiNo}.xlsx`)}>Export xlsx</Button></span></div>
    <Card><dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">{[['Date', fmtDate(s.docDate)], ['Branch', s.location.name], ['Channel', `${s.channel.replace(/_/g, ' ')}${s.channelSub ? ` / ${s.channelSub}` : ''}`], ['Payment', s.paymentMode], ['Customer', s.customer?.name ?? s.agent?.name ?? s.customerName ?? '—'], ['Contact', [s.customerPhone, s.customerEmail].filter(Boolean).join(' · ') || '—'], ['Rider', s.rider?.name ?? '—'], ['Control #', s.controlNo], ['Due', s.dueDate ? fmtDate(s.dueDate) : '—']].map(([k, v]) => <div key={k}><dt className="text-xs uppercase text-slate-500">{k}</dt><dd>{v}</dd></div>)}</dl></Card>
    <Card title="Lines"><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Item</th><th>Batch / expiry</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Amount</th></tr></thead><tbody>{s.lines.map((l) => <tr key={l.id} className="border-t"><td>{l.product.name}{l.isFreebie && <Badge tone="blue">FREEBIE</Badge>}{l.specialPriceFlag && <Badge tone="amber">{l.priceTier} special {l.specialPriceFlag}</Badge>}{l.nearExpiryWarn && <Badge tone="red">near expiry</Badge>}</td><td className="text-xs text-slate-500">{l.batch.batchNo ?? '—'} {fmtDate(l.batch.expiryDate)}</td><td className="num">{l.qty}</td><td className="num">{peso(l.unitPrice)}</td><td className="num">{peso(l.amount)}</td></tr>)}</tbody><tfoot className="font-medium"><tr className="border-t"><td colSpan={4}>Product total</td><td className="num">{peso(s.productTotal)}</td></tr>{Number(s.deliveryFee) > 0 && <tr><td colSpan={4}>Delivery fee</td><td className="num">{peso(s.deliveryFee)}</td></tr>}{Number(s.shippingFee) > 0 && <tr><td colSpan={4}>Shipping fee</td><td className="num">{peso(s.shippingFee)}</td></tr>}<tr><td colSpan={4}>Grand total</td><td className="num">{peso(s.grandTotal)}</td></tr>{s.paymentMode === 'AR_PDC' && <tr><td colSpan={4}>Balance</td><td className="num">{peso(s.balance)}</td></tr>}</tfoot></table></Card>
    <Attachments type="SalesDoc" id={s.id} />
    {!s.voidedAt && (can('sale.void') || can('sale.edit.sameday')) && <Card title="Void / correct"><div className="flex flex-wrap items-end gap-2"><Field label="Reason" className="flex-1"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field><Button variant="danger" disabled={!reason} onClick={() => voidM.mutate()}>Void sale</Button>{closedErr && <Button variant="outline" onClick={() => edit.mutate()}>Request post-close void (needs Head + Asst Auditor)</Button>}</div><ErrorBox error={voidM.error} /><ErrorBox error={edit.error} /></Card>}
    {s.voidedAt && <div className="rounded bg-red-50 p-3 text-sm text-red-800">Voided: {s.voidReason}</div>}
    {!s.voidedAt && can('revision.request') && <CorrectionRequest documentType="SalesDoc" documentId={s.id} fields={[{ key: 'drSiNo', label: 'DR/SI number', current: s.drSiNo }, { key: 'customerName', label: 'Customer name', current: s.customerName }, { key: 'deliveryFee', label: 'Delivery fee', current: s.deliveryFee, type: 'number' }, { key: 'shippingFee', label: 'Shipping fee', current: s.shippingFee, type: 'number' }, { key: 'notes', label: 'Notes', current: s.notes }]} />}
    <ApprovalTimeline documentType="SalesDoc" documentId={s.id} />
    <History entityType="SalesDoc" id={s.id} />
  </div>;
}
