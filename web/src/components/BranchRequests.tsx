import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmtDate } from '@/lib/api';
import { Badge, Button, Card, ErrorBox, Input } from '@/components/ui/primitives';

export interface StockReq { id: string; requestNo: string; status: string; branch: string; notes: string | null; requestedByName: string | null; createdAt: string; transferId: string | null; declineNote: string | null; lines: { id: string; product: string; sku: string; requestedQty: number; qty: number; warehouseOnHand?: number }[] }

/** For the Warehouse In-Charge: the items a branch asked for are already listed, so only the quantities are changed before the pull-out is made. */
export function BranchRequestsCard() {
  const qc = useQueryClient(); const nav = useNavigate();
  const q = useQuery({ queryKey: ['stock-requests', 'OPEN'], queryFn: () => api.get<StockReq[]>('/api/stock-requests?status=OPEN') });
  const [edits, setEdits] = useState<Record<string, number>>({}); const [declining, setDeclining] = useState<string | null>(null); const [note, setNote] = useState('');
  const done = () => { setEdits({}); void qc.invalidateQueries({ queryKey: ['stock-requests'] }); void qc.invalidateQueries({ queryKey: ['transfers'] }); };
  const save = async (r: StockReq) => { const lines = r.lines.filter((l) => edits[l.id] != null && edits[l.id] !== l.qty).map((l) => ({ lineId: l.id, qty: edits[l.id] })); if (lines.length) await api.put(`/api/stock-requests/${r.id}`, { lines }); };
  const prepare = useMutation({ mutationFn: async (r: StockReq) => { await save(r); return api.post<{ transferId: string }>(`/api/stock-requests/${r.id}/prepare`); }, onSuccess: (x) => { done(); nav(`/transfers/${x.transferId}`); } });
  const saveOnly = useMutation({ mutationFn: (r: StockReq) => save(r), onSuccess: done });
  const decline = useMutation({ mutationFn: (id: string) => api.post(`/api/stock-requests/${id}/decline`, { note }), onSuccess: () => { setDeclining(null); setNote(''); done(); } });
  if (!q.data?.length) return null;
  return <Card title={<>Requests from the branches <Badge tone="amber">{q.data.length} waiting</Badge></>}>
    <p className="mb-3 text-sm text-slate-600">The items are already listed. Change the quantity you can send (0 removes an item), then <b>Make the pull-out</b>: the draft is made for you to check and submit as usual.</p>
    <div className="space-y-4">{q.data.map((r) => <div key={r.id} className="rounded-xl border border-slate-200 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm"><b>{r.requestNo}</b><span>{r.branch}</span><span className="text-slate-500">asked by {r.requestedByName} on {fmtDate(r.createdAt)}</span>{r.notes && <span className="text-slate-600">— {r.notes}</span>}</div>
      <table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Item</th><th className="num">Asked</th><th className="num">Warehouse has</th><th>To send</th></tr></thead><tbody>
        {r.lines.map((l) => { const v = edits[l.id] ?? l.qty; return <tr key={l.id} className="border-t"><td className="py-1">{l.product} <span className="text-xs text-slate-400">{l.sku}</span></td><td className="num">{l.requestedQty}</td><td className={`num ${(l.warehouseOnHand ?? 0) < v ? 'font-bold text-red-700' : ''}`}>{l.warehouseOnHand ?? 0}</td><td><Input type="number" min={0} className="w-24" value={v} onChange={(e) => setEdits({ ...edits, [l.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></td></tr>; })}
      </tbody></table>
      {declining === r.id ? <div className="mt-2 flex flex-wrap items-end gap-2"><Input className="max-w-md" placeholder="Why it cannot be sent now" value={note} onChange={(e) => setNote(e.target.value)} /><Button size="sm" disabled={note.trim().length < 3 || decline.isPending} onClick={() => decline.mutate(r.id)}>Decline</Button><Button size="sm" variant="ghost" onClick={() => setDeclining(null)}>Cancel</Button></div>
        : <div className="mt-2 flex flex-wrap gap-2"><Button size="sm" disabled={prepare.isPending} onClick={() => prepare.mutate(r)}>Make the pull-out</Button><Button size="sm" variant="outline" disabled={saveOnly.isPending} onClick={() => saveOnly.mutate(r)}>Save quantities</Button><Button size="sm" variant="ghost" onClick={() => setDeclining(r.id)}>Decline</Button></div>}
    </div>)}</div>
    <ErrorBox error={prepare.error ?? saveOnly.error ?? decline.error} />
  </Card>;
}

/** For the branch: what it asked for and where each request stands. */
export function MyStockRequests() {
  const q = useQuery({ queryKey: ['stock-requests', 'mine'], queryFn: () => api.get<StockReq[]>('/api/stock-requests') });
  const nav = useNavigate();
  if (!q.data?.length) return null;
  const tone = (s: string) => (s === 'OPEN' ? 'amber' : s === 'PREPARED' ? 'green' : 'red') as 'amber' | 'green' | 'red';
  const label = (s: string) => (s === 'OPEN' ? 'waiting for the warehouse' : s === 'PREPARED' ? 'the warehouse is preparing it' : 'declined');
  return <div className="mt-3"><div className="mb-1 text-sm font-semibold">My requests</div><ul className="divide-y text-sm">{q.data.slice(0, 8).map((r) => <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5"><b>{r.requestNo}</b><span className="text-slate-500">{fmtDate(r.createdAt)}</span><span>{r.lines.map((l) => `${l.qty}× ${l.product}`).join(', ')}</span><Badge tone={tone(r.status)}>{label(r.status)}</Badge>{r.declineNote && <span className="text-xs text-slate-600">{r.declineNote}</span>}{r.transferId && <button className="text-xs text-brand underline" onClick={() => nav(`/transfers/${r.transferId}`)}>open the transfer</button>}</li>)}</ul></div>;
}
