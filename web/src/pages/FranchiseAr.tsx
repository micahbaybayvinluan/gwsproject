import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, Select, Stat } from '@/components/ui/primitives';

interface Inv { id: string; controlNo: string; source: string; transferId: string | null; issueDate: string; dueDate: string; originalDueDate: string; extended: boolean; status: string; amount: string; principalPaid: string; unpaid: string; penalty: string; penaltyPaid: string; interest: string; interestPaid: string; chargesDue: string; totalDue: string; daysOverdue: number; twoMonthsOverdue: boolean; pendingExtension: { requestedDueDate: string } | null }
interface Franchise { locationId: string; code: string; name: string; owner: string | null; creditHold: boolean; creditHoldNote: string | null; invoices: Inv[]; totals: { goods: string; penalty: string; interest: string; total: string; overdue: string; overdueCount: number; flagged: number } }
interface Rules { termsDays: number; penaltyPct: number; dailyPct: number; effectiveFrom: string; flagDays: number }
interface Detail extends Inv { franchise: { id: string; name: string }; rules: Rules; payments: { id: string; receiptNo: string; paidOn: string; amount: string; toPenalty: string; toInterest: string; toPrincipal: string; mode: string; reference: string | null; by: string }[]; adjustments: { id: string; kind: string; delta: string; reason: string; at: string; by: string }[]; extensions: { id: string; status: string; reason: string; previousDueDate: string; requestedDueDate: string; by: string; at: string; decisionNote: string | null }[] }

const MODES: [string, string][] = [['BANK_TRANSFER', 'Bank transfer'], ['GCASH', 'GCash'], ['CHEQUE', 'Cheque'], ['CASH', 'Cash']];
const KIND: Record<string, string> = { TRANSFER_CHANGE: 'Changed with the transfer', WAIVER: 'Charges waived', EXTENSION: 'Due date moved', MANUAL: 'Manual', SHIPPING_EDIT: 'Shipping charge changed (Owner approved)' };

/** Recommended actions by how late the franchise is (memo of July 31, 2026). */
function actions(maxDays: number, flagDays: number) {
  const a: { when: string; what: string; hot?: boolean }[] = [];
  if (maxDays > 0) a.push({ when: 'Day 1', what: 'Penalty and interest start by themselves; the franchise owner, Accounting, auditors and the Franchise Coordinators are told.' });
  if (maxDays >= 7) a.push({ when: 'From day 7', what: 'The Franchise Coordinator calls the owner and issues a notice memo. The owner may ask for an extension here.', hot: true });
  if (maxDays >= 30) a.push({ when: 'From day 30', what: 'The Owner reviews the account and may put the franchise on cash-before-delivery.', hot: true });
  if (maxDays >= flagDays) a.push({ when: `From day ${flagDays} (two months)`, what: 'Demand memo; suspend or revoke credit; cash-before-delivery; other action the memo allows. The Owner decides.', hot: true });
  return a;
}

/** Franchise receivables (owner request 2026-09-30, memo 2026-07-31). Accounting records payments, the Owner waives and decides, the franchise owner sees their own account and asks for extensions. */
export function FranchiseArPage() {
  const { can, me } = useAuth(); const qc = useQueryClient(); const [sp] = useSearchParams();
  const [showPaid, setShowPaid] = useState(false); const [open, setOpen] = useState<string | null>(sp.get('invoice'));
  const [modal, setModal] = useState<{ kind: 'pay' | 'extend' | 'waive'; inv: Inv } | null>(null);
  const list = useQuery({ queryKey: ['franchise-ar', showPaid], queryFn: () => api.get<{ asOf: string; rules: Rules; franchises: Franchise[] }>(`/api/franchise-ar?status=${showPaid ? 'ALL' : 'OPEN'}`) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['franchise-ar'] }); void qc.invalidateQueries({ queryKey: ['franchise-ar-detail'] }); };
  const hold = useMutation({ mutationFn: (v: { id: string; hold: boolean; note?: string }) => api.put(`/api/franchise-ar/locations/${v.id}/credit-hold`, { hold: v.hold, note: v.note }), onSuccess: refresh });
  const rules = list.data?.rules; const all = list.data?.franchises ?? [];
  // franchises with nothing owed are folded into one line so the page stays short
  const fr = all.filter((f) => f.invoices.length || f.creditHold || all.length === 1); const quiet = all.filter((f) => !fr.includes(f));
  const owner = me?.roleKey === 'FRANCHISE_OWNER';
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Franchise AR</h1><label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={showPaid} onChange={(e) => setShowPaid(e.target.checked)} /> show paid invoices too</label></div>
    {rules && <Card title="How it works (memo of July 31, 2026)"><ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
      <li>Goods sent to a franchise are billed at the <b>franchise price</b> when the franchise receives them. Payment is due <b>{rules.termsDays} days</b> after receiving.</li>
      <li>From the day after the due date (memo effective {rules.effectiveFrom}): a one-time <b>{rules.penaltyPct}% penalty</b> plus <b>{rules.dailyPct}% a day</b> on the unpaid balance until it is settled. Example on ₱100,000 unpaid: 1 day {peso(100000 * (rules.penaltyPct / 100 + rules.dailyPct / 100))} · 5 days {peso(100000 * (rules.penaltyPct / 100 + 5 * rules.dailyPct / 100))} · 10 days {peso(100000 * (rules.penaltyPct / 100 + 10 * rules.dailyPct / 100))} · 30 days {peso(100000 * (rules.penaltyPct / 100 + 30 * rules.dailyPct / 100))}.</li>
      <li>A payment settles the penalty first, then the interest, then the goods.</li>
      <li>If the quantities change after receiving (a difference is resolved), the invoice changes by itself and the Owner, auditors, Accounting, the Franchise Coordinators, the sales associates involved and the franchise owner are told.</li>
      <li>Need more time? The franchise owner asks for an extension here. The Owner decides; auditors, Accounting and the Franchise Coordinators are flagged. Unpaid <b>two months</b> after the due date, the account is flagged for a demand, suspension of credit, or cash-before-delivery.</li>
    </ul></Card>}
    <ShippingCharges mark={sp.get('shipping')} />
    {list.isLoading ? <Empty>Loading…</Empty> : !fr.length ? <Empty>No franchises.</Empty> : fr.map((f) => {
      const maxDays = Math.max(0, ...f.invoices.map((i) => i.daysOverdue));
      return <Card key={f.locationId} title={<span className="flex flex-wrap items-center gap-2">{f.name}{f.owner && <span className="text-sm font-normal text-slate-500">owner: {f.owner}</span>}{f.creditHold && <Badge tone="red">cash-before-delivery</Badge>}{f.totals.flagged > 0 && <Badge tone="red">⚑ 2+ months overdue</Badge>}</span>}
        actions={can('franchise.ar.manage') ? <Button size="sm" variant="outline" disabled={hold.isPending} onClick={() => { if (f.creditHold) hold.mutate({ id: f.locationId, hold: false }); else { const note = window.prompt('Why is credit suspended? (shown to everyone concerned)', 'Unpaid accounts'); if (note !== null) hold.mutate({ id: f.locationId, hold: true, note }); } }}>{f.creditHold ? 'Restore credit' : 'Put on cash-before-delivery'}</Button> : undefined}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Goods unpaid" value={peso(f.totals.goods)} /><Stat label="Penalty" value={peso(f.totals.penalty)} tone={Number(f.totals.penalty) > 0 ? 'amber' : undefined} /><Stat label="Interest" value={peso(f.totals.interest)} tone={Number(f.totals.interest) > 0 ? 'amber' : undefined} />
          <Stat label="Total due" value={peso(f.totals.total)} tone={Number(f.totals.total) > 0 ? 'red' : 'green'} /><Stat label="Overdue" value={peso(f.totals.overdue)} sub={`${f.totals.overdueCount} invoice${f.totals.overdueCount === 1 ? '' : 's'}`} tone={f.totals.overdueCount ? 'red' : undefined} />
        </div>
        {f.creditHold && <p className="mt-2 rounded border border-red-200 bg-brand-soft p-2 text-sm text-brand-dark">On cash-before-delivery{f.creditHoldNote ? `: ${f.creditHoldNote}` : ''}. Goods are released only after payment is received.</p>}
        {maxDays > 0 && rules && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><div className="mb-1 font-semibold text-amber-900">Recommended process ({maxDays} days overdue at most)</div><ul className="space-y-0.5">{actions(maxDays, rules.flagDays).map((a) => <li key={a.when}><b>{a.when}:</b> {a.what}</li>)}</ul>
          {can('memo.create') && <div className="mt-2"><Link className="text-sm font-semibold text-brand hover:underline" to={`/memos?compose=overdue&franchise=${f.locationId}&days=${maxDays >= (rules?.flagDays ?? 60) ? 'demand' : 'notice'}`}>{maxDays >= (rules?.flagDays ?? 60) ? 'Write the demand memo →' : 'Write a notice memo →'}</Link></div>}</div>}
        {f.invoices.length ? <div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1 pr-3">Invoice</th><th className="pr-3">Received</th><th className="pr-3">Due</th><th className="num pr-3">Goods</th><th className="num pr-3">Paid</th><th className="num pr-3">Penalty</th><th className="num pr-3">Interest</th><th className="num pr-3">Total due</th><th className="pr-3">Status</th><th /></tr></thead>
          <tbody>{f.invoices.map((i) => <InvoiceRow key={i.id} inv={i} open={open === i.id} toggle={() => setOpen(open === i.id ? null : i.id)} canPay={can('franchise.ar.pay')} canWaive={can('franchise.ar.manage')} canExtend={owner || can('franchise.ar.manage')} act={(kind) => setModal({ kind, inv: i })} />)}</tbody></table></div>
          : <Empty>No open invoices.</Empty>}
      </Card>;
    })}
    {quiet.length > 0 && <p className="text-sm text-slate-500">Nothing owed by: {quiet.map((f) => f.name).join(', ')}.</p>}
    {modal?.kind === 'pay' && <PayModal inv={modal.inv} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
    {modal?.kind === 'extend' && <ExtendModal inv={modal.inv} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
    {modal?.kind === 'waive' && <WaiveModal inv={modal.inv} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
  </div>;
}

function InvoiceRow({ inv: i, open, toggle, canPay, canWaive, canExtend, act }: { inv: Inv; open: boolean; toggle: () => void; canPay: boolean; canWaive: boolean; canExtend: boolean; act: (k: 'pay' | 'extend' | 'waive') => void }) {
  const status = i.status === 'PAID' ? <Badge tone="green">paid</Badge> : i.daysOverdue > 0 ? <Badge tone="red">{i.daysOverdue} days overdue</Badge> : <Badge tone="amber">open</Badge>;
  return <>
    <tr className={`border-t align-top ${open ? 'bg-slate-50' : ''}`}>
      <td className="py-2 pr-3"><button className="font-medium text-brand hover:underline" onClick={toggle}>{i.controlNo}</button>{i.source === 'OPENING' && <div className="text-xs text-slate-500">old balance</div>}{i.source === 'SHIPPING' && <div className="text-xs text-slate-500">shipping charge</div>}</td>
      <td className="pr-3">{i.issueDate}</td><td className="pr-3">{i.dueDate}{i.extended && <div className="text-xs text-slate-500">was {i.originalDueDate}</div>}{i.pendingExtension && <div className="text-xs text-amber-700">extension asked: {i.pendingExtension.requestedDueDate}</div>}</td>
      <td className="num pr-3">{peso(i.amount)}</td><td className="num pr-3">{peso(i.principalPaid)}</td><td className="num pr-3">{Number(i.penalty) ? peso(Number(i.penalty) - Number(i.penaltyPaid)) : '—'}</td><td className="num pr-3">{Number(i.interest) ? peso(Number(i.interest) - Number(i.interestPaid)) : '—'}</td>
      <td className="num pr-3 font-semibold">{peso(i.totalDue)}</td><td className="pr-3">{status}{i.twoMonthsOverdue && <div><Badge tone="red">⚑ two months</Badge></div>}</td>
      <td className="whitespace-nowrap text-right"><span className="inline-flex flex-wrap justify-end gap-1">
        {i.status === 'OPEN' && canPay && <Button size="sm" onClick={() => act('pay')}>Record payment</Button>}
        {i.status === 'OPEN' && canExtend && !i.pendingExtension && <Button size="sm" variant="outline" onClick={() => act('extend')}>Ask for extension</Button>}
        {i.status === 'OPEN' && canWaive && Number(i.chargesDue) > 0 && <Button size="sm" variant="outline" onClick={() => act('waive')}>Waive charges</Button>}
      </span></td></tr>
    {open && <tr><td colSpan={10} className="bg-slate-50 px-3 pb-3"><InvoiceDetail id={i.id} /></td></tr>}
  </>;
}

function InvoiceDetail({ id }: { id: string }) {
  const d = useQuery({ queryKey: ['franchise-ar-detail', id], queryFn: () => api.get<Detail>(`/api/franchise-ar/${id}`) });
  const x = d.data; if (!x) return <p className="py-2 text-sm text-slate-500">Loading…</p>;
  const r = x.rules;
  const lateDays = x.daysOverdue;
  return <div className="grid gap-4 py-2 text-sm md:grid-cols-2">
    <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">How the amount is worked out</div>
      <div className="space-y-0.5"><div>Goods billed at the franchise price: <b>{peso(x.amount)}</b>{Number(x.amount) !== Number((x as unknown as { originalAmount: string }).originalAmount) && <span className="text-slate-500"> (first billed {peso((x as unknown as { originalAmount: string }).originalAmount)})</span>}</div>
        <div>Unpaid goods: <b>{peso(x.unpaid)}</b></div>
        <div>Penalty ({r.penaltyPct}% once, from the day after {x.dueDate}): <b>{peso(x.penalty)}</b>{Number(x.penaltyPaid) > 0 && ` · paid ${peso(x.penaltyPaid)}`}</div>
        <div>Interest ({r.dailyPct}% × unpaid goods × {lateDays} day{lateDays === 1 ? '' : 's'} late): <b>{peso(x.interest)}</b>{Number(x.interestPaid) > 0 && ` · paid ${peso(x.interestPaid)}`}</div>
        <div className="pt-1 text-base">Total due today: <b>{peso(x.totalDue)}</b></div></div>
      {x.transferId && <Link className="mt-2 inline-block text-brand hover:underline" to={`/transfers/${x.transferId}`}>Open the transfer form →</Link>}</div>
    <div className="space-y-3">
      {x.adjustments.length > 0 && <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Changes to this invoice</div><ul className="space-y-1">{x.adjustments.map((a) => <li key={a.id}><b>{KIND[a.kind] ?? a.kind}</b>{Number(a.delta) !== 0 && <span className={Number(a.delta) > 0 ? 'text-amber-700' : 'text-emerald-700'}> {Number(a.delta) > 0 ? '+' : ''}{peso(a.delta)}</span>} · {a.reason} <span className="text-slate-500">({a.at.slice(0, 10)}, {a.by})</span></li>)}</ul></div>}
      {x.payments.length > 0 && <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Payments</div><ul className="space-y-1">{x.payments.map((p) => <li key={p.id}>{p.paidOn} · <b>{peso(p.amount)}</b> · {MODES.find((m) => m[0] === p.mode)?.[1]}{p.reference ? ` · ref ${p.reference}` : ''} <span className="text-slate-500">({p.receiptNo}, {p.by}; penalty {peso(p.toPenalty)}, interest {peso(p.toInterest)}, goods {peso(p.toPrincipal)})</span></li>)}</ul></div>}
      {x.extensions.length > 0 && <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Extension requests</div><ul className="space-y-1">{x.extensions.map((e) => <li key={e.id}><Badge tone={e.status === 'APPROVED' ? 'green' : e.status === 'REJECTED' ? 'red' : 'amber'}>{e.status.toLowerCase()}</Badge> {e.previousDueDate} → {e.requestedDueDate} · {e.reason} <span className="text-slate-500">({e.by}{e.decisionNote ? `; ${e.decisionNote}` : ''})</span></li>)}</ul></div>}
    </div></div>;
}

function PayModal({ inv, onClose, onDone }: { inv: Inv; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ amount: String(inv.totalDue), mode: 'BANK_TRANSFER', accountId: '', reference: '', date: today(), notes: '' });
  const accts = useQuery({ queryKey: ['payment-accounts'], queryFn: () => api.get<{ id: string; title: string }[]>('/api/accounts/payment') });
  const m = useMutation({ mutationFn: () => api.post(`/api/franchise-ar/${inv.id}/payments`, { amount: Number(f.amount), mode: f.mode, paymentAccountId: f.accountId || null, reference: f.reference || null, paidOn: f.date, notes: f.notes || null }), onSuccess: onDone });
  return <Modal title={`Record payment · ${inv.controlNo}`} onClose={onClose}>
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Total due today <b>{peso(inv.totalDue)}</b> (goods {peso(inv.unpaid)}, penalty and interest {peso(inv.chargesDue)}). The payment settles the penalty first, then the interest, then the goods.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Amount received (₱)"><Input type="number" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Date received"><Input type="date" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Paid by"><Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="Deposited to"><Select value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}><option value="">—</option>{accts.data?.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</Select></Field>
        <Field label={f.mode === 'CHEQUE' ? 'Cheque no.' : 'Reference no.'}><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder={f.mode === 'CASH' ? 'optional' : 'required'} /></Field>
        <Field label="Notes"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <ErrorBox error={m.error} />
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={m.isPending || !(Number(f.amount) > 0) || (f.mode !== 'CASH' && !f.reference.trim())} onClick={() => m.mutate()}>Record payment</Button></div>
    </div></Modal>;
}

function ExtendModal({ inv, onClose, onDone }: { inv: Inv; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(''); const [reason, setReason] = useState('');
  const m = useMutation({ mutationFn: () => api.post(`/api/franchise-ar/${inv.id}/extension`, { requestedDueDate: date, reason }), onSuccess: onDone });
  return <Modal title={`Ask for an extension · ${inv.controlNo}`} onClose={onClose}>
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Current due date <b>{inv.dueDate}</b>{inv.daysOverdue > 0 && <>; it is {inv.daysOverdue} days overdue, so penalty and interest of {peso(inv.chargesDue)} have been added</>}. The Owner decides. The Owner, auditors, Accounting and the Franchise Coordinators are told of your request. If it is approved, no new penalty or interest is added until the new date (charges already added stay unless the Owner waives them).</p>
      <Field label="New due date"><Input type="date" min={inv.dueDate} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Why do you need more time? (required)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. payment from customers arrives on the 25th" /></Field>
      <ErrorBox error={m.error} />
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={m.isPending || !date || date <= inv.dueDate || reason.trim().length < 5} onClick={() => m.mutate()}>Send request</Button></div>
    </div></Modal>;
}

function WaiveModal({ inv, onClose, onDone }: { inv: Inv; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(inv.chargesDue)); const [reason, setReason] = useState('');
  const m = useMutation({ mutationFn: () => api.post(`/api/franchise-ar/${inv.id}/waive`, { amount: Number(amount), reason }), onSuccess: onDone });
  useEffect(() => { setAmount(String(inv.chargesDue)); }, [inv.chargesDue]);
  return <Modal title={`Waive penalty / interest · ${inv.controlNo}`} onClose={onClose}>
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Unpaid penalty and interest: <b>{peso(inv.chargesDue)}</b>. Everyone concerned is told of the waiver and the reason.</p>
      <Field label="Amount to waive (₱)"><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label="Reason (required)"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <ErrorBox error={m.error} />
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={m.isPending || !(Number(amount) > 0) || reason.trim().length < 5} onClick={() => m.mutate()}>Waive</Button></div>
    </div></Modal>;
}

interface Ship { id: string; saleId: string; drSiNo: string; franchise: string; status: string; fillBy: string; daysLate: number; overdue: boolean; amount: string | null; courier: string | null; reference: string | null; invoiceId: string | null; pendingEdit: { kind: 'AMOUNT' | 'FILL_BY'; amount?: string; fillBy?: string; reason: string } | null }

/** Shipping charged to a franchise on a sale (owner request 2026-10-01): tagged "to follow" on the sale; the Franchise Coordinator fills the amount within 2 days and it becomes its own invoice; a later change needs the Owner. */
function ShippingCharges({ mark }: { mark: string | null }) {
  const { can } = useAuth(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['franchise-shipping'], queryFn: () => api.get<Ship[]>('/api/franchise-ar/shipping-charges?status=ALL') });
  const [fill, setFill] = useState<Ship | null>(null); const [edit, setEdit] = useState<Ship | null>(null);
  const [f, setF] = useState({ amount: '', courier: '', reference: '', notes: '' }); const [e, setE] = useState({ amount: '', fillBy: '', reason: '' });
  const done = () => { setFill(null); setEdit(null); void qc.invalidateQueries({ queryKey: ['franchise-shipping'] }); void qc.invalidateQueries({ queryKey: ['franchise-ar'] }); };
  const doFill = useMutation({ mutationFn: () => api.post(`/api/franchise-ar/shipping-charges/${fill!.id}/fill`, { amount: Number(f.amount), courier: f.courier || null, reference: f.reference || null, notes: f.notes || null }), onSuccess: done });
  const doEdit = useMutation({ mutationFn: () => api.post(`/api/franchise-ar/shipping-charges/${edit!.id}/edit`, edit!.status === 'FILLED' ? { amount: Number(e.amount), reason: e.reason } : { fillBy: e.fillBy, reason: e.reason }), onSuccess: done });
  const rows = (q.data ?? []);
  if (!rows.length) return null;
  const waiting = rows.filter((r) => r.status === 'TO_FOLLOW').length;
  return <Card title={<span className="flex flex-wrap items-center gap-2">Shipping charges billed to franchises{waiting > 0 && <Badge tone="amber">{waiting} to follow</Badge>}</span>}>
    <p className="mb-2 text-sm text-slate-600">Shipping on a franchise sale is tagged <b>to follow</b>. The Franchise Coordinator fills in the amount within <b>2 days</b>; it then becomes a <b>separate franchise invoice</b> (not part of the order), with the usual due date, penalty and interest. A later change needs the Owner's approval.</p>
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1 pr-3">Franchise</th><th className="pr-3">Sale (DR)</th><th className="pr-3">Fill in by</th><th className="pr-3">Status</th><th className="num pr-3">Amount</th><th /></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id} className={`border-t ${mark === r.id ? 'bg-amber-50' : ''}`}>
        <td className="py-2 pr-3 font-medium">{r.franchise}</td>
        <td className="pr-3"><Link className="text-brand hover:underline" to={`/sales/${r.saleId}`}>{r.drSiNo}</Link></td>
        <td className="pr-3">{r.fillBy}</td>
        <td className="pr-3">{r.status === 'TO_FOLLOW' ? <Badge tone={r.overdue ? 'red' : 'amber'}>{r.overdue ? `to follow · ${r.daysLate} day${r.daysLate === 1 ? '' : 's'} late` : 'to follow'}</Badge> : <Badge tone="green">billed</Badge>}{r.pendingEdit && <div className="mt-1 text-xs text-amber-800">Change waiting for the Owner: {r.pendingEdit.kind === 'AMOUNT' ? peso(Number(r.pendingEdit.amount)) : `until ${r.pendingEdit.fillBy}`}</div>}</td>
        <td className="num pr-3">{r.amount != null ? peso(Number(r.amount)) : '—'}</td>
        <td className="space-x-1 whitespace-nowrap text-right">
          {can('franchise.shipping.fill') && r.status === 'TO_FOLLOW' && <Button size="sm" onClick={() => { setFill(r); setF({ amount: '', courier: r.courier ?? '', reference: r.reference ?? '', notes: '' }); }}>Fill in the amount</Button>}
          {can('franchise.shipping.fill') && !r.pendingEdit && <Button size="sm" variant="outline" onClick={() => { setEdit(r); setE({ amount: r.amount ?? '', fillBy: '', reason: '' }); }}>{r.status === 'TO_FOLLOW' ? 'Ask for more time' : 'Ask to change'}</Button>}
          {r.invoiceId && <Link className="text-xs font-semibold text-brand hover:underline" to={`/franchise-ar?invoice=${r.invoiceId}`}>invoice</Link>}
        </td></tr>)}</tbody></table></div>
    {fill && <Modal title={`Shipping charge · ${fill.franchise} · DR ${fill.drSiNo}`} onClose={() => setFill(null)}>
      <div className="space-y-3"><Field label="Shipping amount to bill the franchise (₱)"><Input type="number" inputMode="decimal" step="0.01" min={0} value={f.amount} onChange={(x) => setF({ ...f, amount: x.target.value })} autoFocus data-testid="ship-amount" /></Field>
        <Field label="Courier (optional)"><Input value={f.courier} onChange={(x) => setF({ ...f, courier: x.target.value })} /></Field><Field label="Waybill / reference (optional)"><Input value={f.reference} onChange={(x) => setF({ ...f, reference: x.target.value })} /></Field><Field label="Notes (optional)"><Input value={f.notes} onChange={(x) => setF({ ...f, notes: x.target.value })} /></Field>
        <p className="text-xs text-slate-500">This creates a separate franchise invoice due after the usual terms. The franchise owner, Owner, auditors and Accounting are told.</p>
        <ErrorBox error={doFill.error} /><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setFill(null)}>Cancel</Button><Button disabled={!(Number(f.amount) > 0) || doFill.isPending} onClick={() => doFill.mutate()} data-testid="ship-save">Bill the franchise</Button></div></div></Modal>}
    {edit && <Modal title={edit.status === 'TO_FOLLOW' ? 'Ask the Owner for more time' : `Ask the Owner to change the amount (now ${peso(Number(edit.amount ?? 0))})`} onClose={() => setEdit(null)}>
      <div className="space-y-3">{edit.status === 'FILLED' ? <Field label="New amount (₱)"><Input type="number" inputMode="decimal" step="0.01" min={0} value={e.amount} onChange={(x) => setE({ ...e, amount: x.target.value })} /></Field> : <Field label={`Fill in until (now ${edit.fillBy})`}><Input type="date" min={today()} value={e.fillBy} onChange={(x) => setE({ ...e, fillBy: x.target.value })} /></Field>}
        <Field label="Reason (required)"><Input value={e.reason} onChange={(x) => setE({ ...e, reason: x.target.value })} /></Field>
        <ErrorBox error={doEdit.error} /><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button disabled={e.reason.trim().length < 5 || (edit.status === 'FILLED' ? !(Number(e.amount) > 0) : !e.fillBy) || doEdit.isPending} onClick={() => doEdit.mutate()}>Send to the Owner</Button></div></div></Modal>}
  </Card>;
}
