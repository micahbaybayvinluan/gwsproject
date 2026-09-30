import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Field, Input, Select } from '@/components/ui/primitives';
import { ApprovalTimeline } from '@/components/ApprovalTimeline';

const REASONS = ['Wrong amount typed', 'Wrong payment mode', 'Wrong DR / SI number', 'Wrong customer / agent', 'Duplicate entry', 'Sale cancelled or returned by the customer', 'Wrong expense account', 'Other'];
interface Sale { id: string; controlNo: string; drSiNo: string; channel: string; paymentMode: string; grandTotal: string; customerName: string | null; customer?: { name: string } | null; voidedAt: string | null; deliveryFee?: string; notes?: string | null }
interface Expense { id: string; controlNo: string; payee: string | null; amount: string; notes: string | null; account?: { title: string } | null; voidedAt?: string | null; status?: string }
interface Edit { id: string; documentType: string; reason: string; createdAt: string; appliedAt: string | null; before: { controlNo?: string; businessDate?: string; docDate?: string } }

/**
 * Change a closed day (owner request 2026-09-30): the branch picks the day and the sale or expense, says what to change and why; the
 * request shows who approves it. HR and the Head Auditor are told of every one; three in a month (or three days in a row) is flagged for the Owner.
 */
export function PostCloseEditCard({ locationId, date, isFranchise }: { locationId: string; date: string; isFranchise?: boolean }) {
  const { can } = useAuth(); const qc = useQueryClient();
  const [pick, setPick] = useState<{ type: 'SalesDoc' | 'ExpenseDoc'; id: string } | null>(null);
  const [change, setChange] = useState<Record<string, string>>({ action: 'edit' });
  const [reason, setReason] = useState(''); const [detail, setDetail] = useState(''); const [open, setOpen] = useState<string | null>(null);
  const closed = date < today();
  const sub = useQuery({ queryKey: ['dsr-sub', locationId, date], queryFn: () => api.get<{ submitted: boolean }>(`/api/reports/daily-sales/submission?locationId=${locationId}&date=${date}`), enabled: !!locationId && !closed });
  const isClosed = closed || !!sub.data?.submitted;
  const sales = useQuery({ queryKey: ['pce-sales', locationId, date], queryFn: () => api.get<Sale[]>(`/api/sales?locationId=${locationId}&from=${date}&to=${date}`), enabled: !!locationId && isClosed });
  const expenses = useQuery({ queryKey: ['pce-exp', locationId, date], queryFn: () => api.get<Expense[]>(`/api/expenses?locationId=${locationId}&from=${date}&to=${date}`), enabled: !!locationId && isClosed && can('expense.create.branch') });
  const edits = useQuery({ queryKey: ['pce-edits'], queryFn: () => api.get<Edit[]>('/api/closing/edits') });
  const fullReason = reason === 'Other' ? detail.trim() : `${reason}${detail.trim() ? ` — ${detail.trim()}` : ''}`;
  const after = (): Record<string, unknown> => {
    if (change.action === 'void') return { voidReason: fullReason };
    const a: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(change)) if (k !== 'action' && v !== '') a[k] = ['deliveryFee', 'amount'].includes(k) ? Number(v) : v;
    return a;
  };
  const send = useMutation({ mutationFn: () => api.post('/api/closing/edits', { documentType: pick!.type, documentId: pick!.id, reason: fullReason, after: after() }), onSuccess: () => { setPick(null); setChange({ action: 'edit' }); setReason(''); setDetail(''); void qc.invalidateQueries({ queryKey: ['pce-edits'] }); } });
  const ready = pick && fullReason.length >= 5 && (change.action === 'void' || Object.keys(after()).length > 0);
  const docs = [...(sales.data ?? []).filter((x) => !x.voidedAt).map((x) => ({ type: 'SalesDoc' as const, id: x.id, label: `Sale ${x.drSiNo} · ${x.channel.replace(/_/g, ' ').toLowerCase()} · ${x.paymentMode.replace('_', '/').toLowerCase()} · ${x.customer?.name ?? x.customerName ?? ''}`, amount: x.grandTotal })),
    ...(expenses.data ?? []).filter((x) => !x.voidedAt && x.status !== 'VOIDED').map((x) => ({ type: 'ExpenseDoc' as const, id: x.id, label: `Expense ${x.controlNo} · ${x.account?.title ?? ''} · ${x.payee ?? ''}`, amount: x.amount }))];
  const recent = (edits.data ?? []).slice(0, 8);
  return <Card title="Change a closed day (post-close edit)">
    <p className="text-sm text-slate-600">Approved by <b>{isFranchise ? 'the franchise owner' : 'the Head Auditor and the Asst Auditor (both)'}</b>. A reason is required. HR and the Head Auditor are told of every request; three in one month (or three days in a row) is flagged and may be referred to the Owner as negligence of duty. Check the report before submitting so it is not needed.</p>
    {!isClosed ? <p className="mt-2 text-sm text-slate-500">{date} is still open: correct it directly (open the sale → Void, then record it again) before you submit the Daily Sales Report.</p>
      : <div className="mt-3 space-y-3">
        <Field label={`Sale or expense of ${date} to change`}><Select value={pick ? `${pick.type}:${pick.id}` : ''} onChange={(e) => { const [type, id] = e.target.value.split(':'); setPick(id ? { type: type as 'SalesDoc' | 'ExpenseDoc', id } : null); setChange({ action: 'edit' }); }}><option value="">— choose —</option>{docs.map((d) => <option key={d.id} value={`${d.type}:${d.id}`}>{d.label} · {peso(d.amount)}</option>)}</Select></Field>
        {pick && <>
          <div className="flex flex-wrap gap-3 text-sm"><label className="flex items-center gap-1"><input type="radio" checked={change.action === 'edit'} onChange={() => setChange({ action: 'edit' })} /> Correct details</label><label className="flex items-center gap-1"><input type="radio" checked={change.action === 'void'} onChange={() => setChange({ action: 'void' })} /> Void it</label></div>
          {change.action === 'edit' && (pick.type === 'SalesDoc'
            ? <div className="grid gap-3 md:grid-cols-4"><Field label="DR / SI no."><Input value={change.drSiNo ?? ''} onChange={(e) => setChange({ ...change, drSiNo: e.target.value })} placeholder="unchanged" /></Field><Field label="Payment mode"><Select value={change.paymentMode ?? ''} onChange={(e) => setChange({ ...change, paymentMode: e.target.value })}><option value="">unchanged</option><option value="CASH">Cash</option><option value="ONLINE">Online</option><option value="CREDIT_CARD">Credit card</option><option value="AR_PDC">AR / PDC</option></Select></Field><Field label="Customer name"><Input value={change.customerName ?? ''} onChange={(e) => setChange({ ...change, customerName: e.target.value })} placeholder="unchanged" /></Field><Field label="Delivery fee (₱)"><Input type="number" value={change.deliveryFee ?? ''} onChange={(e) => setChange({ ...change, deliveryFee: e.target.value })} placeholder="unchanged" /></Field></div>
            : <div className="grid gap-3 md:grid-cols-3"><Field label="Amount (₱)"><Input type="number" value={change.amount ?? ''} onChange={(e) => setChange({ ...change, amount: e.target.value })} placeholder="unchanged" /></Field><Field label="Payee"><Input value={change.payee ?? ''} onChange={(e) => setChange({ ...change, payee: e.target.value })} placeholder="unchanged" /></Field><Field label="Notes"><Input value={change.notes ?? ''} onChange={(e) => setChange({ ...change, notes: e.target.value })} placeholder="unchanged" /></Field></div>)}
          {change.action === 'void' && <p className="text-xs text-slate-500">Voiding a sale returns its items to stock once approved. Items or quantities cannot be edited: void it and record the correct sale.</p>}
          <div className="grid gap-3 md:grid-cols-2"><Field label="Reason (required)"><Select value={reason} onChange={(e) => setReason(e.target.value)}><option value="">— choose —</option>{REASONS.map((r) => <option key={r}>{r}</option>)}</Select></Field><Field label={reason === 'Other' ? 'Explain (required)' : 'Details'}><Input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="what happened" /></Field></div>
          <Button disabled={!ready || send.isPending} onClick={() => send.mutate()}>Send post-close edit request</Button>
          <ErrorBox error={send.error} />
        </>}
        {send.isSuccess && <p className="text-sm text-emerald-700">Sent. It changes nothing until it is approved.</p>}
      </div>}
    {recent.length > 0 && <div className="mt-4"><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Post-close edit requests</div>
      <ul className="divide-y text-sm">{recent.map((e) => <li key={e.id} className="py-1.5"><button className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => setOpen(open === e.id ? null : e.id)}><span className="font-medium">{e.before?.controlNo ?? e.documentType}</span><span className="text-slate-600">{e.reason}</span><span className="ml-auto">{e.appliedAt ? <Badge tone="green">applied</Badge> : <Badge tone="amber">see approval</Badge>}</span></button>{open === e.id && <ApprovalTimeline documentType="PostCloseEdit" documentId={e.id} title="Who approves it" />}</li>)}</ul></div>}
  </Card>;
}
