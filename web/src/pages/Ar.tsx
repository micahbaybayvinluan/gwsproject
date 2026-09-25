import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, peso } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Field, Input, Select } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';
import { Attachments } from '@/components/Attachments';

interface ArRow { id: string; location: { name: string }; customer: string; customerId: string | null; agentId: string | null; drSiNo: string; docDate: string; amount: string; paid: string; balance: string; dueDate: string | null; daysOverdue: number; pdc: { bank: string; chequeNo: string } | null }

/** §8.3 Branch AR list + Record payment (partial ok) → credit note. */
export function ArPage() {
  const qc = useQueryClient(); const { can } = useAuth(); const [sp] = useSearchParams();
  const [overdue, setOverdue] = useState(sp.get('overdue') === '1'); const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pay, setPay] = useState({ amount: '', discount: '', paymentMode: 'CASH', paymentAccountId: '', notes: '' }); const [draftId] = useState(() => crypto.randomUUID()); const [proofId, setProofId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['ar', overdue], queryFn: () => api.get<ArRow[]>(`/api/ar${overdue ? '?overdue=1' : ''}`) });
  const cn = useQuery({ queryKey: ['credit-notes'], queryFn: () => api.get<{ id: string; creditNoteNo: string; amount: string; paymentMode: string; receivedAt: string; status: string; enteredBy: string | null; customer: { name: string } | null }[]>('/api/ar/credit-notes') });
  const accts = useQuery({ queryKey: ['payment-accounts'], queryFn: () => api.get<{ id: string; title: string }[]>('/api/accounts/payment') });
  const m = useMutation({ mutationFn: () => api.post<{ creditNoteNo: string; status: string }>('/api/ar/payments', { salesDocIds: [...selected], amount: Number(pay.amount), discount: Number(pay.discount || 0), paymentMode: pay.paymentMode, paymentAccountId: pay.paymentAccountId || null, proofAttachmentId: proofId, notes: pay.notes }), onSuccess: () => { setSelected(new Set()); setPay({ amount: '', discount: '', paymentMode: 'CASH', paymentAccountId: '', notes: '' }); void qc.invalidateQueries({ queryKey: ['ar'] }); void qc.invalidateQueries({ queryKey: ['credit-notes'] }); } });
  const selRows = (q.data ?? []).filter((r) => selected.has(r.id)); const selBal = selRows.reduce((s, r) => s + Number(r.balance), 0);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3"><h1 className="text-xl font-semibold">Accounts Receivable / PDC</h1><label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} /> Overdue only</label></div>
    <DataTable exportName="AR" data={q.data ?? []} selectable selected={selected} onSelectedChange={setSelected} columns={[
      { header: 'Branch', accessorFn: (r) => r.location.name }, { header: 'Customer', accessorKey: 'customer' }, { header: 'DR/SI', accessorKey: 'drSiNo' }, { header: 'Date', accessorKey: 'docDate' }, { header: 'Amount', accessorKey: 'amount', cell: (c) => <span className="num block">{peso(c.getValue())}</span> }, { header: 'Paid', accessorKey: 'paid', cell: (c) => <span className="num block">{peso(c.getValue())}</span> }, { header: 'Balance', accessorKey: 'balance', cell: (c) => <span className="num block font-medium">{peso(c.getValue())}</span> }, { header: 'Due', accessorKey: 'dueDate' }, { header: 'Overdue', accessorKey: 'daysOverdue', cell: (c) => (Number(c.getValue()) > 0 ? <Badge tone="red">{String(c.getValue())} d</Badge> : <Badge tone="green">current</Badge>) }, { header: 'PDC', accessorFn: (r) => (r.pdc ? `${r.pdc.bank} ${r.pdc.chequeNo}` : '') },
    ]} />
    {can('ar.collect') && <Card title={`Record payment (${selRows.length} invoice(s), balance ${peso(selBal)})`}>
      <p className="mb-2 text-sm text-slate-600">{can('ar.approve') ? 'Payments you record apply at once; the branch is notified.' : 'You can record a payment any day. The Accounting Associate or Head approves it before the invoices are credited.'}</p>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Amount received"><Input type="number" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
        <Field label="Discount (optional)"><Input type="number" inputMode="decimal" value={pay.discount} onChange={(e) => setPay({ ...pay, discount: e.target.value })} /></Field>
        <Field label="Mode"><Select value={pay.paymentMode} onChange={(e) => setPay({ ...pay, paymentMode: e.target.value })}><option value="CASH">Cash</option><option value="ONLINE">Online</option><option value="CREDIT_CARD">Credit card</option></Select></Field>
        {pay.paymentMode !== 'CASH' && <Field label="Account"><Select value={pay.paymentAccountId} onChange={(e) => setPay({ ...pay, paymentAccountId: e.target.value })}><option value="">—</option>{accts.data?.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</Select></Field>}
      </div>
      {pay.paymentMode !== 'CASH' && <div className="mt-3"><Attachments type="Payment" id={draftId} onUploaded={(a) => setProofId(a.id)} /></div>}
      <div className="mt-3 flex items-center gap-2"><Button disabled={!selRows.length || !pay.amount || m.isPending} onClick={() => m.mutate()}>{can('ar.approve') ? 'Record payment & issue credit note' : 'Send payment for Accounting approval'}</Button>{m.data && <span className="text-sm text-emerald-700">{m.data.status === 'PENDING' ? `Payment ${m.data.creditNoteNo} sent to Accounting for approval. The invoices are credited once approved.` : `Credit note ${m.data.creditNoteNo} issued`}</span>}</div>
      <ErrorBox error={m.error} />
    </Card>}
    <Card title="Credit note register"><DataTable exportName="CreditNotes" data={cn.data ?? []} columns={[{ header: 'CN #', accessorKey: 'creditNoteNo' }, { header: 'Date', accessorFn: (r) => r.receivedAt.slice(0, 10) }, { header: 'Customer', accessorFn: (r) => r.customer?.name ?? '' }, { header: 'Mode', accessorKey: 'paymentMode' }, { header: 'Amount', accessorKey: 'amount', cell: (c) => <span className="num block">{peso(c.getValue())}</span> }, { header: 'Entered by', accessorFn: (r) => r.enteredBy ?? '' }, { header: 'Status', accessorKey: 'status', cell: (c) => <Badge tone={c.getValue() === 'PENDING' ? 'amber' : c.getValue() === 'REJECTED' ? 'red' : 'green'}>{c.getValue() === 'PENDING' ? 'Waiting for Accounting' : String(c.getValue())}</Badge> }, { header: '', cell: (c) => <Button size="sm" variant="outline" onClick={() => api.download(`/api/reports/forms/credit-note/${c.row.original.id}.pdf`, `${c.row.original.creditNoteNo}.pdf`)}>PDF</Button> }]} /></Card>
  </div>;
}
