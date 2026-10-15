import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { api, fmtDate, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';

interface AvRow { id: string; listNo: string; status: string; notes: string | null; createdByName: string | null; createdAt: string; publishedAt: string | null; items: number; units: number }
interface Flavor { flavor: string | null; qty: number; remaining: number; max?: number }
interface AvLine { id: string; productId: string; sku: string; product: string; brand: string | null; systemQty: number; qty: number; franchisePrice: number | null; flavors: Flavor[] }
interface Av { id: string; listNo: string; status: string; notes: string | null; createdByName: string | null; createdAt: string; reviewedByName: string | null; publishedTo: { id: string; name: string }[]; lines: AvLine[]; myOrder: { id: string; orderNo: string; status: string; lines: { productId: string; flavor: string | null; qty: number }[] } | null }
interface OrderRow { id: string; orderNo: string; listNo: string; availabilityId: string; franchise: string; status: string; orderedAt: string; orderedByName: string | null; picklistNo: string | null; salesDocId: string | null; lines: number; pcs: number }
interface OrderLine { id: string; productId: string; sku: string; product: string; flavor: string | null; qty: number; checkedQty: number | null; price: number | null }
interface Order { id: string; orderNo: string; listNo: string; availabilityId: string; franchise: string; status: string; notes: string | null; orderedByName: string | null; orderedAt: string; picklistNo: string | null; checkedByName: string | null; checkNote: string | null; cancelReason: string | null; dr: { id: string; drSiNo: string } | null; lines: OrderLine[] }

const AV_STATUS: Record<string, { label: string; tone: 'amber' | 'blue' | 'green' | 'slate' }> = { WAREHOUSE_REVIEW: { label: 'with the warehouse for checking', tone: 'amber' }, FOR_COORDINATOR: { label: 'checked: the Coordinator sends it to the franchises', tone: 'blue' }, PUBLISHED: { label: 'open for orders', tone: 'green' }, CLOSED: { label: 'closed', tone: 'slate' } };
const ORDER_STATUS: Record<string, { label: string; tone: 'amber' | 'blue' | 'green' | 'slate' | 'red' }> = { ORDERED: { label: 'ordered', tone: 'amber' }, PICKLIST: { label: 'picklist: being prepared', tone: 'blue' }, CHECKING: { label: 'final check by the warehouse', tone: 'amber' }, APPROVED: { label: 'approved: make the DR', tone: 'green' }, DR_MADE: { label: 'DR made', tone: 'green' }, CANCELLED: { label: 'cancelled', tone: 'red' } };
const fl = (f: string | null) => f ?? 'no flavor';

/** Franchise availability lists and the orders made from them. */
export function FranchiseOrdersPage() {
  const { can, me } = useAuth(); const nav = useNavigate(); const qc = useQueryClient();
  const av = useQuery({ queryKey: ['fo-av'], queryFn: () => api.get<AvRow[]>('/api/franchise-orders/availability') });
  const orders = useQuery({ queryKey: ['fo-orders'], queryFn: () => api.get<OrderRow[]>('/api/franchise-orders/orders') });
  const gen = useMutation({ mutationFn: () => api.post<Av>('/api/franchise-orders/availability', {}), onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['fo-av'] }); nav(`/franchise-orders/availability/${r.id}`); } });
  const franchiseUser = me?.roleKey === 'FRANCHISE_OWNER' || me?.roleKey === 'FRANCHISE_SALES_ASSOCIATE';
  const avCols: ColumnDef<AvRow, unknown>[] = [{ header: 'List', accessorKey: 'listNo' }, { header: 'Date', accessorFn: (r) => fmtDate(r.createdAt) }, { header: 'Items', accessorKey: 'items' }, { header: 'Pieces', accessorKey: 'units' }, { header: 'Where it stands', cell: (c) => <Badge tone={AV_STATUS[c.row.original.status]?.tone ?? 'slate'}>{AV_STATUS[c.row.original.status]?.label ?? c.row.original.status}</Badge> }, { header: 'Made by', accessorKey: 'createdByName' }];
  const orCols: ColumnDef<OrderRow, unknown>[] = [{ header: 'Order', accessorKey: 'orderNo' }, { header: 'Picklist', accessorKey: 'picklistNo' }, { header: 'Franchise', accessorKey: 'franchise' }, { header: 'List', accessorKey: 'listNo' }, { header: 'Lines', accessorKey: 'lines' }, { header: 'Pieces', accessorKey: 'pcs' }, { header: 'Where it stands', cell: (c) => <Badge tone={ORDER_STATUS[c.row.original.status]?.tone ?? 'slate'}>{ORDER_STATUS[c.row.original.status]?.label ?? c.row.original.status}</Badge> }, { header: 'Ordered', accessorFn: (r) => fmtDate(r.orderedAt) }];
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Franchise Orders</h1>{can('fo.generate') && <Button disabled={gen.isPending} onClick={() => gen.mutate()}>{gen.isPending ? 'Reading the stock…' : 'Generate availability'}</Button>}</div>
    <Card title="How it works"><ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
      <li>The <b>Franchise Coordinator</b> generates the availability: what the warehouse has for the franchises, from the system stock, flavor by flavor.</li>
      <li>The <b>Warehouse In-Charge</b> checks it: removes what cannot be given and edits the quantity and the flavors available, then sends it back to the Coordinator.</li>
      <li>The Coordinator sends it to the franchises. Each franchise is told, sees the available products, and puts the <b>quantity it orders</b> (flavor by flavor).</li>
      <li>The order becomes a <b>picklist</b> for the Coordinator, who prints it for preparation and sends it to the warehouse for the <b>final check</b>.</li>
      <li>Once the warehouse approves, the Coordinator generates the <b>DR</b>: the franchise is told, checks the goods and confirms receipt (Franchise DRs).</li>
    </ol></Card>
    <ErrorBox error={gen.error} />
    <Card title={franchiseUser ? 'Products available to order' : 'Availability lists'}>{av.data?.length ? <DataTable exportName="FranchiseAvailability" search={false} data={av.data} onRowClick={(r) => nav(`/franchise-orders/availability/${r.id}`)} columns={avCols} /> : <Empty>{franchiseUser ? 'No list is open for your franchise right now.' : 'No availability list yet.'}</Empty>}</Card>
    <Card title={franchiseUser ? 'My orders' : 'Orders'}>{orders.data?.length ? <DataTable exportName="FranchiseOrders" search={false} data={orders.data} onRowClick={(r) => nav(`/franchise-orders/order/${r.id}`)} columns={orCols} /> : <Empty>No orders yet.</Empty>}</Card>
  </div>;
}

/** One availability list: the warehouse edits it, the Coordinator sends it, a franchise orders from it. */
export function AvailabilityPage() {
  const { id } = useParams(); const { can, me } = useAuth(); const qc = useQueryClient(); const nav = useNavigate();
  const q = useQuery({ queryKey: ['fo-av', id], queryFn: () => api.get<Av>(`/api/franchise-orders/availability/${id}`) }); const a = q.data;
  const orders = useQuery({ queryKey: ['fo-orders', id], queryFn: () => api.get<OrderRow[]>(`/api/franchise-orders/orders?availabilityId=${id}`), enabled: !!a && a.status !== 'WAREHOUSE_REVIEW' });
  const franchises = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; type: string }[]>('/api/locations'), enabled: a?.status === 'FOR_COORDINATOR' && can('fo.generate') });
  const [edits, setEdits] = useState<Record<string, Record<string, number>>>({}); const [removed, setRemoved] = useState<Set<string>>(new Set()); const [pick, setPick] = useState<string[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({}); const [notes, setNotes] = useState('');
  useEffect(() => { if (a?.myOrder) { const m: Record<string, number> = {}; for (const l of a.myOrder.lines) m[`${l.productId}|${l.flavor ?? ''}`] = l.qty; setQty(m); } }, [a?.myOrder?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => { setEdits({}); setRemoved(new Set()); void qc.invalidateQueries({ queryKey: ['fo-av'] }); void qc.invalidateQueries({ queryKey: ['fo-orders'] }); };
  const franchiseUser = me?.roleKey === 'FRANCHISE_OWNER' || me?.roleKey === 'FRANCHISE_SALES_ASSOCIATE';
  const buildReview = () => ({ lines: [...removed].map((lineId) => ({ lineId, remove: true })).concat(Object.entries(edits).filter(([lineId]) => !removed.has(lineId)).map(([lineId, fl]) => ({ lineId, remove: false, flavors: Object.entries(fl).map(([f, n]) => ({ flavor: f === '' ? null : f, qty: n })) } as never))) });
  const save = useMutation({ mutationFn: () => api.put(`/api/franchise-orders/availability/${id}`, buildReview()), onSuccess: refresh });
  const send = useMutation({ mutationFn: async () => { if (removed.size || Object.keys(edits).length) await api.put(`/api/franchise-orders/availability/${id}`, buildReview()); return api.post(`/api/franchise-orders/availability/${id}/send-to-coordinator`); }, onSuccess: refresh });
  const act = useMutation({ mutationFn: (x: { path: string; body?: unknown }) => api.post(`/api/franchise-orders/availability/${id}/${x.path}`, x.body ?? {}), onSuccess: refresh });
  const order = useMutation({ mutationFn: () => api.post<{ id: string }>(`/api/franchise-orders/availability/${id}/order`, { lines: Object.entries(qty).filter(([, n]) => n > 0).map(([k, n]) => { const [productId, f] = k.split('|'); return { productId, flavor: f === '' ? null : f, qty: n }; }), notes: notes || undefined }), onSuccess: (r) => { refresh(); nav(`/franchise-orders/order/${r.id}`); } });
  if (!a) return null;
  const review = a.status === 'WAREHOUSE_REVIEW' && can('fo.review');
  const flavorQty = (l: AvLine, f: Flavor) => edits[l.id]?.[f.flavor ?? ''] ?? f.qty;
  const setFlavor = (l: AvLine, f: Flavor, v: number) => { const cur = edits[l.id] ?? Object.fromEntries(l.flavors.map((x) => [x.flavor ?? '', x.qty])); setEdits({ ...edits, [l.id]: { ...cur, [f.flavor ?? '']: v } }); };
  const orderTotal = Object.values(qty).reduce((n, v) => n + (v || 0), 0);
  const orderValue = a.lines.reduce((t, l) => t + l.flavors.reduce((n, f) => n + (qty[`${l.productId}|${f.flavor ?? ''}`] || 0) * (l.franchisePrice ?? 0), 0), 0);
  const canOrder = a.status === 'PUBLISHED' && franchiseUser && can('fo.order') && (!a.myOrder || a.myOrder.status === 'ORDERED');
  return <div className="mx-auto max-w-5xl space-y-4">
    <div className="flex flex-wrap items-center gap-2"><Link className="text-sm text-brand underline" to="/franchise-orders">← Franchise Orders</Link><h1 className="text-2xl font-bold tracking-tight text-navy">{a.listNo}</h1><Badge tone={AV_STATUS[a.status]?.tone ?? 'slate'}>{AV_STATUS[a.status]?.label ?? a.status}</Badge></div>
    <p className="text-sm text-slate-600">Made by {a.createdByName} on {fmtDate(a.createdAt)}{a.reviewedByName ? ` · checked by ${a.reviewedByName}` : ''}{a.publishedTo.length ? ` · sent to ${a.publishedTo.map((x) => x.name).join(', ')}` : ''}{a.notes ? ` · ${a.notes}` : ''}</p>
    <ErrorBox error={q.error ?? save.error ?? send.error ?? act.error ?? order.error} />
    {review && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><b>Your check:</b> take out the items that cannot be given to the franchises (✕), and change the quantity of each flavor available (never more than the system stock). Then <b>send it to the Franchise Coordinator</b>.</p>}
    {a.status === 'FOR_COORDINATOR' && can('fo.generate') && <Card title="Send it to the franchises"><p className="mb-2 text-sm text-slate-600">The warehouse has checked the list. Tick the franchises that may order from it (none ticked = every franchise); each one is told.</p>
      <div className="grid max-h-48 gap-1 overflow-auto rounded-xl border p-2 sm:grid-cols-3">{franchises.data?.filter((l) => l.type === 'FRANCHISE').map((l) => <label key={l.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pick.includes(l.id)} onChange={(e) => setPick(e.target.checked ? [...pick, l.id] : pick.filter((x) => x !== l.id))} />{l.name}</label>)}</div>
      <div className="mt-3 flex gap-2"><Button disabled={act.isPending} onClick={() => act.mutate({ path: 'publish', body: { franchiseIds: pick.length ? pick : undefined } })}>Send to the franchises</Button><Button variant="outline" disabled={act.isPending} onClick={() => act.mutate({ path: 'return-to-warehouse' })}>Send back to the warehouse</Button></div></Card>}
    <Card title={canOrder ? 'Choose what you order' : 'Products and flavors available'}>
      {canOrder && <p className="mb-2 text-sm text-slate-600">Put the quantity you want for each flavor (not more than what is still available). Prices are your franchise prices.</p>}
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1">Product</th><th>Flavor</th><th className="num">{review ? 'System stock' : 'Available'}</th>{review && <th>Offer</th>}{canOrder && <th>I order</th>}{a.lines.some((l) => l.franchisePrice != null) && <th className="num">Price</th>}{review && <th />}</tr></thead><tbody>
        {a.lines.filter((l) => !removed.has(l.id)).map((l) => l.flavors.map((f, i) => <tr key={`${l.id}-${f.flavor}`} className="border-t">
          <td className="py-1.5">{i === 0 ? <><b>{l.product}</b> <span className="text-xs text-slate-400">{l.sku}</span></> : ''}</td><td>{fl(f.flavor)}</td>
          <td className="num">{review ? (f.max ?? 0) : canOrder ? f.remaining : f.qty}</td>
          {review && <td><Input type="number" min={0} max={f.max} className="w-24" value={flavorQty(l, f)} onChange={(e) => setFlavor(l, f, Math.min(f.max ?? 0, Math.max(0, Math.floor(Number(e.target.value) || 0))))} /></td>}
          {canOrder && <td><Input type="number" min={0} max={f.remaining} className="w-24" disabled={f.remaining <= 0} value={qty[`${l.productId}|${f.flavor ?? ''}`] ?? 0} onChange={(e) => setQty({ ...qty, [`${l.productId}|${f.flavor ?? ''}`]: Math.min(f.remaining, Math.max(0, Math.floor(Number(e.target.value) || 0))) })} /></td>}
          {a.lines.some((x) => x.franchisePrice != null) && <td className="num">{i === 0 && l.franchisePrice != null ? peso(l.franchisePrice) : ''}</td>}
          {review && <td>{i === 0 && <button className="text-red-600" onClick={() => setRemoved(new Set([...removed, l.id]))} aria-label="Remove the item">✕ remove item</button>}</td>}
        </tr>))}</tbody></table></div>
      {removed.size > 0 && <p className="mt-2 text-xs text-slate-500">{removed.size} item(s) will be taken out of the list. <button className="text-brand underline" onClick={() => setRemoved(new Set())}>undo</button></p>}
      {review && <div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" disabled={save.isPending || (!removed.size && !Object.keys(edits).length)} onClick={() => save.mutate()}>Save my changes</Button><Button disabled={send.isPending} onClick={() => send.mutate()}>Send to the Franchise Coordinator</Button></div>}
      {canOrder && <div className="mt-3 space-y-2"><Field label="Note for the order (optional)"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field><div className="flex flex-wrap items-center gap-3"><Button disabled={order.isPending || orderTotal === 0} onClick={() => order.mutate()}>{a.myOrder ? 'Change my order' : 'Send my order'}</Button><span className="text-sm text-slate-600">{orderTotal} pcs{orderValue > 0 ? ` · ${peso(orderValue)}` : ''}</span>{a.myOrder && <Link className="text-sm text-brand underline" to={`/franchise-orders/order/${a.myOrder.id}`}>my order {a.myOrder.orderNo}</Link>}</div></div>}
      {franchiseUser && a.myOrder && !canOrder && <p className="mt-2 text-sm text-slate-600">Your order {a.myOrder.orderNo} has gone to the warehouse. <Link className="text-brand underline" to={`/franchise-orders/order/${a.myOrder.id}`}>Open it</Link></p>}
    </Card>
    {!franchiseUser && a.status !== 'WAREHOUSE_REVIEW' && <Card title="Orders from this list">{orders.data?.length ? <ul className="divide-y text-sm">{orders.data.map((o) => <li key={o.id} className="flex flex-wrap items-center gap-2 py-1.5"><Link className="font-semibold text-brand underline" to={`/franchise-orders/order/${o.id}`}>{o.orderNo}</Link><span>{o.franchise}</span><span className="text-slate-500">{o.pcs} pcs</span><Badge tone={ORDER_STATUS[o.status]?.tone ?? 'slate'}>{ORDER_STATUS[o.status]?.label ?? o.status}</Badge></li>)}</ul> : <Empty>No order yet.</Empty>}{can('fo.generate') && a.status === 'PUBLISHED' && <Button className="mt-2" size="sm" variant="outline" onClick={() => { if (confirm('Close this list? Franchises can no longer order from it.')) act.mutate({ path: 'close' }); }}>Close this list</Button>}</Card>}
  </div>;
}

/** One order: the picklist for the Coordinator, the warehouse's final check and the DR. */
export function FranchiseOrderPage() {
  const { id } = useParams(); const { can, me } = useAuth(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['fo-order', id], queryFn: () => api.get<Order>(`/api/franchise-orders/orders/${id}`) }); const o = q.data;
  const [checked, setChecked] = useState<Record<string, number>>({}); const [note, setNote] = useState(''); const [dr, setDr] = useState({ drSiNo: '', paymentMode: 'AR_PDC', dueDate: '', shipping: 'NONE' });
  const refresh = () => { setChecked({}); void qc.invalidateQueries({ queryKey: ['fo-order'] }); void qc.invalidateQueries({ queryKey: ['fo-orders'] }); void qc.invalidateQueries({ queryKey: ['fo-av'] }); void qc.invalidateQueries({ queryKey: ['franchise-drs'] }); };
  const act = useMutation({ mutationFn: (x: { path: string; body?: unknown }) => api.post(`/api/franchise-orders/orders/${id}/${x.path}`, x.body ?? {}), onSuccess: refresh });
  if (!o) return null;
  const franchiseUser = me?.roleKey === 'FRANCHISE_OWNER' || me?.roleKey === 'FRANCHISE_SALES_ASSOCIATE';
  const coord = can('fo.generate'); const wh = can('fo.review');
  const total = o.lines.reduce((n, l) => n + (l.checkedQty ?? l.qty), 0); const value = o.lines.reduce((t, l) => t + (l.checkedQty ?? l.qty) * (l.price ?? 0), 0);
  const print = () => api.download(`/api/franchise-orders/orders/${id}/picklist.pdf`, `${o.picklistNo ?? o.orderNo}.pdf`);
  return <div className="mx-auto max-w-4xl space-y-4">
    <div className="flex flex-wrap items-center gap-2"><Link className="text-sm text-brand underline" to="/franchise-orders">← Franchise Orders</Link><h1 className="text-2xl font-bold tracking-tight text-navy">{o.orderNo}</h1><Badge tone={ORDER_STATUS[o.status]?.tone ?? 'slate'}>{ORDER_STATUS[o.status]?.label ?? o.status}</Badge>{o.picklistNo && <Badge tone="blue">{o.picklistNo}</Badge>}</div>
    <p className="text-sm text-slate-600">{o.franchise} · from list {o.listNo} · ordered by {o.orderedByName} on {fmtDate(o.orderedAt)}{o.notes ? ` · ${o.notes}` : ''}</p>
    <ErrorBox error={q.error ?? act.error} />
    {o.checkNote && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Warehouse note: {o.checkNote}</p>}{o.cancelReason && <p className="rounded-xl bg-brand-soft p-3 text-sm text-brand-dark">Cancelled: {o.cancelReason}</p>}
    <Card title="Items"><table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Product</th><th>Flavor</th><th className="num">Ordered</th>{(o.status !== 'ORDERED' && !franchiseUser) && <th className="num">Checked by the warehouse</th>}{o.lines.some((l) => l.price != null) && <th className="num">Price</th>}</tr></thead><tbody>
      {o.lines.map((l) => <tr key={l.id} className="border-t"><td className="py-1.5">{l.product} <span className="text-xs text-slate-400">{l.sku}</span></td><td>{fl(l.flavor)}</td><td className="num">{l.qty}</td>
        {(o.status !== 'ORDERED' && !franchiseUser) && <td className="num">{wh && o.status === 'CHECKING' ? <Input type="number" min={0} max={l.qty} className="ml-auto w-24" value={checked[l.id] ?? l.checkedQty ?? l.qty} onChange={(e) => setChecked({ ...checked, [l.id]: Math.min(l.qty, Math.max(0, Math.floor(Number(e.target.value) || 0))) })} /> : l.checkedQty ?? ''}</td>}
        {o.lines.some((x) => x.price != null) && <td className="num">{l.price != null ? peso(l.price) : ''}</td>}</tr>)}</tbody>
      <tfoot><tr className="border-t font-semibold"><td colSpan={2} className="py-1.5">Total</td><td className="num">{o.lines.reduce((n, l) => n + l.qty, 0)}</td>{(o.status !== 'ORDERED' && !franchiseUser) && <td className="num">{total}</td>}{o.lines.some((l) => l.price != null) && <td className="num">{peso(value)}</td>}</tr></tfoot></table></Card>
    <div className="flex flex-wrap gap-2">
      {coord && o.status === 'ORDERED' && <Button disabled={act.isPending} onClick={() => act.mutate({ path: 'picklist' })}>Generate the picklist</Button>}
      {(coord || wh) && o.picklistNo && <Button variant="outline" onClick={print}>Print the picklist (for preparation)</Button>}
      {coord && o.status === 'PICKLIST' && <Button disabled={act.isPending} onClick={() => act.mutate({ path: 'send-to-warehouse' })}>Prepared: send to the warehouse for the final check</Button>}
      {(coord || (franchiseUser && o.status === 'ORDERED')) && !['DR_MADE', 'CANCELLED'].includes(o.status) && <Button variant="ghost" onClick={() => { const r = prompt('Why is this order cancelled?'); if (r && r.trim().length >= 3) act.mutate({ path: 'cancel', body: { reason: r.trim() } }); }}>Cancel the order</Button>}
    </div>
    {wh && o.status === 'CHECKING' && <Card title="Final check by the warehouse"><p className="mb-2 text-sm text-slate-600">Check the prepared goods against the picklist. Change a quantity above if something is short, then approve. If something is wrong with the preparation, send it back with a note.</p>
      <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. only 10 boxes found" /></Field>
      <div className="mt-2 flex gap-2"><Button disabled={act.isPending} onClick={() => act.mutate({ path: 'check', body: { decision: 'APPROVE', note: note || undefined, lines: Object.entries(checked).map(([lineId, checkedQty]) => ({ lineId, checkedQty })) } })}>Approve</Button><Button variant="outline" disabled={act.isPending || note.trim().length < 3} onClick={() => act.mutate({ path: 'check', body: { decision: 'RETURN', note, lines: Object.entries(checked).map(([lineId, checkedQty]) => ({ lineId, checkedQty })) } })}>Send back to the coordinator</Button></div></Card>}
    {coord && o.status === 'APPROVED' && <Card title="Generate the DR"><p className="mb-2 text-sm text-slate-600">The warehouse approved this order{o.checkedByName ? ` (${o.checkedByName})` : ''}. The DR is made for the checked quantities, from the warehouse batches of each flavor (nearest expiry first). The franchise is told and checks the goods; unpaid goods show in Franchise AR.</p>
      <div className="grid gap-3 md:grid-cols-3"><Field label="DR number"><Input value={dr.drSiNo} onChange={(e) => setDr({ ...dr, drSiNo: e.target.value })} /></Field><Field label="Payment"><Select value={dr.paymentMode} onChange={(e) => setDr({ ...dr, paymentMode: e.target.value })}><option value="AR_PDC">On credit (Franchise AR)</option><option value="CASH">Paid in cash</option></Select></Field>{dr.paymentMode === 'AR_PDC' && <Field label="Due date" hint="Left empty: the usual terms."><Input type="date" min={today()} value={dr.dueDate} onChange={(e) => setDr({ ...dr, dueDate: e.target.value })} /></Field>}</div>
      <Field label="Shipping charge" className="mt-2 max-w-xs"><Select value={dr.shipping} onChange={(e) => setDr({ ...dr, shipping: e.target.value })}><option value="NONE">None</option><option value="TO_FOLLOW">To follow (fill in within 2 days)</option></Select></Field>
      <Button className="mt-3" disabled={!dr.drSiNo.trim() || act.isPending} onClick={() => act.mutate({ path: 'make-dr', body: { drSiNo: dr.drSiNo, paymentMode: dr.paymentMode, dueDate: dr.paymentMode === 'AR_PDC' && dr.dueDate ? dr.dueDate : undefined, franchiseShipping: { mode: dr.shipping } } })}>Generate the DR</Button></Card>}
    {o.dr && <Card><p className="text-sm">DR made: <Link className="font-semibold text-brand underline" to={`/sales/${o.dr.id}`}>{o.dr.drSiNo}</Link>. The franchise confirms receipt under <Link className="text-brand underline" to="/franchise-drs">Franchise DRs</Link>.</p></Card>}
  </div>;
}
