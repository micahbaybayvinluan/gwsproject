import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, fmtDate, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Select, Stat } from '@/components/ui/primitives';
import { Segmented } from '@/components/ui/widgets';
import { Searchable } from '@/components/Searchable';
import { ProofUpload } from '@/components/ProofUpload';

interface Waiting { rows: { id: string; drSiNo: string; docDate: string; locationId: string; location: string; mid: string | null; slip: string | null; approval: string | null; batch: string | null; customer: string | null; amount: string; days: number }[]; total: string; count: number; oldest: string | null; late: number; alertDays: number; mdrPct: number }
interface Rem { id: string; controlNo: string; status: string; receivedOn: string; bank: string; batchRef: string | null; gross: string; fee: string; net: string; feePct: string; sales: number }
interface RemDetail extends Rem { notes: string | null; grossAmount: string; feeAmount: string; netAmount: string; lines: { salesDocId: string; drSiNo: string; gross: string; fee: string }[] }
const TONE: Record<string, 'slate' | 'amber' | 'green' | 'red'> = { DRAFT: 'slate', SUBMITTED: 'amber', POSTED: 'green', REJECTED: 'red' };
const money = (n: number) => Math.round(n * 100) / 100;

/** Card sales cleared by the bank (owner request 2026-10-23): tick the card sales, type the net the bank credited, the fee is worked out and shared per sale. */
export function CardRemittancesPage() {
  const [tab, setTab] = useState<'waiting' | 'list'>('waiting'); const [open, setOpen] = useState<string | null>(null);
  return <div className="space-y-4">
    <h1 className="text-2xl font-extrabold tracking-tight text-navy">Card Remittances</h1>
    <Segmented value={tab} onChange={(v) => { setTab(v as 'waiting' | 'list'); setOpen(null); }} options={[['waiting', 'Card sales waiting for the bank'], ['list', 'Remittances']]} />
    {tab === 'waiting' ? <WaitingTab onCreated={(id) => { setTab('list'); setOpen(id); }} /> : <ListTab open={open} setOpen={setOpen} />}
  </div>;
}

function WaitingTab({ onCreated }: { onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [loc, setLoc] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [mid, setMid] = useState(''); const [batch, setBatch] = useState('');
  const qs = new URLSearchParams({ ...(loc ? { locationId: loc } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), ...(mid ? { mid } : {}), ...(batch ? { batch } : {}) }).toString();
  const q = useQuery({ queryKey: ['card-waiting', qs], queryFn: () => api.get<Waiting>(`/api/card-remittances/waiting?${qs}`) });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/locations') });
  const banks = useQuery({ queryKey: ['card-banks'], queryFn: () => api.get<{ id: string; code: string; title: string }[]>('/api/card-remittances/bank-accounts') });
  const [picked, setPicked] = useState<Set<string>>(new Set()); const [bank, setBank] = useState(''); const [received, setReceived] = useState(today()); const [net, setNet] = useState(''); const [ref, setRef] = useState(''); const [notes, setNotes] = useState(''); const [proof, setProof] = useState<string | null>(null);
  const [fees, setFees] = useState<Record<string, string>>({}); const [more, setMore] = useState(false);
  const w = q.data; const rows = w?.rows ?? [];
  const sel = rows.filter((r) => picked.has(r.id)); const gross = money(sel.reduce((t, r) => t + Number(r.amount), 0));
  const netN = Number(net) || 0; const fee = money(gross - netN); const pct = gross ? (fee / gross) * 100 : 0;
  const toggle = (id: string) => { const n = new Set(picked); if (n.has(id)) n.delete(id); else n.add(id); setPicked(n); };
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/api/card-remittances', { bankAccountId: bank, receivedOn: received, batchRef: ref || null, notes: notes || null, proofAttachmentId: proof, salesDocIds: [...picked], netAmount: netN, fees: Object.fromEntries(Object.entries(fees).filter(([k, v]) => picked.has(k) && v !== '').map(([k, v]) => [k, Number(v)])) }),
    onSuccess: (r) => { setPicked(new Set()); setNet(''); setFees({}); void qc.invalidateQueries({ queryKey: ['card-waiting'] }); void qc.invalidateQueries({ queryKey: ['card-list'] }); onCreated(r.id); },
  });
  const tickAll = useMemo(() => rows.length > 0 && rows.every((r) => picked.has(r.id)), [rows, picked]);
  return <div className="space-y-4">
    {w && <div className="grid gap-3 sm:grid-cols-3"><Stat label="Waiting for the bank" value={peso(w.total)} sub={`${w.count} card sale${w.count === 1 ? '' : 's'}`} tone="amber" /><Stat label="Oldest" value={w.oldest ? fmtDate(w.oldest) : '—'} sub={w.late ? `${w.late} older than ${w.alertDays} days` : 'none late'} tone={w.late ? 'red' : 'green'} /><Stat label="Usual bank charge" value={`${w.mdrPct}%`} sub="only a guide: type what the bank really credited" /></div>}
    <Card title="Card sales not yet credited by the bank">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Branch"><Select value={loc} onChange={(e) => setLoc(e.target.value)}><option value="">All branches</option>{(locations.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        <Field label="Sold from"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="to"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="MID"><Input className="w-32" value={mid} onChange={(e) => setMid(e.target.value)} /></Field><Field label="Batch no."><Input className="w-28" value={batch} onChange={(e) => setBatch(e.target.value)} /></Field>
      </div>
      {q.isLoading ? <Empty>Loading…</Empty> : rows.length ? <div className="mt-3 overflow-x-auto"><Searchable><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1 pr-2"><input type="checkbox" checked={tickAll} onChange={() => setPicked(tickAll ? new Set() : new Set(rows.map((r) => r.id)))} aria-label="Tick all" /></th><th className="pr-3">Date</th><th className="pr-3">DR / SI</th><th className="pr-3">Branch</th><th className="pr-3">MID</th><th className="pr-3">Slip</th><th className="pr-3">Approval</th><th className="pr-3">Batch</th><th className="num pr-3">Charged on card</th><th className="num">Days</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id} className={`border-t ${picked.has(r.id) ? 'bg-amber-50' : ''}`}><td className="py-1.5 pr-2"><input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Tick ${r.drSiNo}`} /></td><td className="pr-3">{fmtDate(r.docDate)}</td><td className="pr-3 font-medium">{r.drSiNo}</td><td className="pr-3">{r.location}</td><td className="pr-3">{r.mid}</td><td className="pr-3">{r.slip}</td><td className="pr-3">{r.approval}</td><td className="pr-3">{r.batch}</td><td className="num pr-3">{peso(r.amount)}</td><td className={`num ${r.days > (w?.alertDays ?? 5) ? 'font-semibold text-red-700' : ''}`}>{r.days}</td></tr>)}</tbody></table></Searchable></div> : <Empty>No card sale is waiting for the bank.</Empty>}
    </Card>
    {sel.length > 0 && <Card title={`This bank credit (${sel.length} card sale${sel.length === 1 ? '' : 's'})`}>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Bank account credited"><Select value={bank} onChange={(e) => setBank(e.target.value)}><option value="">Choose…</option>{(banks.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.code} · {b.title}</option>)}</Select></Field>
        <Field label="Credited on"><Input type="date" value={received} onChange={(e) => setReceived(e.target.value)} /></Field>
        <Field label="Gross of the ticked sales"><Input readOnly value={peso(gross)} /></Field>
        <Field label="Net amount that reached the bank ₱"><Input type="number" step="0.01" min={0} value={net} onChange={(e) => setNet(e.target.value)} placeholder={w ? (gross * (1 - w.mdrPct / 100)).toFixed(2) : ''} /></Field>
      </div>
      <p className={`mt-2 text-sm ${fee < 0 ? 'text-red-700' : 'text-slate-700'}`}>{netN > 0 ? (fee < 0 ? 'The bank credited more than the sales: check the sales ticked.' : <>Bank charge: <b>{peso(fee)}</b> ({pct.toFixed(2)}% of the sales), shared among the sales in proportion to their amount.</>) : 'Type the net amount from the bank statement; the bank charge is worked out for you.'}</p>
      <button className="mt-1 text-xs font-semibold text-brand underline" onClick={() => setMore(!more)}>{more ? 'Hide' : 'Type the fee of a particular sale (optional)'}</button>
      {more && <div className="mt-2 grid gap-2 md:grid-cols-3">{sel.map((r) => <Field key={r.id} label={`${r.drSiNo} · ${peso(r.amount)}`}><Input type="number" step="0.01" min={0} placeholder="automatic" value={fees[r.id] ?? ''} onChange={(e) => setFees({ ...fees, [r.id]: e.target.value })} /></Field>)}</div>}
      <div className="mt-3 grid gap-3 md:grid-cols-3"><Field label="Bank reference / batch (optional)"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field><Field label="Note (optional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field><ProofUpload type="CardRemittance" label="Bank statement / credit advice (optional)" required={false} onChange={setProof} /></div>
      <ErrorBox error={create.error} />
      <div className="mt-3"><Button disabled={!bank || !netN || fee < 0 || create.isPending} onClick={() => create.mutate()}>Save the remittance</Button></div>
    </Card>}
  </div>;
}

function ListTab({ open, setOpen }: { open: string | null; setOpen: (id: string | null) => void }) {
  const q = useQuery({ queryKey: ['card-list'], queryFn: () => api.get<Rem[]>('/api/card-remittances') });
  const rows = q.data ?? [];
  return <div className="space-y-4">
    <Card title="Remittances">{rows.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1 pr-3">No.</th><th className="pr-3">Credited</th><th className="pr-3">Bank</th><th className="num pr-3">Gross</th><th className="num pr-3">Bank charge</th><th className="num pr-3">Net to bank</th><th className="num pr-3">%</th><th className="pr-3">Sales</th><th>Status</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id} className={`cursor-pointer border-t hover:bg-slate-50 ${open === r.id ? 'bg-amber-50' : ''}`} onClick={() => setOpen(open === r.id ? null : r.id)}><td className="py-1.5 pr-3 font-medium">{r.controlNo}</td><td className="pr-3">{fmtDate(r.receivedOn)}</td><td className="pr-3">{r.bank}</td><td className="num pr-3">{peso(r.gross)}</td><td className="num pr-3">{peso(r.fee)}</td><td className="num pr-3 font-semibold">{peso(r.net)}</td><td className="num pr-3">{r.feePct}%</td><td className="pr-3">{r.sales}</td><td><Badge tone={TONE[r.status] ?? 'slate'}>{r.status}</Badge></td></tr>)}</tbody></table></div> : <Empty>No card remittance yet.</Empty>}</Card>
    {open && <Detail id={open} onGone={() => setOpen(null)} />}
  </div>;
}

function Detail({ id, onGone }: { id: string; onGone: () => void }) {
  const qc = useQueryClient(); const { can } = useAuth();
  const q = useQuery({ queryKey: ['card-rem', id], queryFn: () => api.get<RemDetail>(`/api/card-remittances/${id}`) });
  const done = () => { void qc.invalidateQueries({ queryKey: ['card-rem', id] }); void qc.invalidateQueries({ queryKey: ['card-list'] }); void qc.invalidateQueries({ queryKey: ['card-waiting'] }); };
  const submit = useMutation({ mutationFn: () => api.post(`/api/card-remittances/${id}/submit`), onSuccess: done });
  const del = useMutation({ mutationFn: () => api.delete(`/api/card-remittances/${id}`), onSuccess: () => { done(); onGone(); } });
  const r = q.data; if (!r) return null;
  return <Card title={`${r.controlNo} · ${r.bank}`}>
    <div className="flex flex-wrap items-center gap-3 text-sm"><Badge tone={TONE[r.status] ?? 'slate'}>{r.status}</Badge><span>Credited {fmtDate(r.receivedOn)}</span>{r.batchRef && <span>Ref {r.batchRef}</span>}<span>Gross <b>{peso(r.grossAmount)}</b></span><span>Bank charge <b>{peso(r.feeAmount)}</b> ({r.feePct}%)</span><span>Net to bank <b>{peso(r.netAmount)}</b></span></div>
    {r.notes && <p className="mt-1 text-sm text-slate-600">{r.notes}</p>}
    <table className="mt-3 w-full max-w-xl text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1 pr-3">DR / SI</th><th className="num pr-3">Card amount</th><th className="num">Bank charge</th></tr></thead><tbody>{r.lines.map((l) => <tr key={l.salesDocId} className="border-t"><td className="py-1 pr-3">{l.drSiNo}</td><td className="num pr-3">{peso(l.gross)}</td><td className="num">{peso(l.fee)}</td></tr>)}</tbody></table>
    <div className="mt-3 flex flex-wrap gap-2">{can('card.remit') && r.status === 'DRAFT' && <Button disabled={submit.isPending} onClick={() => submit.mutate()}>Send to the Accounting Head</Button>}{can('card.remit') && ['DRAFT', 'REJECTED'].includes(r.status) && <Button variant="danger" disabled={del.isPending} onClick={() => { if (confirm('Delete this remittance? Its card sales go back to the waiting list.')) del.mutate(); }}>Delete</Button>}{r.status === 'SUBMITTED' && <span className="text-sm text-amber-700">Waiting for the Accounting Head.</span>}{r.status === 'POSTED' && <span className="text-sm text-emerald-700">Posted: Dr bank, Dr MDR, Cr AR – Credit Card.</span>}</div>
    <ErrorBox error={submit.error ?? del.error} />
  </Card>;
}
