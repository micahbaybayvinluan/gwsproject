import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, fmtDate, peso } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PickedInput } from '@/components/PickedInput';
import { Attachments } from '@/components/Attachments';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, Select, Stat, Textarea, statusTone } from '@/components/ui/primitives';
import { Searchable } from '@/components/Searchable';

interface Ticket {
  payments?: { id: string; date: string; direction: string; mode: string; account: string | null; amount: number; status: string; note: string | null }[]; replacedOn?: string | null; replacedLocationId?: string | null; saleOnCredit?: boolean; priceTier?: string; suggestedPrice?: number | null;
  id: string; ticketNo: string; kind: 'CUSTOMER' | 'SUPPLIER'; status: string; reason: string; notes: string | null; qty: number; product: { id: string; sku: string; name: string } | null; location: string; createdBy: string; createdAt: string; ageDays: number;
  drSiNo: string | null; salesDocId: string | null; saleControlNo: string | null; saleBranch: string | null; customerName: string | null; customerPhone: string | null; unitPaid?: string;
  replaced: { at: string; by: string; branch: string; product: { id: string; name: string } | null; qty: number | null; unitPrice: string | null } | null;
  priceDifference: string | null; differenceSettledAt: string | null; differenceNote: string | null;
  supplier: { id: string; code: string; name: string | null } | null; sentAt: string | null; receivedQty: number; closedAt: string | null; closedNote: string | null; unitCost?: string; receivedValue?: string;
  receipts?: { receivingDocId: string; controlNo: string; product: string; qty: number }[];
}
const REASONS: [string, string][] = [['DAMAGED', 'Damaged'], ['DEFECTIVE', 'Defective'], ['WRONG_ITEM', 'Wrong item'], ['EXPIRED', 'Expired'], ['OTHER', 'Other']];
const STATUS: Record<string, string> = { OPEN: 'waiting for a replacement', REPLACED: 'replaced · waiting for the Head Auditor', PENDING_RETURN: 'waiting for the Head Auditor', AWAITING_REPLACEMENT: 'sent · waiting for the supplier', PARTIAL: 'part of the replacement arrived', CLOSED: 'closed', CANCELLED: 'cancelled' };
const tone = (s: string) => (s === 'CLOSED' ? 'green' : s === 'CANCELLED' ? 'slate' : s === 'OPEN' || s === 'AWAITING_REPLACEMENT' ? 'amber' : statusTone(s));
const diffText = (d: string | null) => { if (d == null) return '—'; const n = Number(d); return n === 0 ? 'no difference' : n > 0 ? `customer pays ${peso(n)}` : `refund / credit ${peso(Math.abs(n))}`; };

/** Replacement tickets (owner request 2026-10-02): items a customer returned to us, and items we return to a supplier. */
export function ReplacementsPage() {
  const { can } = useAuth(); const nav = useNavigate(); const [sp] = useSearchParams();
  const [kind, setKind] = useState(''); const [openOnly, setOpenOnly] = useState(true); const [newKind, setNewKind] = useState<'' | 'CUSTOMER' | 'SUPPLIER'>(sp.get('dr') ? 'CUSTOMER' : '');
  const q = useQuery({ queryKey: ['replacements', kind, openOnly], queryFn: () => api.get<Ticket[]>(`/api/replacements?${kind ? `kind=${kind}&` : ''}${openOnly ? 'open=1' : ''}`) });
  const sum = useQuery({ queryKey: ['replacements-summary'], queryFn: () => api.get<{ suppliers: { id: string; code: string; name: string | null; openTickets: number; unitsOwed: number; oldestOpenDays: number; avgDaysToReplace: number | null }[] }>('/api/replacements/summary'), enabled: can('replacement.view') });
  const rows = q.data ?? [];
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Replacement Tickets</h1>
      <Field label="Show"><Select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">All tickets</option><option value="CUSTOMER">Customer returns</option><option value="SUPPLIER">Returns to suppliers</option></Select></Field>
      <label className="flex items-center gap-1 pb-2.5 text-sm"><input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> only open</label>
      {can('replacement.create') && <><Button onClick={() => setNewKind('CUSTOMER')} data-testid="new-customer-ticket">Customer returned an item</Button><Button variant="outline" onClick={() => setNewKind('SUPPLIER')} data-testid="new-supplier-ticket">Return items to a supplier</Button></>}</div>
    <Card title="How it works"><ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
      <li><b>Customer returned an item:</b> find the DR / SI it was sold on, choose the item, quantity and reason. A ticket opens; the auditors, Accounting, the Owner, the sales associate of that DR and every branch are told.</li>
      <li><b>Any branch except a franchise</b> ticks the ticket when it gives the customer the replacement (the same product or another one). The <b>price difference</b> against the DR is worked out by itself. The <b>Head Auditor approves</b>; then the ticket closes.</li>
      <li><b>Return to a supplier:</b> the ticket is tagged to the supplier; the Head Auditor approves the return. It stays open until replacement items <b>arrive</b> on a supplier delivery linked to the ticket; only that closes it.</li>
    </ul></Card>
    {sum.data && sum.data.suppliers.some((s) => s.openTickets > 0) && <Card title="Suppliers that still owe us replacements"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{sum.data.suppliers.filter((s) => s.openTickets > 0).map((s) => <Stat key={s.id} label={s.name ?? s.code} value={`${s.unitsOwed} units`} sub={`${s.openTickets} ticket(s) · oldest ${s.oldestOpenDays} days${s.avgDaysToReplace != null ? ` · usually ${s.avgDaysToReplace} days` : ''}`} tone={s.oldestOpenDays > 14 ? 'red' : 'amber'} />)}</div></Card>}
    {q.isLoading ? <Empty>Loading…</Empty> : !rows.length ? <Empty>No tickets.</Empty> : <Card><div className="overflow-x-auto"><Searchable><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1 pr-3">Ticket</th><th className="pr-3">Kind</th><th className="pr-3">Item</th><th className="num pr-3">Qty</th><th className="pr-3">DR / supplier</th><th className="pr-3">Branch</th><th className="pr-3">Status</th><th className="num pr-3">Days</th></tr></thead>
      <tbody>{rows.map((t) => <tr key={t.id} className="cursor-pointer border-t hover:bg-slate-50" onClick={() => nav(`/replacements/${t.id}`)}>
        <td className="py-2 pr-3 font-medium text-brand">{t.ticketNo}</td><td className="pr-3">{t.kind === 'CUSTOMER' ? 'Customer' : 'Supplier'}</td><td className="pr-3">{t.product?.name}</td><td className="num pr-3">{t.qty}</td>
        <td className="pr-3">{t.kind === 'CUSTOMER' ? <>DR {t.drSiNo}<div className="text-xs text-slate-500">{t.customerName ?? ''}</div></> : t.supplier ? (t.supplier.name ?? t.supplier.code) : ''}</td><td className="pr-3">{t.location}</td>
        <td className="pr-3"><Badge tone={tone(t.status)}>{STATUS[t.status] ?? t.status}</Badge></td><td className="num pr-3">{t.ageDays}</td></tr>)}</tbody></table></Searchable></div></Card>}
    {newKind === 'CUSTOMER' && <NewCustomerTicket initial={sp.get('dr') ?? ''} onClose={() => setNewKind('')} onDone={(id) => nav(`/replacements/${id}`)} />}
    {newKind === 'SUPPLIER' && <NewSupplierTicket onClose={() => setNewKind('')} onDone={(id) => nav(`/replacements/${id}`)} />}
  </div>;
}

interface DrDoc { id: string; drSiNo: string; controlNo: string; date: string; branch: string; customer: string | null; phone: string | null; preparedBy: string | null; outsideWindow: boolean; lines: { lineId: string; product: string; sku: string; qty: number; unitPrice: string; available: number }[] }

function NewCustomerTicket({ initial, onClose, onDone }: { initial: string; onClose: () => void; onDone: (id: string) => void }) {
  const { me } = useAuth(); const qc = useQueryClient();
  const [text, setText] = useState(initial); const [line, setLine] = useState<{ doc: DrDoc; l: DrDoc['lines'][number] } | null>(null);
  const [f, setF] = useState({ qty: '1', reason: 'DAMAGED', notes: '', locationId: '' });
  const found = useQuery({ queryKey: ['find-dr', text], queryFn: () => api.get<DrDoc[]>(`/api/replacements/find-dr?q=${encodeURIComponent(text)}`), enabled: text.trim().length >= 2 });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; type: string; isSelling: boolean }[]>('/api/locations'), enabled: !me!.locationScoped });
  const create = useMutation({ mutationFn: () => api.post<{ id: string }>('/api/replacements/customer', { salesLineId: line!.l.lineId, qty: Number(f.qty), reason: f.reason, notes: f.notes || undefined, locationId: f.locationId || undefined }), onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['replacements'] }); onDone(r.id); } });
  return <Modal wide title="A customer returned an item" onClose={onClose}>
    <div className="space-y-3 text-sm">
      <Field label="Find the DR / SI it was sold on (DR number, customer name or mobile)"><Input autoFocus value={text} onChange={(e) => { setText(e.target.value); setLine(null); }} placeholder="e.g. 10234 or Juan" data-testid="dr-search" /></Field>
      {!line && found.data?.map((d) => <div key={d.id} className="rounded-xl border p-2"><div className="flex flex-wrap items-center gap-2"><b>DR {d.drSiNo}</b><span className="text-xs text-slate-500">{d.date} · {d.branch} · {d.customer ?? 'no name'}{d.phone ? ` · ${d.phone}` : ''}{d.preparedBy ? ` · by ${d.preparedBy}` : ''}</span>{d.outsideWindow && <Badge tone="red">older than 30 days</Badge>}</div>
        <div className="mt-1 space-y-1">{d.lines.map((l) => <button key={l.lineId} type="button" disabled={l.available <= 0} className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left hover:bg-slate-50 disabled:opacity-40" onClick={() => { setLine({ doc: d, l }); setF((x) => ({ ...x, qty: '1' })); }}><span>{l.product}</span><span className="text-xs text-slate-500">sold {l.qty} at {peso(l.unitPrice)} · can still return {l.available}</span></button>)}</div></div>)}
      {!line && text.trim().length >= 2 && found.data && !found.data.length && <p className="text-slate-500">No DR / SI found.</p>}
      {line && <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
        <div><b>{line.l.product}</b> · DR {line.doc.drSiNo} ({line.doc.branch}, {line.doc.date}) · {line.doc.customer ?? 'customer not named'} <button className="ml-2 text-xs text-brand underline" onClick={() => setLine(null)}>change</button></div>
        <div className="grid gap-3 md:grid-cols-3"><Field label={`Quantity returned (max ${line.l.available})`}><Input type="number" min={1} max={line.l.available} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
          <Field label="Why"><Select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>{REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          {!me!.locationScoped && <Field label="Returned at (branch)"><Select value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}><option value="">—</option>{locations.data?.filter((l) => l.isSelling && l.type !== 'FRANCHISE').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>}</div>
        <Field label="What is wrong with it (notes)"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <p className="text-xs text-slate-600">After you save, attach a photo of the item on the ticket page.</p>
        <ErrorBox error={create.error} /><div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!(Number(f.qty) >= 1 && Number(f.qty) <= line.l.available) || create.isPending} onClick={() => create.mutate()} data-testid="save-ticket">Open the ticket</Button></div></div>}
    </div>
  </Modal>;
}

function NewSupplierTicket({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const { me } = useAuth(); const qc = useQueryClient();
  const [search, setSearch] = useState(''); const [p, setP] = useState<{ id: string; name: string; supplier?: { id: string; code: string } | null; onHand?: number } | null>(null);
  const [f, setF] = useState({ qty: '1', reason: 'DEFECTIVE', notes: '', supplierId: '', locationId: '' });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; type: string; isSelling: boolean }[]>('/api/locations'), enabled: !me!.locationScoped });
  const where = me!.locationScoped ? me!.locations[0]?.id : f.locationId;
  const prods = useQuery({ queryKey: ['rt-products', search, where], queryFn: () => api.get<{ id: string; name: string; sku: string; supplier?: { id: string; code: string } | null; onHand?: number }[]>(`/api/products?search=${encodeURIComponent(search)}&take=10&inStockAt=${where}&includeExpired=1`), enabled: search.length >= 2 && !!where });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<{ id: string; code: string; supplierName?: string }[]>('/api/suppliers') });
  const create = useMutation({ mutationFn: () => api.post<{ id: string }>('/api/replacements/supplier', { productId: p!.id, qty: Number(f.qty), supplierId: f.supplierId || p!.supplier?.id || undefined, reason: f.reason, notes: f.notes || undefined, locationId: f.locationId || undefined }), onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['replacements'] }); onDone(r.id); } });
  return <Modal wide title="Return items to a supplier" onClose={onClose}>
    <div className="space-y-3 text-sm">
      {!me!.locationScoped && <Field label="From (branch / warehouse)"><Select value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}><option value="">—</option>{locations.data?.filter((l) => l.type !== 'FRANCHISE' && l.type !== 'VIRTUAL' && l.type !== 'CONSIGNEE').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>}
      <Field label="Product to return"><PickedInput picked={p ? p.name : null} placeholder="Find the product (what the location has in stock)…" search={search} onSearch={setSearch} onClear={() => { setP(null); setSearch(''); }}>
        {search.length >= 2 && <ul className="absolute z-20 mt-1 max-h-48 w-full divide-y overflow-auto rounded-xl border bg-white text-sm shadow-lg">{prods.data?.map((x) => <li key={x.id}><button type="button" className="flex w-full justify-between px-3 py-2 text-left hover:bg-slate-50" onClick={() => { setP(x); setSearch(''); setF((y) => ({ ...y, supplierId: x.supplier?.id ?? '' })); }}><span>{x.name}</span><span className="text-xs text-slate-500">{x.onHand} on hand</span></button></li>)}</ul>}
      </PickedInput></Field>
      {p && <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
          <div className="grid gap-3 md:grid-cols-3"><Field label="Quantity"><Input type="number" min={1} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
            <Field label="Supplier that must replace it"><Select value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">— the product's supplier —</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.code}{s.supplierName ? ` · ${s.supplierName}` : ''}</option>)}</Select></Field>
            <Field label="Why"><Select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>{REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field></div>
          <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <p className="text-xs text-slate-600">The Head Auditor approves the return; the stock leaves only then. The ticket stays open until replacement items arrive.</p>
          <ErrorBox error={create.error} /><div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!(Number(f.qty) >= 1) || (!f.supplierId && !p.supplier) || create.isPending} onClick={() => create.mutate()} data-testid="save-ticket">Open the ticket</Button></div></div>}
    </div>
  </Modal>;
}

/** One ticket: what it is, who is involved, and what can be done next. */
export function ReplacementDetailPage() {
  const { id } = useParams(); const { me, can } = useAuth(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['replacement', id], queryFn: () => api.get<Ticket>(`/api/replacements/${id}`) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['replacement', id] }); void qc.invalidateQueries({ queryKey: ['replacements'] }); };
  const [rep, setRep] = useState(false); const [f, setF] = useState({ productId: '', name: '', qty: '', unitPrice: '', note: '', locationId: '', givenOn: '' }); const [search, setSearch] = useState('');
  const t = q.data;
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; type: string; isSelling: boolean }[]>('/api/locations'), enabled: !me!.locationScoped && rep });
  const where = me!.locationScoped ? me!.locations[0]?.id : f.locationId;
  const prods = useQuery({ queryKey: ['rt-rep-products', search, where], queryFn: () => api.get<{ id: string; name: string; onHand?: number; tierPrices: Record<string, string> }[]>(`/api/products?search=${encodeURIComponent(search)}&take=8&inStockAt=${where}`), enabled: search.length >= 2 && !!where });
  const replace = useMutation({ mutationFn: () => api.post(`/api/replacements/${id}/replace`, { productId: f.productId || undefined, qty: f.qty ? Number(f.qty) : undefined, unitPrice: f.unitPrice ? Number(f.unitPrice) : undefined, note: f.note || undefined, locationId: f.locationId || undefined, givenOn: f.givenOn || undefined }), onSuccess: () => { setRep(false); refresh(); } });
  const cancel = useMutation({ mutationFn: (reason: string) => api.post(`/api/replacements/${id}/cancel`, { reason }), onSuccess: refresh });
  if (!t) return null;
  const franchiseUser = me!.roleKey.startsWith('FRANCHISE');
  const canTick = t.kind === 'CUSTOMER' && t.status === 'OPEN' && can('replacement.create') && !franchiseUser;
  const diff = t.priceDifference != null ? Number(t.priceDifference) : null;
  return <div className="mx-auto max-w-4xl space-y-4">
    <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold tracking-tight text-navy">{t.ticketNo}</h1><Badge tone={tone(t.status)}>{STATUS[t.status] ?? t.status}</Badge><Badge>{t.kind === 'CUSTOMER' ? 'Customer return' : 'Return to supplier'}</Badge><span className="ml-auto text-sm text-slate-500">{t.ageDays} day(s) {t.closedAt ? 'to close' : 'open'}</span></div>
    <Card><dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">{([['Item', t.product?.name], ['Qty', t.qty], ['Reason', t.reason.replace('_', ' ').toLowerCase()], ['Opened by', `${t.createdBy} · ${t.location}`],
      ...(t.kind === 'CUSTOMER' ? [['DR / SI', t.drSiNo], ['Sold at', t.saleBranch], ['Customer', [t.customerName, t.customerPhone].filter(Boolean).join(' · ') || '—'], ['Price paid', t.unitPaid != null ? `${peso(t.unitPaid)} each` : '']] : [['Supplier', t.supplier ? (t.supplier.name ?? t.supplier.code) : ''], ['Sent', t.sentAt ? fmtDate(t.sentAt) : 'not yet'], ['Replacement arrived', `${t.receivedQty} of ${t.qty}`], ...(t.unitCost != null ? [['Cost each', peso(t.unitCost)]] : [])])] as [string, React.ReactNode][]).map(([k, v]) => <div key={k}><dt className="text-xs uppercase text-slate-500">{k}</dt><dd className="font-medium">{v}</dd></div>)}</dl>
      {t.salesDocId && <p className="mt-2 text-sm"><Link className="font-semibold text-brand underline" to={`/sales/${t.salesDocId}`}>Open the DR / SI {t.drSiNo}</Link></p>}{t.notes && <p className="mt-2 text-sm text-slate-600">Notes: {t.notes}</p>}</Card>
    {t.replaced && <Card title="Replacement given"><p className="text-sm"><b>{t.replaced.qty} × {t.replaced.product?.name}</b> at {t.replaced.unitPrice != null ? peso(t.replaced.unitPrice) : ''} each, by {t.replaced.by} at {t.replaced.branch} on {fmtDate(t.replaced.at)}.</p>
      <p className="mt-2 text-sm">Price difference against the DR: <b className={diff != null && diff !== 0 ? 'text-brand' : ''}>{diffText(t.priceDifference)}</b> {t.differenceSettledAt ? <Badge tone="green">settled {fmtDate(t.differenceSettledAt)}</Badge> : diff ? <Badge tone="amber">not yet settled</Badge> : null}</p>
      {t.replacedOn && <p className="mt-1 text-sm text-slate-600">Given on <b>{fmtDate(t.replacedOn)}</b>: the stock left on that day.</p>}
      {t.payments && t.payments.length > 0 && <ul className="mt-2 divide-y text-sm">{t.payments.map((x) => <li key={x.id} className="flex flex-wrap items-center gap-2 py-1"><span>{x.direction === 'IN' ? 'Customer paid' : 'Refunded'} <b>{peso(x.amount)}</b> by {x.mode.toLowerCase().replace('_', ' ')}{x.account ? ` (${x.account})` : ''} on {fmtDate(x.date)}</span><Badge tone={x.status === 'APPLIED' ? 'green' : x.status === 'PENDING_APPROVAL' ? 'amber' : 'red'}>{x.status === 'APPLIED' ? 'in the Daily Sales Report' : x.status === 'PENDING_APPROVAL' ? 'waiting for the Head Auditor (closed day)' : 'not approved'}</Badge></li>)}</ul>}
      {diff != null && diff !== 0 && !t.differenceSettledAt && ['REPLACED', 'CLOSED'].includes(t.status) && !t.payments?.some((x) => x.status === 'PENDING_APPROVAL') && <SettleForm t={t} id={id!} diff={diff} onDone={refresh} />}
      </Card>}
    {t.kind === 'SUPPLIER' && t.status !== 'PENDING_RETURN' && t.status !== 'CANCELLED' && <Card title="Replacement from the supplier">
      {t.receipts?.length ? <div className="sticky-head"><table className="w-full text-sm"><tbody>{t.receipts.map((r) => <tr key={r.receivingDocId + r.product} className="border-t"><td className="py-1"><Link className="text-brand underline" to={`/receiving/${r.receivingDocId}`}>{r.controlNo}</Link></td><td>{r.product}</td><td className="num">{r.qty}</td></tr>)}</tbody></table></div> : <p className="text-sm text-slate-600">Nothing has arrived yet.</p>}
      {t.status === 'CLOSED' && t.priceDifference != null && <p className="mt-2 text-sm">Value of what arrived compared with what we sent: <b>{Number(t.priceDifference) === 0 ? 'no difference' : Number(t.priceDifference) > 0 ? `${peso(t.priceDifference)} more (we owe the supplier)` : `${peso(Math.abs(Number(t.priceDifference)))} less (the supplier owes us)`}</b></p>}
      {['AWAITING_REPLACEMENT', 'PARTIAL'].includes(t.status) && can('receiving.create') && <p className="mt-2 text-sm">When the replacement arrives, create the delivery on <Link className="font-semibold text-brand underline" to={`/receiving?ticket=${t.id}`}>Supplier Deliveries</Link> and choose this ticket. Only that arrival closes the ticket.</p>}</Card>}
    {t.closedNote && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{t.closedNote}</p>}
    {canTick && !rep && <Card title="Tick: the replacement was given"><p className="mb-2 text-sm text-slate-600">Any branch except a franchise can give the customer the replacement. Choose the product given (the same one by default); the price difference against the DR is worked out for you.</p><Button onClick={() => { setF((x) => ({ ...x, productId: '', name: '', givenOn: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10), unitPrice: t.suggestedPrice != null ? String(t.suggestedPrice) : '' })); setSearch(''); setRep(true); }} data-testid="tick-replace">We gave the replacement</Button></Card>}
    {canTick && rep && <Card title="The replacement given">
      <div className="grid gap-3 md:grid-cols-3">{!me!.locationScoped && <Field label="Given at (branch)"><Select value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}><option value="">—</option>{locations.data?.filter((l) => l.isSelling && l.type !== 'FRANCHISE').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>}
        <Field label="Product given"><PickedInput picked={f.productId ? f.name : null} fallback={`${t.product?.name ?? 'the same product'} (same as returned)`} search={search} onSearch={setSearch}
          onClear={() => { setF({ ...f, productId: '', name: '', unitPrice: t.suggestedPrice != null ? String(t.suggestedPrice) : '' }); setSearch(''); }}>
          {search.length >= 2 && <ul className="absolute z-20 mt-1 max-h-48 w-full divide-y overflow-auto rounded-xl border bg-white text-sm shadow-lg">{prods.data?.map((x) => <li key={x.id}><button type="button" className="flex w-full justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50" onClick={() => { const pr = x.tierPrices?.[t.priceTier ?? 'RETAIL']; setF({ ...f, productId: x.id, name: x.name, unitPrice: pr != null ? String(pr) : '' }); setSearch(''); }}><span>{x.name}</span><span className="text-xs text-slate-500">{x.onHand} on hand{x.tierPrices?.[t.priceTier ?? 'RETAIL'] ? ` · ${peso(x.tierPrices[t.priceTier ?? 'RETAIL'])}` : ''}</span></button></li>)}{!prods.data?.length && <li className="px-3 py-2 text-slate-500">Nothing found in stock here.</li>}</ul>}
        </PickedInput></Field>
        <Field label={`Quantity (default ${t.qty})`}><Input type="number" min={1} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
        <Field label="Price each" hint="Filled in from the price list. You may change it."><Input type="number" step="0.01" value={f.unitPrice} onChange={(e) => setF({ ...f, unitPrice: e.target.value })} /></Field>
        <Field label="Day the replacement was given" hint="The stock leaves on this day, so the day's inventory changes. A day that is already closed is approved by the Head Auditor."><Input type="date" max={new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)} value={f.givenOn} onChange={(e) => setF({ ...f, givenOn: e.target.value })} /></Field></div>
      <Field label="Note (optional)" className="mt-3"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      <ErrorBox error={replace.error} /><div className="mt-3 flex gap-2"><Button disabled={replace.isPending} onClick={() => replace.mutate()} data-testid="save-replace">Save: replacement given</Button><Button variant="outline" onClick={() => setRep(false)}>Cancel</Button></div></Card>}
    {['OPEN', 'PENDING_RETURN'].includes(t.status) && can('replacement.create') && <div><Button variant="danger" size="sm" disabled={cancel.isPending} onClick={() => { const r = window.prompt('Why is this ticket cancelled?'); if (r && r.trim().length >= 3) cancel.mutate(r.trim()); }}>Cancel this ticket</Button><ErrorBox error={cancel.error} /></div>}
    <Attachments type="ReplacementTicket" id={t.id} title="Photos and papers (the returned item, the DR, the supplier's note)" uploadLabel="Attach a photo" />
  </div>;
}

/** How the customer settled the price difference (or how it was refunded), and the day: it goes into that day's Daily Sales Report as a replacement payment. */
function SettleForm({ t, id, diff, onDone }: { t: Ticket; id: string; diff: number; onDone: () => void }) {
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const [open, setOpen] = useState(false); const [f, setF] = useState({ mode: 'CASH', accountId: '', date: t.replacedOn ?? today, note: '' }); const [info, setInfo] = useState('');
  const accts = useQuery({ queryKey: ['payment-accounts', t.replacedLocationId], queryFn: () => api.get<{ id: string; title: string }[]>(`/api/accounts/payment?locationId=${t.replacedLocationId}`), enabled: open && f.mode !== 'CASH' && !!t.replacedLocationId });
  const save = useMutation({ mutationFn: () => api.post<Ticket>(`/api/replacements/${id}/settle`, t.saleOnCredit ? { date: f.date, note: f.note || undefined } : { mode: f.mode, paymentAccountId: f.mode === 'CASH' ? null : f.accountId, date: f.date, note: f.note || undefined }), onSuccess: (r) => { setInfo(r.payments?.some((x) => x.status === 'PENDING_APPROVAL') ? 'That day is already closed, so the Head Auditor must approve it first. It joins that day\'s report once approved.' : 'Saved. It shows in the Daily Sales Report of that day as a replacement payment.'); setOpen(false); onDone(); } });
  const back = diff < 0; const late = f.date < today;
  return <div className="mt-2">
    {info && <p className="mb-2 rounded-xl bg-emerald-50 p-2 text-sm text-emerald-800">{info}</p>}
    {!open ? <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="settle">{back ? 'Record the refund given to the customer' : 'Record the payment of the difference'}</Button>
      : <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
        <div className="text-sm font-semibold">{back ? 'How was the refund given?' : 'How did the customer pay the difference?'} <span className="font-normal text-slate-600">({peso(Math.abs(diff))})</span></div>
        <div className="grid gap-3 md:grid-cols-3">
          {!t.saleOnCredit && <Field label={back ? 'Refunded by' : 'Paid by'}><Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value, accountId: '' })}><option value="CASH">Cash</option><option value="ONLINE">Online (bank / GCash)</option><option value="CREDIT_CARD">Credit card</option></Select></Field>}
          {!t.saleOnCredit && f.mode !== 'CASH' && <Field label="Bank / GCash / card account"><Select value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}><option value="">— choose the account —</option>{accts.data?.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</Select></Field>}
          <Field label="Day it was paid" hint="The Daily Sales Report and the books of this day show it, apart from normal sales."><Input type="date" min={t.replacedOn ?? undefined} max={today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        </div>
        {late && <p className="rounded-lg bg-amber-100 p-2 text-xs text-amber-900">This is a past day. If that day is already closed, the Head Auditor must approve it before it joins the report.</p>}
        {t.saleOnCredit && <p className="text-xs text-slate-600">The sale was on credit, so the difference goes to the customer's receivable instead of cash.</p>}
        <Field label="Note (optional)"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <ErrorBox error={save.error} />
        <div className="flex gap-2"><Button disabled={save.isPending || (!t.saleOnCredit && f.mode !== 'CASH' && !f.accountId)} onClick={() => save.mutate()}>Save</Button><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
      </div>}
  </div>;
}
