import { locLabel } from '@/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, peso } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Field, Input, Select } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';
import { Attachments } from '@/components/Attachments';

interface ArRow { id: string; location: { id: string; name: string; type?: string }; customer: string; customerId: string | null; agentId: string | null; drSiNo: string; docDate: string; amount: string; paid: string; balance: string; dueDate: string | null; daysOverdue: number; pdc: { bank: string; chequeNo: string } | null }

/** §8.3 Branch AR list + Record payment (partial ok) → credit note. */
export function ArPage() {
  const qc = useQueryClient(); const { can } = useAuth(); const [sp] = useSearchParams();
  const [overdue, setOverdue] = useState(sp.get('overdue') === '1'); const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pay, setPay] = useState({ amount: '', discount: '', paymentMode: 'CASH', paymentAccountId: '', notes: '' }); const [draftId] = useState(() => crypto.randomUUID()); const [proofId, setProofId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['ar', overdue], queryFn: () => api.get<ArRow[]>(`/api/ar${overdue ? '?overdue=1' : ''}`) });
  const cn = useQuery({ queryKey: ['credit-notes'], queryFn: () => api.get<{ id: string; creditNoteNo: string; amount: string; paymentMode: string; receivedAt: string; status: string; enteredBy: string | null; customer: { name: string } | null }[]>('/api/ar/credit-notes') });
  const accts = useQuery({ queryKey: ['payment-accounts'], queryFn: () => api.get<{ id: string; title: string }[]>('/api/accounts/payment'), enabled: can('ar.collect') });
  const m = useMutation({ mutationFn: () => api.post<{ creditNoteNo: string; status: string }>('/api/ar/payments', { salesDocIds: [...selected], amount: Number(pay.amount), discount: Number(pay.discount || 0), paymentMode: pay.paymentMode, paymentAccountId: pay.paymentAccountId || null, proofAttachmentId: proofId, notes: pay.notes }), onSuccess: () => { setSelected(new Set()); setPay({ amount: '', discount: '', paymentMode: 'CASH', paymentAccountId: '', notes: '' }); void qc.invalidateQueries({ queryKey: ['ar'] }); void qc.invalidateQueries({ queryKey: ['credit-notes'] }); } });
  // AR per branch (owner request 2026-09-29): a total per branch, and one branch or all in the list
  const [branch, setBranch] = useState(sp.get('locationId') ?? '');
  const all = q.data ?? [];
  const perBranch = [...all.reduce((m, r) => { const k = r.location.id; const cur = m.get(k) ?? { name: locLabel(r.location), id: k, open: 0, overdue: 0, invoices: 0 }; cur.open += Number(r.balance); cur.invoices++; if (r.daysOverdue > 0) cur.overdue += Number(r.balance); m.set(k, cur); return m; }, new Map<string, { name: string; id: string; open: number; overdue: number; invoices: number }>()).values()].sort((a, b) => b.open - a.open);
  const rows = branch ? all.filter((r) => r.location.id === branch) : all;
  const selRows = (q.data ?? []).filter((r) => selected.has(r.id)); const selBal = selRows.reduce((s, r) => s + Number(r.balance), 0);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-bold tracking-tight text-navy">AR & Collections</h1><label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} /> Overdue only</label>{perBranch.length > 1 && <Field label="Branch"><Select value={branch} onChange={(e) => setBranch(e.target.value)}><option value="">All branches</option>{perBranch.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>}</div>
    {(can('ar.opening') || can('approval.act.OPENING_AR')) && <OpeningArCard highlight={sp.get('opening')} />}
    {perBranch.length > 0 && <Card title="AR per branch">
      <table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1">Branch</th><th className="num">Invoices</th><th className="num">Open balance</th><th className="num">Overdue</th><th /></tr></thead><tbody>
        {perBranch.map((b) => <tr key={b.id} className={`border-t ${branch === b.id ? 'bg-brand-soft' : ''}`}><td className="py-1.5 font-medium">{b.name}</td><td className="num">{b.invoices}</td><td className="num">{peso(b.open)}</td><td className={`num ${b.overdue > 0 ? 'font-semibold text-red-700' : ''}`}>{peso(b.overdue)}</td><td className="text-right"><button className="text-xs text-brand underline" onClick={() => setBranch(branch === b.id ? '' : b.id)}>{branch === b.id ? 'Show all' : 'Show this branch'}</button></td></tr>)}
        {perBranch.length > 1 && <tr className="border-t font-semibold"><td className="py-1.5">All branches</td><td className="num">{all.length}</td><td className="num">{peso(perBranch.reduce((t, b) => t + b.open, 0))}</td><td className="num">{peso(perBranch.reduce((t, b) => t + b.overdue, 0))}</td><td /></tr>}
      </tbody></table>
    </Card>}
    <DataTable exportName="AR" data={rows} selectable selected={selected} onSelectedChange={setSelected} columns={[
      { header: 'Branch', accessorFn: (r) => locLabel(r.location) }, { header: 'Customer', accessorKey: 'customer' }, { header: 'DR/SI', accessorKey: 'drSiNo' }, { header: 'Date', accessorKey: 'docDate' }, { header: 'Amount', accessorKey: 'amount', cell: (c) => <span className="num block">{peso(c.getValue())}</span> }, { header: 'Paid', accessorKey: 'paid', cell: (c) => <span className="num block">{peso(c.getValue())}</span> }, { header: 'Balance', accessorKey: 'balance', cell: (c) => <span className="num block font-medium">{peso(c.getValue())}</span> }, { header: 'Due', accessorKey: 'dueDate' }, { header: 'Overdue', accessorKey: 'daysOverdue', cell: (c) => (Number(c.getValue()) > 0 ? <Badge tone="red">{String(c.getValue())} d</Badge> : <Badge tone="green">current</Badge>) }, { header: 'PDC', accessorFn: (r) => (r.pdc ? `${r.pdc.bank} ${r.pdc.chequeNo}` : '') },
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

interface OpeningEntry { id: string; location: { id: string; name: string; type: string } | null; kind: string; customerName: string | null; drSiNo: string; docDate: string; dueDate: string; amount: string; pdcChequeNo: string | null; pdcDate: string | null; status: string; decisionNote: string | null; createdByName: string | null; createdAt: string }
const KINDS = [['DEALER', 'Dealer'], ['FRANCHISE', 'Franchisee'], ['AGENT', 'Agent'], ['OTHER', 'Other customer']] as const;
const blankOpening = { locationId: '', kind: 'DEALER', customerId: '', agentId: '', customerName: '', drSiNo: '', docDate: '', dueDate: '', amount: '', hasPdc: false, pdcBank: '', pdcChequeNo: '', pdcDate: '', notes: '' };

/** AR from before GWS-ERP: Accounting enters it for any branch; the Owner approves; it then shows in that branch's AR (owner request 2026-09-29). */
function OpeningArCard({ highlight }: { highlight: string | null }) {
  const qc = useQueryClient(); const { can, me } = useAuth();
  const [f, setF] = useState(blankOpening); const [show, setShow] = useState(highlight ? 'ALL' : 'PENDING'); const [open, setOpen] = useState(!!highlight);
  const canEnter = can('ar.opening');
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; type: string }[]>('/api/locations'), enabled: canEnter });
  const customers = useQuery({ queryKey: ['customers'], queryFn: () => api.get<{ id: string; name: string; type: string }[]>('/api/customers'), enabled: canEnter });
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => api.get<{ id: string; name: string; location?: { name: string } | null }[]>('/api/agents'), enabled: canEnter });
  const list = useQuery({ queryKey: ['opening-ar', show], queryFn: () => api.get<OpeningEntry[]>(`/api/ar/opening${show === 'ALL' ? '' : `?status=${show}`}`) });
  const save = useMutation({
    mutationFn: () => api.post<OpeningEntry>('/api/ar/opening', { locationId: f.locationId, kind: f.kind, customerId: f.kind === 'AGENT' ? null : f.customerId || null, agentId: f.kind === 'AGENT' ? f.agentId : null, customerName: f.kind === 'OTHER' && !f.customerId ? f.customerName : null,
      drSiNo: f.drSiNo, docDate: f.docDate, dueDate: f.dueDate, amount: Number(f.amount), pdcBank: f.hasPdc ? f.pdcBank : null, pdcChequeNo: f.hasPdc ? f.pdcChequeNo : null, pdcDate: f.hasPdc ? f.pdcDate || null : null, notes: f.notes || null }),
    onSuccess: () => { setF({ ...blankOpening, locationId: f.locationId, kind: f.kind, docDate: f.docDate }); void qc.invalidateQueries({ queryKey: ['opening-ar'] }); void qc.invalidateQueries({ queryKey: ['ar'] }); },
  });
  const custList = (customers.data ?? []).filter((c) => (f.kind === 'OTHER' ? !['DEALER', 'FRANCHISE', 'CONSIGNEE'].includes(c.type) : c.type === f.kind));
  const who = f.kind === 'AGENT' ? f.agentId : f.customerId || (f.kind === 'OTHER' && f.customerName.trim());
  const ready = f.locationId && who && f.drSiNo.trim() && f.docDate && f.dueDate && Number(f.amount) > 0 && (!f.hasPdc || (f.pdcChequeNo.trim() && f.pdcDate));
  const rows = list.data ?? [];
  const tone = (s: string) => (s === 'APPROVED' ? 'green' : s === 'REJECTED' ? 'red' : 'amber') as 'green' | 'red' | 'amber';
  return <Card title={<>Opening AR (before GWS-ERP) {rows.filter((r) => r.status === 'PENDING').length > 0 && <Badge tone="amber">{rows.filter((r) => r.status === 'PENDING').length} waiting</Badge>}</>}>
    <p className="text-sm text-slate-600">Customer credit from before the system started, per branch. {me?.roleKey === 'ADMIN' ? 'Your entries apply at once.' : 'Each entry waits for the Owner’s approval (My Approvals, tick all).'} Once approved it appears in the branch’s AR & Collections with its due date, and the branch is told. It is not posted to the books again: the AR beginning balance is in Periods & Opening. For many invoices use Imports → Open AR.</p>
    {canEnter && <div className="mt-3">
      {!open ? <Button variant="outline" onClick={() => setOpen(true)}>+ Enter opening AR</Button> : <div className="space-y-3 rounded-lg border border-slate-200 p-3">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Branch"><Select value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}><option value="">— choose —</option>{(locations.data ?? []).filter((l) => ['BRANCH', 'WAREHOUSE', 'FRANCHISE', 'OFFICE'].includes(l.type)).map((l) => <option key={l.id} value={l.id}>{locLabel(l)}</option>)}</Select></Field>
          <div className="text-sm md:col-span-3"><span className="mb-1.5 block text-[13px] font-medium text-slate-600">Customer type</span><div className="flex flex-wrap gap-1">{KINDS.map(([k, label]) => <button key={k} type="button" onClick={() => setF({ ...f, kind: k, customerId: '', agentId: '', customerName: '' })} className={`rounded-full border px-3 py-1 text-sm ${f.kind === k ? 'border-navy bg-navy text-white' : 'border-slate-300 bg-white'}`}>{label}</button>)}</div></div>
          {f.kind === 'AGENT'
            ? <Field label="Agent"><Select value={f.agentId} onChange={(e) => setF({ ...f, agentId: e.target.value })}><option value="">— choose —</option>{(agents.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}{a.location?.name ? ` · ${a.location.name}` : ''}</option>)}</Select></Field>
            : <Field label={f.kind === 'DEALER' ? 'Dealer' : f.kind === 'FRANCHISE' ? 'Franchisee' : 'Customer'}><Select value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value })}><option value="">{f.kind === 'OTHER' ? '— choose, or type the name →' : '— choose —'}</option>{custList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>}
          {f.kind === 'OTHER' && !f.customerId && <Field label="Customer name"><Input value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} /></Field>}
          <Field label="DR / SI no."><Input value={f.drSiNo} onChange={(e) => setF({ ...f, drSiNo: e.target.value })} /></Field>
          <Field label="Invoice date"><Input type="date" value={f.docDate} onChange={(e) => setF({ ...f, docDate: e.target.value })} /></Field>
          <Field label="Due date"><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
          <Field label="Balance still owed (₱)"><Input type="number" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.hasPdc} onChange={(e) => setF({ ...f, hasPdc: e.target.checked })} /> There is a PDC</label>
        {f.hasPdc && <div className="grid gap-3 md:grid-cols-3"><Field label="Bank"><Input value={f.pdcBank} onChange={(e) => setF({ ...f, pdcBank: e.target.value })} /></Field><Field label="Cheque no."><Input value={f.pdcChequeNo} onChange={(e) => setF({ ...f, pdcChequeNo: e.target.value })} /></Field><Field label="Cheque date"><Input type="date" value={f.pdcDate} onChange={(e) => setF({ ...f, pdcDate: e.target.value })} /></Field></div>}
        <Field label="Note (optional)"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. from the 2025 AR ledger" /></Field>
        <div className="flex flex-wrap items-center gap-2"><Button disabled={!ready || save.isPending} onClick={() => save.mutate()}>{me?.roleKey === 'ADMIN' ? 'Save opening AR' : 'Send for the Owner’s approval'}</Button><Button variant="outline" onClick={() => setOpen(false)}>Close</Button>{save.isSuccess && <span className="text-sm text-emerald-700">Saved. Enter the next one.</span>}</div>
        <ErrorBox error={save.error} />
      </div>}
    </div>}
    <div className="mt-4 flex items-center gap-2 text-sm"><span className="text-slate-500">Show</span>{[['PENDING', 'Waiting for the Owner'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['ALL', 'All']].map(([k, label]) => <button key={k} type="button" onClick={() => setShow(k)} className={`rounded-full border px-3 py-0.5 ${show === k ? 'border-navy bg-navy text-white' : 'border-slate-300'}`}>{label}</button>)}</div>
    {rows.length ? <table className="mt-2 w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1">Branch</th><th>Customer</th><th>DR / SI</th><th>Invoice date</th><th>Due</th><th className="num">Amount</th><th>PDC</th><th>Entered by</th><th>Status</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id} className={`border-t ${r.id === highlight ? 'bg-amber-50' : ''}`}><td className="py-1">{r.location ? locLabel(r.location) : '—'}</td><td>{r.customerName}</td><td>{r.drSiNo}</td><td>{r.docDate}</td><td>{r.dueDate}</td><td className="num">{peso(r.amount)}</td><td>{r.pdcChequeNo ? `${r.pdcChequeNo} · ${r.pdcDate}` : '—'}</td><td>{r.createdByName}</td><td><Badge tone={tone(r.status)}>{r.status === 'PENDING' ? 'Waiting for the Owner' : r.status === 'APPROVED' ? 'Approved · in the branch AR' : 'Rejected'}</Badge>{r.decisionNote && r.status === 'REJECTED' ? <div className="text-xs text-red-700">{r.decisionNote}</div> : null}</td></tr>)}</tbody></table>
      : <p className="mt-2 text-sm text-slate-500">No entries here yet.</p>}
  </Card>;
}
