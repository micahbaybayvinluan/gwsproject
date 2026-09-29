import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api, peso } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Input, Modal, statusTone } from '@/components/ui/primitives';

interface Req { id: string; type: string; documentType: string; documentId: string; requestedBy: string; requesterName: string; requiredApproverRoles: string[]; anyOf: boolean; status: string; summary: Record<string, unknown> | null; autoApproveAt: string | null; createdAt: string; decisions: { roleKey: string; decision: string; note: string | null; user: { fullName: string } }[] }
const LINKS: Record<string, string> = { ReceivingDoc: '/receiving', TransferDoc: '/transfers', SalesDoc: '/sales', ExpiryWriteoffDoc: '/writeoffs', PriceChangeDoc: '/price-changes', CountDoc: '/counts', DiscrepancyCase: '/discrepancies', PostCloseEdit: '/closing', Payment: '/ar' };
const TYPE_LABEL: Record<string, string> = { AUDIT_REVISION: 'Audit Associate correction (Head Auditor only)', AR_PAYMENT: 'AR payment entered by branch', COUNT_REVISION: 'Count sheet revision', DISCREPANCY_EXPLANATION: 'Discrepancy explanation', WAREHOUSE_EDIT: 'Edit of your warehouse document', MASTER_DATA_NEW: 'New master data (Owner approves)', WAREHOUSE_IN: 'Goods into the warehouse (In-Charge approves)', WAREHOUSE_OUT: 'Goods out of the warehouse (In-Charge approves)', CASH_DEPOSIT_EXTENSION: 'More days to deposit cash sales (Head Auditor + Admin)', CONSIGNMENT_CHECK_WH: 'Consignment check (In-Charge, then the Owner)', CONSIGNMENT_CHECK_BRANCH: 'Consignment check (auditor, then the Owner)', CONSIGNMENT_OUT: 'Consignment (Owner approves)', COST_EDIT: 'Product cost change', ECOM_PULLOUT: 'E-commerce pull-out from the Warehouse (In-Charge approves)', ECOM_SETTLEMENT: 'E-commerce payout: sale, fees and payout (Accounting Head)', TRANSFER_DIFF_REVIEW: 'Transfer received with a different quantity (Head Auditor reviews)', TRANSFER_DIFF_SENDER: 'Items your branch sent were not received as on the form: agree or disagree', TRANSFER_DIFF_ADMIN: 'Transfer difference: the sending branch disagrees or did not answer (Owner decides)', SALES_TARGET: 'Monthly sales target (set by the Sales Manager)' };

/** §6.2 Approvals inbox: grouped by type, newest first, select-all + bulk approve/reject with one note, inline expand. */
export function ApprovalsPage() {
  const qc = useQueryClient(); const { can } = useAuth(); const [sp] = useSearchParams();
  const q = useQuery({ queryKey: ['approvals-inbox'], queryFn: () => api.get<{ count: number; oldestDays: number; items: Req[] }>('/api/approvals/inbox'), refetchInterval: 30000 });
  const [selected, setSelected] = useState<Set<string>>(new Set()); const [note, setNote] = useState(''); const [open, setOpen] = useState<string | null>(null);
  const [results, setResults] = useState<{ id: string; ok: boolean; error?: string }[] | null>(null);
  const bulk = useMutation({ mutationFn: (v: 'APPROVE' | 'REJECT' | { decision: 'REJECT'; reason: string }) => api.post<{ id: string; ok: boolean; error?: string }[]>('/api/approvals/bulk', { ids: [...selected], decision: typeof v === 'string' ? v : v.decision, note: typeof v === 'string' ? note || undefined : v.reason }), onSuccess: (r) => { setResults(r); setSelected(new Set()); setNote(''); void qc.invalidateQueries({ queryKey: ['approvals-inbox'] }); void qc.invalidateQueries({ queryKey: ['approvals-count'] }); } });
  // rejecting an AR payment needs a reason, which goes back to the branch (owner request 2026-09-29)
  const [rejecting, setRejecting] = useState<{ ids: string[]; bulk: boolean; type: string } | null>(null);
  const one = useMutation({ mutationFn: ({ id, decision, reason }: { id: string; decision: 'APPROVE' | 'REJECT'; reason?: string }) => api.post(`/api/approvals/${id}/decide`, { decision, note: reason ?? (note || undefined) }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['approvals-inbox'] }); void qc.invalidateQueries({ queryKey: ['approvals-count'] }); } });
  const items = (q.data?.items ?? []).filter((i) => !sp.get('type') || i.type === sp.get('type'));
  const groups = [...new Set(items.map((i) => i.type))].map((t) => ({ type: t, items: items.filter((i) => i.type === t) }));
  const toggle = (id: string) => { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n); };
  const selectAll = () => setSelected(selected.size === items.length ? new Set() : new Set(items.map((i) => i.id)));
  return <div className="space-y-4">
    {rejecting && <RejectReason type={rejecting.type} onClose={() => setRejecting(null)} onReject={(reason) => { if (rejecting.bulk) bulk.mutate({ decision: 'REJECT', reason }); else one.mutate({ id: rejecting.ids[0], decision: 'REJECT', reason }); setRejecting(null); }} />}
    <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-2xl font-bold tracking-tight text-navy">My Approvals <span className="text-base text-slate-500">({q.data?.count ?? 0} pending{q.data?.oldestDays ? `, oldest ${q.data.oldestDays} d` : ''})</span></h1></div>
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={items.length > 0 && selected.size === items.length} onChange={selectAll} /> Select all ({selected.size})</label>
        <Input className="max-w-xs" placeholder="Note applied to all selected (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button disabled={!selected.size || bulk.isPending} onClick={() => bulk.mutate('APPROVE')}>Approve selected</Button>
        <Button variant="danger" disabled={!selected.size || bulk.isPending} onClick={() => { const t = items.find((i) => selected.has(i.id) && NEEDS_REASON.includes(i.type))?.type; if (t) setRejecting({ ids: [...selected], bulk: true, type: t }); else bulk.mutate('REJECT'); }}>Reject selected</Button>
      </div>
      <ErrorBox error={bulk.error || one.error} />
      {results && <div className="mt-2 text-sm">{results.filter((r) => r.ok).length} succeeded{results.some((r) => !r.ok) && <ul className="list-disc pl-5 text-red-700">{results.filter((r) => !r.ok).map((r) => <li key={r.id}>{r.error}</li>)}</ul>}</div>}
    </Card>
    {!items.length && <Empty>Nothing waiting for you.</Empty>}
    {groups.map((g) => <Card key={g.type} title={<>{TYPE_LABEL[g.type] ?? g.type.replace(/_/g, ' ')} <Badge>{g.items.length}</Badge></>}>
      <ul className="divide-y">{g.items.map((r) => <li key={r.id} className="py-2">
        <div className="flex flex-wrap items-start gap-2">
          <input type="checkbox" className="mt-1" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
          <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
            <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">{String(r.summary?.controlNo ?? r.summary?.drSiNo ?? r.documentType)}</span>{r.summary?.locationName ? <span className="text-slate-500">{String(r.summary.locationName)}</span> : null}{r.summary?.total !== undefined ? <span>{peso(r.summary.total)}</span> : null}{r.summary?.franchiseTier === true ? <Badge tone="purple">FRANCHISE</Badge> : null}{r.autoApproveAt && <Badge tone="blue">auto-approves {new Date(r.autoApproveAt).toLocaleString()}</Badge>}{!r.anyOf && r.requiredApproverRoles.length > 1 && <Badge tone="amber">needs all: {r.requiredApproverRoles.join(' + ')}</Badge>}</div>
            <div className="text-xs text-slate-500">by {r.requesterName} · {new Date(r.createdAt).toLocaleString()}{r.decisions.length ? ` · decided by ${r.decisions.map((d) => `${d.user.fullName} (${d.decision})`).join(', ')}` : ''}</div>
          </button>
          <div className="flex gap-1"><Button size="sm" onClick={() => one.mutate({ id: r.id, decision: 'APPROVE' })}>{APPROVE_LABEL[r.type] ?? 'Approve'}</Button><Button size="sm" variant="danger" onClick={() => (NEEDS_REASON.includes(r.type) ? setRejecting({ ids: [r.id], bulk: false, type: r.type }) : one.mutate({ id: r.id, decision: 'REJECT' }))}>{REJECT_LABEL[r.type] ?? 'Reject'}</Button></div>
        </div>
        {r.type === 'AR_PAYMENT' && <PaymentReview id={r.documentId} />}
        {r.type === 'WAREHOUSE_EDIT' && Array.isArray(r.summary?.changes) && <div className="ml-6 mt-1 rounded border border-amber-200 bg-amber-50 p-2 text-sm">
          <div className="text-xs text-slate-600">{String(r.summary?.proposedBy ?? r.requesterName)} wants to change your {String(r.summary?.document ?? 'document')}. Nothing changes unless you accept.</div>
          <ul className="list-disc pl-5">{(r.summary!.changes as string[]).map((c, i) => <li key={i}>{c}</li>)}</ul>
        </div>}
        {open === r.id && <div className="mt-2 rounded bg-slate-50 p-3 text-sm">
          <Summary s={r.summary} showCost={can('cost.view')} />
          <Link className="mt-2 inline-block text-brand underline" to={r.documentType === 'EcomSettlement' ? `/ecommerce?payout=${r.documentId}` : r.documentType === 'SalesTarget' ? '/targets' : `${LINKS[r.documentType] ?? '/'}${['PostCloseEdit', 'Payment'].includes(r.documentType) ? '' : `/${r.documentId}`}`}>Open full document</Link>
        </div>}
      </li>)}</ul>
    </Card>)}
  </div>;
}
function Summary({ s, showCost }: { s: Record<string, unknown> | null; showCost: boolean }) {
  if (!s) return null;
  const lines = Array.isArray(s.lines) ? (s.lines as Record<string, unknown>[]) : null;
  const scalars = Object.entries(s).filter(([k, v]) => !['lines', 'before', 'after', 'variances', 'changes', 'payload', 'kind'].includes(k) && (typeof v !== 'object' || v === null));
  return <div className="space-y-2">
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-4">{scalars.map(([k, v]) => <div key={k}><dt className="text-xs uppercase text-slate-500">{k}</dt><dd>{String(v)}</dd></div>)}</dl>
    {lines && typeof lines[0] === 'object' && <table className="w-full text-xs"><thead><tr>{Object.keys(lines[0]).filter((k) => showCost || !/cost|margin/i.test(k)).map((k) => <th key={k} className="text-left">{k}</th>)}</tr></thead><tbody>{lines.map((l, i) => <tr key={i} className="border-t">{Object.entries(l).filter(([k]) => showCost || !/cost|margin/i.test(k)).map(([k, v]) => <td key={k} className={typeof v === 'number' || /^\d/.test(String(v)) ? 'num' : ''}>{String(v ?? '')}</td>)}</tr>)}</tbody></table>}
    {(s.before || s.after) ? <div className="grid gap-2 md:grid-cols-2"><div><div className="text-xs uppercase text-slate-500">Before</div><pre className="overflow-auto rounded bg-white p-2 text-xs">{JSON.stringify(s.before, null, 1)}</pre></div><div><div className="text-xs uppercase text-slate-500">After</div><pre className="overflow-auto rounded bg-white p-2 text-xs">{JSON.stringify(s.after, null, 1)}</pre></div></div> : null}
    {Array.isArray(s.variances) && <ul className="list-disc pl-5">{(s.variances as { product: string; variance: number }[]).map((v, i) => <li key={i}>{v.product}: {v.variance}</li>)}</ul>}
  </div>;
}
export { statusTone };

interface Review { creditNoteNo: string; amount: string; discount: string; paymentMode: string; receivedAt: string; notes: string | null; account: { code: string; title: string } | null; branch: string | null; enteredBy: string | null; customer: string | null; proof: { id: string; fileName: string; contentType: string } | null; invoices: { id: string; drSiNo: string; date: string; dueDate: string | null; total: string; balance: string; pdcChequeNo: string | null }[] }
const MODE: Record<string, string> = { CASH: 'Cash', ONLINE: 'Online (bank / GCash)', CREDIT_CARD: 'Credit card', AR_PDC: 'Cheque (PDC)' };

/** AR payment from a branch: the proof, the account it went to and the invoices, right in the approval list (owner request 2026-09-29). */
function PaymentReview({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['payment-review', id], queryFn: () => api.get<Review>(`/api/ar/payments/${id}/review`) });
  const [img, setImg] = useState<string | null>(null); const [big, setBig] = useState(false);
  const isImage = !!q.data?.proof?.contentType.startsWith('image/');
  useEffect(() => {
    if (!q.data?.proof) return; let url = '';
    void api.blob(`/api/attachments/file/${q.data.proof.id}`).then((b) => { url = URL.createObjectURL(b); setImg(url); }).catch(() => undefined);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [q.data?.proof]);
  const r = q.data; if (!r) return <p className="ml-6 mt-1 text-xs text-slate-500">Loading payment details…</p>;
  return <div className="ml-6 mt-2 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm md:grid-cols-[1fr_220px]">
    <div className="space-y-2">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 md:grid-cols-3">
        <div><dt className="text-xs uppercase text-slate-500">Customer</dt><dd className="font-medium">{r.customer ?? '—'}</dd></div>
        <div><dt className="text-xs uppercase text-slate-500">Amount received</dt><dd className="font-semibold">{peso(r.amount)}{Number(r.discount) ? <span className="text-xs text-slate-500"> + discount {peso(r.discount)}</span> : null}</dd></div>
        <div><dt className="text-xs uppercase text-slate-500">Paid by</dt><dd>{MODE[r.paymentMode] ?? r.paymentMode}</dd></div>
        <div className="col-span-2"><dt className="text-xs uppercase text-slate-500">Deposited to</dt><dd className="font-semibold text-navy">{r.account ? `${r.account.code} ${r.account.title}` : r.paymentMode === 'CASH' ? 'Cash (branch)' : '—'}</dd></div>
        <div><dt className="text-xs uppercase text-slate-500">Date received</dt><dd>{new Date(r.receivedAt).toLocaleDateString()}</dd></div>
        <div><dt className="text-xs uppercase text-slate-500">Branch</dt><dd>{r.branch}</dd></div>
        <div><dt className="text-xs uppercase text-slate-500">Entered by</dt><dd>{r.enteredBy}</dd></div>
        {r.notes && <div className="col-span-2"><dt className="text-xs uppercase text-slate-500">Notes</dt><dd>{r.notes}</dd></div>}
      </dl>
      <table className="w-full text-xs"><thead className="text-left text-slate-500"><tr><th>Invoice (DR/SI)</th><th>Date</th><th>Due</th><th className="num">Total</th><th className="num">Balance before</th><th>PDC</th></tr></thead><tbody>{r.invoices.map((i) => <tr key={i.id} className="border-t"><td className="py-1"><Link className="text-brand underline" to={`/sales/${i.id}`}>{i.drSiNo}</Link></td><td>{i.date}</td><td>{i.dueDate ?? '—'}</td><td className="num">{peso(i.total)}</td><td className="num">{peso(i.balance)}</td><td>{i.pdcChequeNo ?? '—'}</td></tr>)}</tbody></table>
    </div>
    <div>
      <div className="mb-1 text-xs uppercase text-slate-500">Proof of payment</div>
      {!r.proof ? <div className="rounded-lg border border-dashed p-4 text-center text-xs text-slate-500">No proof uploaded{r.paymentMode === 'CASH' ? ' (cash)' : ''}</div>
        : isImage && img ? <button type="button" onClick={() => setBig(true)} title="Click to enlarge"><img src={img} alt="Proof of payment" className="max-h-56 w-full rounded-lg border bg-white object-contain" /></button>
        : <button type="button" className="text-brand underline" onClick={() => api.download(`/api/attachments/file/${r.proof!.id}`, r.proof!.fileName)}>{r.proof.fileName}</button>}
    </div>
    {big && img && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setBig(false)}><img src={img} alt="Proof of payment" className="max-h-full max-w-full rounded-lg bg-white" /></div>}
  </div>;
}

/** Reasons Accounting gives when an AR payment entered by a branch cannot be approved. */
export const PAYMENT_REJECT_REASONS = [
  'Wrong amount (does not match the proof)',
  'Wrong proof of payment (screenshot is for another payment)',
  'Proof is unclear or cannot be read',
  'Money not received in the account',
  'Wrong receiving account chosen',
  'Wrong customer or wrong invoice',
  'Duplicate: this payment was already recorded',
  'Wrong date received',
  'Cheque bounced or not yet cleared',
];

/** Rejections that must say why (the person who sent it sees the reason). */
const NEEDS_REASON = ['AR_PAYMENT', 'TRANSFER_DIFF_SENDER', 'TRANSFER_DIFF_REVIEW'];
const APPROVE_LABEL: Record<string, string> = { WAREHOUSE_EDIT: 'Accept', TRANSFER_DIFF_SENDER: 'Agree', TRANSFER_DIFF_REVIEW: 'Confirm the difference' };
const REJECT_LABEL: Record<string, string> = { TRANSFER_DIFF_SENDER: 'Disagree', TRANSFER_DIFF_REVIEW: 'Receiver miscounted' };

function RejectReason({ type, onReject, onClose }: { type: string; onReject: (reason: string) => void; onClose: () => void }) {
  const [pick, setPick] = useState(''); const [other, setOther] = useState('');
  if (type !== 'AR_PAYMENT') return <Modal title={type === 'TRANSFER_DIFF_SENDER' ? 'Why do you disagree?' : 'What did you find?'} onClose={onClose}>
    <p className="mb-3 text-sm text-slate-600">{type === 'TRANSFER_DIFF_SENDER' ? 'For example "we packed all items, the checker counted them". The Owner reads this and decides.' : 'For example "CCTV shows both boxes arrived". The receiving branch gets the items as on the form.'}</p>
    <Input value={other} onChange={(e) => setOther(e.target.value)} placeholder="Reason (required)" autoFocus />
    <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="danger" disabled={!other.trim()} onClick={() => onReject(other.trim())}>{REJECT_LABEL[type] ?? 'Reject'}</Button></div>
  </Modal>;
  const reason = pick === 'OTHER' ? other.trim() : pick ? `${pick}${other.trim() ? ` — ${other.trim()}` : ''}` : '';
  return <Modal title="Why is this payment rejected?" onClose={onClose}>
    <p className="mb-3 text-sm text-slate-600">The branch sees this reason and records the payment again.</p>
    <div className="space-y-1.5">{[...PAYMENT_REJECT_REASONS, 'OTHER'].map((r) => <label key={r} className="flex items-start gap-2 text-sm"><input type="radio" name="reason" className="mt-1" checked={pick === r} onChange={() => setPick(r)} />{r === 'OTHER' ? 'Other (explain below)' : r}</label>)}</div>
    <Input className="mt-3" placeholder={pick === 'OTHER' ? 'Explain the reason (required)' : 'More details (optional)'} value={other} onChange={(e) => setOther(e.target.value)} />
    <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="danger" disabled={!reason} onClick={() => onReject(reason)}>Reject payment</Button></div>
  </Modal>;
}
