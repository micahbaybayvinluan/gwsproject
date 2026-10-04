import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, peso } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Field, Input, Select, Stat } from '@/components/ui/primitives';
import { ProofCards, ProofItem, ProofLegend, RefBadge, PROOF_CODE, PROOF_COLOR, PROOF_KIND_LABEL } from '@/components/ProofCards';

const KINDS = Object.keys(PROOF_KIND_LABEL);
const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

/** Accounting and the auditors check the proofs of payment of a branch for a day or a period here, and print them with the transactions: no paper copies. */
export function PaymentProofsPage() {
  const { me } = useAuth();
  const [locationId, setLocationId] = useState(me!.locationScoped ? me!.locations[0]?.id ?? '' : '');
  const [from, setFrom] = useState(today()); const [to, setTo] = useState(today()); const [kinds, setKinds] = useState<string[]>([]); const [onlyMissing, setOnlyMissing] = useState(false); const [view, setView] = useState<'cards' | 'table'>('cards');
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/locations'), enabled: !me!.locationScoped });
  const qs = `from=${from}&to=${to}${locationId ? `&locationId=${locationId}` : ''}${kinds.length ? `&kinds=${kinds.join(',')}` : ''}`;
  const q = useQuery({ queryKey: ['payment-proofs', qs], queryFn: () => api.get<{ items: ProofItem[]; summary: { kind: string; count: number; missing: number; amount: number }[]; missing: number }>(`/api/reports/payment-proofs?${qs}`), enabled: from <= to });
  const items = (q.data?.items ?? []).filter((i) => !onlyMissing || i.missing);
  const toggle = (k: string) => setKinds((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]));
  return <div className="space-y-4">
    <h1 className="text-2xl font-bold tracking-tight text-navy">Payment Proofs</h1>
    <p className="text-sm text-slate-600">Every online, card and cheque payment, AR collection, replacement payment and bank deposit slip, each with the proof the branch uploaded. The printed Daily Sales Report carries the same proofs at the end, so nothing has to be printed and attached by hand.</p>
    <Card>
      <div className="flex flex-wrap items-end gap-3">
        {!me!.locationScoped && <Field label="Branch"><Select value={locationId} onChange={(e) => setLocationId(e.target.value)}><option value="">All branches</option>{locations.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>}
        <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> Only missing proofs</label>
        <div className="ml-auto flex gap-2"><Button disabled={from > to} onClick={() => api.download(`/api/reports/payment-proofs.pdf?${qs}`, `PaymentProofs_${from}_${to}.pdf`)}>Print with the pictures (PDF)</Button><Button variant="outline" disabled={from > to} onClick={() => api.download(`/api/reports/payment-proofs.xlsx?${qs}`, `PaymentProofs_${from}_${to}.xlsx`)}>Excel</Button></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">{KINDS.map((k) => <button key={k} onClick={() => toggle(k)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${kinds.includes(k) ? 'text-white' : 'bg-white text-slate-600'}`} style={kinds.includes(k) ? { background: PROOF_COLOR[k], borderColor: PROOF_COLOR[k] } : undefined}>{PROOF_CODE[k]} · {PROOF_KIND_LABEL[k]}</button>)}{kinds.length > 0 && <button className="text-xs text-slate-500 underline" onClick={() => setKinds([])}>all types</button>}</div>
    </Card>
    <ErrorBox error={q.error} />
    {q.data && <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Stat label="Proofs" value={String(q.data.items.length)} /><Stat label="Missing" value={String(q.data.missing)} />{q.data.summary.slice(0, 2).map((s) => <Stat key={s.kind} label={PROOF_KIND_LABEL[s.kind]} value={`${s.count} · ${peso(s.amount)}`} />)}</div>
      {q.data.missing > 0 && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><b>{q.data.missing} payment{q.data.missing === 1 ? '' : 's'} without a proof.</b> They are shown in red here and on the printed report. The branch must upload the proof on the transaction.</p>}
      <div className="flex items-center justify-between"><ProofLegend kinds={[...new Set(q.data.items.map((i) => i.kind))]} /><div className="flex gap-1 text-xs"><button className={`rounded-lg border px-3 py-1 ${view === 'cards' ? 'bg-navy text-white' : 'bg-white'}`} onClick={() => setView('cards')}>Pictures</button><button className={`rounded-lg border px-3 py-1 ${view === 'table' ? 'bg-navy text-white' : 'bg-white'}`} onClick={() => setView('table')}>Checklist</button></div></div>
      {view === 'cards' ? <ProofCards items={items} /> : <Card><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Ref</th><th>Type</th><th>Document</th><th>Customer / for</th><th>How · account</th><th>Reference</th><th className="num">Amount</th><th>Date</th><th>Branch</th><th>Proof</th></tr></thead><tbody>{items.map((i) => <tr key={`${i.ref}-${i.docNo}`} className="border-t"><td className="py-1.5"><RefBadge item={i} /></td><td>{i.kindLabel}</td><td>{i.docNo}</td><td>{i.party ?? ''}</td><td>{i.mode}{i.account ? ` · ${i.account}` : ''}</td><td>{i.reference ?? ''}</td><td className="num">{peso(i.amount)}</td><td>{i.date}</td><td>{i.branch}</td><td>{i.missing ? <Badge tone="red">missing</Badge> : <button className="text-brand underline" onClick={() => api.download(`/api/attachments/file/${i.attachmentId}`, i.fileName ?? 'proof')}>open</button>}</td></tr>)}</tbody></table></div></Card>}
    </>}
  </div>;
}
