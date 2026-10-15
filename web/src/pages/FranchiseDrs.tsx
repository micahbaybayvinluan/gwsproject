import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate, peso } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Input } from '@/components/ui/primitives';
import { Segmented } from '@/components/ui/widgets';

export interface FranchiseDr { id: string; saleId: string; drSiNo: string; date: string; status: string; franchise: string; from: string; total: number; paymentMode: string; dueDate: string | null; receivedByName: string | null; receivedAt: string | null; disputeNote: string | null; lines: { product: string; sku: string; flavor: string | null; qty: number; unitPrice: number }[] }

const STATUS: Record<string, { label: string; tone: 'amber' | 'green' | 'red' | 'slate' }> = { PENDING: { label: 'waiting for the franchise to check', tone: 'amber' }, RECEIVED: { label: 'received', tone: 'green' }, DISPUTED: { label: 'problem reported: being corrected', tone: 'red' } };

/** DRs made for a franchise: the franchise checks the goods and confirms (its stock goes up) or reports a problem; the coordinators correct the DR. */
export function FranchiseDrsPage() {
  const { can, me } = useAuth(); const qc = useQueryClient();
  const [tab, setTab] = useState<'OPEN' | 'RECEIVED'>('OPEN'); const [problem, setProblem] = useState<string | null>(null); const [note, setNote] = useState('');
  const q = useQuery({ queryKey: ['franchise-drs'], queryFn: () => api.get<FranchiseDr[]>('/api/franchise-drs') });
  const done = () => { setProblem(null); setNote(''); void qc.invalidateQueries({ queryKey: ['franchise-drs'] }); void qc.invalidateQueries({ queryKey: ['franchise-ar'] }); };
  const receive = useMutation({ mutationFn: (id: string) => api.post(`/api/franchise-drs/${id}/receive`), onSuccess: done });
  const report = useMutation({ mutationFn: (id: string) => api.post(`/api/franchise-drs/${id}/problem`, { note }), onSuccess: done });
  const franchiseUser = !!me?.roleKey.startsWith('FRANCHISE_') && !me.roleKey.includes('COORDINATOR'); const canReceive = can('franchise.dr.receive') && franchiseUser;
  const rows = (q.data ?? []).filter((d) => (tab === 'OPEN' ? d.status !== 'RECEIVED' : d.status === 'RECEIVED'));
  return <div className="space-y-4">
    <h1 className="text-2xl font-bold tracking-tight text-navy">Franchise DRs</h1>
    <p className="text-sm text-slate-600">Every DR made for a franchise by the warehouse or a branch comes here. The franchise <b>checks the goods against the DR</b> and presses <b>Received</b>: its stock goes up then. If something is wrong (item, quantity, flavor) it <b>reports the problem</b>; the Franchise Coordinator corrects the DR and the franchise checks it again.</p>
    <Segmented value={tab} onChange={(v: string) => setTab(v as 'OPEN' | 'RECEIVED')} options={[['OPEN', `To check (${(q.data ?? []).filter((d) => d.status !== 'RECEIVED').length})`], ['RECEIVED', 'Received']]} />
    <ErrorBox error={q.error ?? receive.error ?? report.error} />
    {!rows.length ? <Card><Empty>{tab === 'OPEN' ? 'No DR is waiting.' : 'Nothing received yet.'}</Empty></Card> : rows.map((d) => <Card key={d.id} title={<span className="flex flex-wrap items-center gap-2"><Link className="text-brand underline" to={`/sales/${d.saleId}`}>{d.drSiNo}</Link><span className="text-sm font-normal text-slate-500">{d.franchise} · from {d.from} · {fmtDate(d.date)}</span><Badge tone={STATUS[d.status]?.tone ?? 'slate'}>{STATUS[d.status]?.label ?? d.status}</Badge></span>}>
      <table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Item</th><th>Flavor</th><th className="num">Qty</th><th className="num">Price</th></tr></thead><tbody>{d.lines.map((l, i) => <tr key={i} className="border-t"><td className="py-1">{l.product} <span className="text-xs text-slate-400">{l.sku}</span></td><td>{l.flavor ?? ''}</td><td className="num">{l.qty}</td><td className="num">{peso(l.unitPrice)}</td></tr>)}</tbody></table>
      <p className="mt-2 text-sm">Total <b>{peso(d.total)}</b>{d.paymentMode === 'AR_PDC' ? ` · on credit${d.dueDate ? `, due ${fmtDate(d.dueDate)}` : ''}` : ''}{d.receivedByName ? ` · received by ${d.receivedByName} on ${fmtDate(d.receivedAt!)}` : ''}</p>
      {d.disputeNote && d.status === 'DISPUTED' && <p className="mt-1 rounded-lg bg-brand-soft p-2 text-sm text-brand-dark">Problem reported: {d.disputeNote}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {canReceive && d.status !== 'RECEIVED' && <Button size="sm" disabled={receive.isPending} onClick={() => receive.mutate(d.id)}>Received: the goods match the DR</Button>}
        {canReceive && d.status === 'PENDING' && (problem === d.id ? <><Input className="max-w-sm" placeholder="What is wrong?" value={note} onChange={(e) => setNote(e.target.value)} /><Button size="sm" disabled={note.trim().length < 3 || report.isPending} onClick={() => report.mutate(d.id)}>Send the problem</Button><Button size="sm" variant="ghost" onClick={() => setProblem(null)}>Cancel</Button></> : <Button size="sm" variant="outline" onClick={() => setProblem(d.id)}>Report a problem</Button>)}
        {can('franchise.dr.edit') && d.status !== 'RECEIVED' && <Link className="text-sm font-semibold text-brand underline" to={`/sales/${d.saleId}`}>Open the DR to correct it</Link>}
      </div>
    </Card>)}
  </div>;
}
