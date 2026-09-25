import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Field, Input, Select, statusTone } from './ui/primitives';

type Kind = 'receiving' | 'transfers';
interface EditReq { id: string; status: string; createdAt: string; decidedAt: string | null; proposedBy?: string; preparedBy?: string; changes: string[]; awaitingMe: boolean; decisions: { by: string; decision: string; note: string | null; at: string }[] }

/**
 * Who may change a warehouse document before it is approved:
 * - the person who prepared it edits it directly;
 * - the Warehouse In-Charge (or Admin) proposes an edit that the preparer must accept.
 */
export function useEditRights(doc: { status: string; preparedBy?: string | null }, createPermission: string, senderSide = true) {
  const { me, can } = useAuth();
  const editable = ['DRAFT', 'SUBMITTED'].includes(doc.status);
  const own = !!doc.preparedBy && doc.preparedBy === me?.id;
  return { canEdit: editable && ((own && can(createPermission)) || (!own && senderSide && can('warehouse.edit_others'))), own };
}

/** Pending / past edit requests on a document, with Accept / Reject for the preparer. */
export function EditRequests({ kind, id }: { kind: Kind; id: string }) {
  const qc = useQueryClient(); const [note, setNote] = useState('');
  const q = useQuery({ queryKey: ['edits', kind, id], queryFn: () => api.get<EditReq[]>(`/api/${kind}/${id}/edits`) });
  const decide = useMutation({
    mutationFn: ({ reqId, decision }: { reqId: string; decision: 'APPROVE' | 'REJECT' }) => api.post(`/api/approvals/${reqId}/decide`, { decision, note: note || undefined }),
    onSuccess: () => { setNote(''); for (const k of [['edits', kind, id], [kind === 'receiving' ? 'receiving' : 'transfer', id], ['approvals-count'], ['history']]) void qc.invalidateQueries({ queryKey: k }); },
  });
  if (!q.data?.length) return null;
  const pending = q.data.filter((r) => r.status === 'PENDING'); const past = q.data.filter((r) => r.status !== 'PENDING');
  return <Card title="Edits to this document">
    {pending.map((r) => <div key={r.id} className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
      <div className="font-medium">{r.proposedBy} proposed changes — waiting for {r.awaitingMe ? 'your acceptance' : `${r.preparedBy}'s acceptance`}. Nothing changes until then.</div>
      <ul className="mt-1 list-disc pl-5">{r.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
      {r.awaitingMe && <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ reqId: r.id, decision: 'APPROVE' })}>Accept changes</Button>
        <Button size="sm" variant="danger" disabled={decide.isPending} onClick={() => decide.mutate({ reqId: r.id, decision: 'REJECT' })}>Reject</Button>
      </div>}
    </div>)}
    <ErrorBox error={decide.error} />
    {past.length > 0 && <ul className="divide-y text-sm">{past.map((r) => <li key={r.id} className="py-2">
      <div className="flex flex-wrap items-center gap-2"><Badge tone={statusTone(r.status)}>{r.status === 'APPROVED' ? 'ACCEPTED' : r.status}</Badge><span>by {r.proposedBy}</span><span className="text-xs text-slate-500">{new Date(r.createdAt).toLocaleString()}</span>{r.decisions.map((d, i) => <span key={i} className="text-xs text-slate-500">· {d.decision === 'APPROVE' ? 'accepted' : 'rejected'} by {d.by}{d.note ? ` ("${d.note}")` : ''}</span>)}</div>
      <ul className="list-disc pl-5 text-xs text-slate-600">{r.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
    </li>)}</ul>}
  </Card>;
}

/** Everything done to the document, with the person who did it (accounts are personal). */
export function History({ entityType, id }: { entityType: string; id: string }) {
  const q = useQuery({ queryKey: ['history', entityType, id], queryFn: () => api.get<{ at: string; action: string; by: string; username: string | null; idNumber: string | null; role: string | null; ip: string | null; note?: string | null }[]>(`/api/history/${entityType}/${id}`) });
  if (!q.data?.length) return null;
  return <Card title="Who did what">
    <table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>When</th><th>Action</th><th>Person</th><th>Role</th></tr></thead>
      <tbody>{q.data.map((h, i) => <tr key={i} className="border-t align-top"><td className="whitespace-nowrap py-1 pr-2 text-xs">{new Date(h.at).toLocaleString()}</td><td className="pr-2">{h.action.replace(/_/g, ' ').toLowerCase()}{h.note ? <span className="text-xs text-slate-500"> — "{h.note}"</span> : null}</td><td className="pr-2">{h.by}{h.idNumber ? <span className="text-xs text-slate-500"> · ID {h.idNumber}</span> : null}</td><td className="text-xs text-slate-500">{h.role ?? ''}</td></tr>)}</tbody></table>
  </Card>;
}

function ProductPicker({ onPick }: { onPick: (p: { id: string; name: string; trackExpiry?: boolean }) => void }) {
  const [search, setSearch] = useState('');
  const products = useQuery({ queryKey: ['products', search], queryFn: () => api.get<{ id: string; name: string; sku: string; trackExpiry: boolean }[]>(`/api/products?search=${encodeURIComponent(search)}&take=20`), enabled: search.length >= 2 });
  return <div><Input placeholder="Add product…" value={search} onChange={(e) => setSearch(e.target.value)} />{search.length >= 2 && <ul className="max-h-48 divide-y overflow-auto rounded border bg-white">{products.data?.map((p) => <li key={p.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { onPick(p); setSearch(''); }}>{p.name} <span className="text-xs text-slate-500">{p.sku}</span></button></li>)}</ul>}</div>;
}

function useSave(kind: Kind, id: string, onDone: (msg: string) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.put<{ applied: boolean; awaiting?: string; changes: string[] }>(`/api/${kind}/${id}/edit`, body),
    onSuccess: (r) => { for (const k of [[kind === 'receiving' ? 'receiving' : 'transfer', id], ['edits', kind, id], ['history'], [kind]]) void qc.invalidateQueries({ queryKey: k }); onDone(r.applied ? 'Saved.' : `Sent to ${r.awaiting} for acceptance. Nothing changes until they accept.`); },
  });
}

export interface RcvDoc { id: string; status: string; supplierRef: string | null; notes?: string | null; docDate: string; lines: { productId?: string; product: { id?: string; name: string; trackExpiry: boolean }; qty: number; freeQty: number; expiryDate: string | null; batchNo: string | null; remarks?: string | null }[] }
export function ReceivingEditor({ doc, own, preparedByName, onClose }: { doc: RcvDoc; own: boolean; preparedByName?: string | null; onClose: (msg?: string) => void }) {
  const [h, setH] = useState({ supplierRef: doc.supplierRef ?? '', notes: doc.notes ?? '', docDate: fmtDate(doc.docDate) });
  const [lines, setLines] = useState(doc.lines.map((l) => ({ productId: l.productId ?? l.product.id ?? '', name: l.product.name, qty: l.qty, freeQty: l.freeQty, expiryDate: fmtDate(l.expiryDate), batchNo: l.batchNo ?? '', remarks: l.remarks ?? '' })));
  const save = useSave('receiving', doc.id, onClose);
  const set = (i: number, patch: Partial<(typeof lines)[number]>) => setLines(lines.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  return <Card title={own ? 'Edit draft' : `Propose an edit (${preparedByName ?? 'the preparer'} must accept it)`}>
    {doc.status === 'SUBMITTED' && <p className="mb-2 text-xs text-amber-700">This document is waiting for cost approval. Saving sends it back through approval with the new figures.</p>}
    <div className="grid gap-3 md:grid-cols-3"><Field label="Supplier invoice / DR #"><Input value={h.supplierRef} onChange={(e) => setH({ ...h, supplierRef: e.target.value })} /></Field><Field label="Date"><Input type="date" value={h.docDate} onChange={(e) => setH({ ...h, docDate: e.target.value })} /></Field><Field label="Notes"><Input value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} /></Field></div>
    <table className="mt-3 w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Product</th><th>Qty</th><th>Free</th><th>Expiry</th><th>Batch #</th><th>Remarks</th><th /></tr></thead><tbody>{lines.map((l, i) => <tr key={i} className="border-t">
      <td>{l.name}</td><td><Input type="number" className="w-20" value={l.qty} onChange={(e) => set(i, { qty: Number(e.target.value) })} /></td><td><Input type="number" className="w-16" value={l.freeQty} onChange={(e) => set(i, { freeQty: Number(e.target.value) })} /></td>
      <td><Input type="date" value={l.expiryDate} onChange={(e) => set(i, { expiryDate: e.target.value })} /></td><td><Input className="w-24" value={l.batchNo} onChange={(e) => set(i, { batchNo: e.target.value })} /></td><td><Input value={l.remarks} onChange={(e) => set(i, { remarks: e.target.value })} /></td>
      <td><button type="button" className="text-xs text-red-700" onClick={() => setLines(lines.filter((_, k) => k !== i))}>remove</button></td></tr>)}</tbody></table>
    <div className="mt-2"><ProductPicker onPick={(p) => setLines([...lines, { productId: p.id, name: p.name, qty: 1, freeQty: 0, expiryDate: '', batchNo: '', remarks: '' }])} /></div>
    <div className="mt-3 flex gap-2"><Button disabled={!lines.length || save.isPending} onClick={() => save.mutate({ supplierRef: h.supplierRef || null, notes: h.notes || null, docDate: h.docDate || undefined, lines: lines.map((l) => ({ productId: l.productId, qty: l.qty, freeQty: l.freeQty, expiryDate: l.expiryDate || null, batchNo: l.batchNo || null, remarks: l.remarks || undefined })) })}>{own ? 'Save changes' : `Send to ${preparedByName ?? 'preparer'} for acceptance`}</Button><Button variant="outline" onClick={() => onClose()}>Cancel</Button></div>
    <ErrorBox error={save.error} />
  </Card>;
}

export interface TrDoc { id: string; status: string; transferType: string; notes: string | null; docDate: string; returnReason?: string | null; fromLocation: { id: string }; toLocation: { id: string; name: string }; lines: { productId?: string; qtySent: number; product: { id?: string; name: string } }[] }
export function TransferEditor({ doc, own, preparedByName, onClose }: { doc: TrDoc; own: boolean; preparedByName?: string | null; onClose: (msg?: string) => void }) {
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; type: string; code: string }[]>('/api/locations') });
  const [h, setH] = useState({ toLocationId: doc.toLocation.id, transferType: doc.transferType, notes: doc.notes ?? '', docDate: fmtDate(doc.docDate) });
  const grouped = new Map<string, { productId: string; name: string; qty: number }>();
  for (const l of doc.lines) { const pid = l.productId ?? l.product.id ?? ''; const cur = grouped.get(pid) ?? { productId: pid, name: l.product.name, qty: 0 }; cur.qty += l.qtySent; grouped.set(pid, cur); }
  const [lines, setLines] = useState([...grouped.values()]);
  const save = useSave('transfers', doc.id, onClose);
  return <Card title={own ? 'Edit draft' : `Propose an edit (${preparedByName ?? 'the preparer'} must accept it)`}>
    {doc.status === 'SUBMITTED' && <p className="mb-2 text-xs text-amber-700">This transfer is waiting for approval. Saving sends it back through approval with the new figures.</p>}
    <div className="grid gap-3 md:grid-cols-4">
      <Field label="Trans. to"><Select value={h.toLocationId} onChange={(e) => setH({ ...h, toLocationId: e.target.value })}>{locations.data?.filter((l) => (l.type !== 'VIRTUAL' || l.code === 'V-CUSTRET') && l.id !== doc.fromLocation.id).map((l) => <option key={l.id} value={l.id}>{l.name}{l.type === 'FRANCHISE' ? ' (franchise)' : ''}</option>)}</Select></Field>
      <Field label="Type"><Select value={h.transferType} onChange={(e) => setH({ ...h, transferType: e.target.value })}>{['RESTOCK', 'RETURN', 'REPLACEMENT', 'INTERNAL', 'CONSIGNMENT_OUT', 'CONSIGNMENT_RETURN'].map((t) => <option key={t}>{t}</option>)}</Select></Field>
      <Field label="Date"><Input type="date" value={h.docDate} onChange={(e) => setH({ ...h, docDate: e.target.value })} /></Field>
      <Field label="Notes"><Input value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} /></Field>
    </div>
    <table className="mt-3 w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Items</th><th>Qty out</th><th /></tr></thead><tbody>{lines.map((l, i) => <tr key={i} className="border-t"><td>{l.name}</td><td><Input type="number" min={1} className="w-24" value={l.qty} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, qty: Number(e.target.value) } : x)))} /></td><td><button type="button" className="text-xs text-red-700" onClick={() => setLines(lines.filter((_, k) => k !== i))}>remove</button></td></tr>)}</tbody></table>
    <div className="mt-2"><ProductPicker onPick={(p) => setLines([...lines, { productId: p.id, name: p.name, qty: 1 }])} /></div>
    <p className="mt-2 text-xs text-slate-500">Batches are re-assigned first-expiry-first-out when the change takes effect.</p>
    <div className="mt-3 flex gap-2"><Button disabled={!lines.length || save.isPending} onClick={() => save.mutate({ toLocationId: h.toLocationId, transferType: h.transferType, notes: h.notes || null, docDate: h.docDate || undefined, lines: lines.map((l) => ({ productId: l.productId, qty: l.qty })) })}>{own ? 'Save changes' : `Send to ${preparedByName ?? 'preparer'} for acceptance`}</Button><Button variant="outline" onClick={() => onClose()}>Cancel</Button></div>
    <ErrorBox error={save.error} />
  </Card>;
}
