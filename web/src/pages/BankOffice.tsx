import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, fmtDate, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Select } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';
import { cn } from '@/lib/utils';

interface Acct { id: string; code: string; title: string; class: string }
interface Options { banks: Acct[]; groups: { key: string; label: string; accounts: Acct[] }[] }
interface Entry { id: string; voucherNo: string; date: string; book: string; name: string | null; reference: string | null; remarks: string | null; enteredBy: string | null; lines: { debit: string; credit: string; account: { code: string; title: string } }[] }
const CLASS_LABEL: Record<string, string> = { CASH: 'Cash and banks', AR: 'Receivables', ADVANCES_TO: 'Advances to', FIXED_ASSET: 'Fixed assets', ACCUM_DEPN: 'Accumulated depreciation', CURRENT_LIABILITY: 'Payables and other liabilities', ADVANCES_FROM: 'Advances from', EQUITY: 'Capital / equity' };

/** Executive Assistant (owner request 2026-09-26): main bank receipts and payments by book, supplier payables, office expenses, balance-sheet accounts. */
export function BankOfficePage() {
  const { can } = useAuth(); const qc = useQueryClient();
  const [tab, setTab] = useState<'entry' | 'payables' | 'expenses' | 'balances'>('entry');
  const opts = useQuery({ queryKey: ['bank-options'], queryFn: () => api.get<Options>('/api/bank-entries/options') });
  const list = useQuery({ queryKey: ['bank-entries'], queryFn: () => api.get<Entry[]>('/api/bank-entries') });
  const [f, setF] = useState({ date: today(), bankAccountId: '', direction: 'OUT' as 'IN' | 'OUT', group: 'ADVANCES_TO', accountId: '', amount: '', name: '', reference: '', remarks: '' });
  const group = opts.data?.groups.find((g) => g.key === f.group);
  const m = useMutation({ mutationFn: () => api.post<Entry>('/api/bank-entries', { ...f, amount: Number(f.amount) }), onSuccess: () => { setF({ ...f, amount: '', name: '', reference: '', remarks: '' }); void qc.invalidateQueries({ queryKey: ['bank-entries'] }); void qc.invalidateQueries({ queryKey: ['bs-balances'] }); } });
  const tabs = [['entry', 'Bank entries'], ['payables', 'Supplier payables'], ['expenses', 'Office expenses'], ...(can('bs.accounts.view') ? [['balances', 'Balance sheet accounts']] : [])] as [typeof tab, string][];
  return <div className="space-y-5">
    <div><h1 className="text-2xl font-bold tracking-tight text-navy">Bank & Office</h1><p className="text-sm text-slate-500">Receipts and payments on the main bank accounts, supplier payables and main office expenses.</p></div>
    <div className="inline-flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">{tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={cn('rounded-lg px-3.5 py-1.5 text-sm font-semibold transition', tab === k ? 'bg-navy text-white shadow' : 'text-slate-600 hover:text-navy')}>{l}</button>)}</div>
    {tab === 'entry' && <>
      <Card title="New bank entry">
        <div className="mb-4 inline-flex rounded-xl bg-silver p-1">{(['OUT', 'IN'] as const).map((d) => <button key={d} onClick={() => setF({ ...f, direction: d })} className={cn('rounded-lg px-4 py-1.5 text-sm font-semibold', f.direction === d ? (d === 'OUT' ? 'bg-brand text-white' : 'bg-emerald-600 text-white') : 'text-slate-600')}>{d === 'OUT' ? 'Payment out of the bank' : 'Receipt into the bank'}</button>)}</div>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Bank account"><Select value={f.bankAccountId} onChange={(e) => setF({ ...f, bankAccountId: e.target.value })}><option value="">— choose —</option>{opts.data?.banks.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}</Select></Field>
          <Field label="Amount (₱)"><Input type="number" min={0.01} step="0.01" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Book"><Select value={f.group} onChange={(e) => setF({ ...f, group: e.target.value, accountId: '' })}>{opts.data?.groups.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}</Select></Field>
          <Field label="Account"><Select value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}><option value="">— choose —</option>{group?.accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.title}</option>)}</Select></Field>
          <Field label={f.direction === 'OUT' ? 'Paid to' : 'Received from'}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Reference (cheque / transfer no.)"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
          <Field label="Remarks" className="md:col-span-2"><Input value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
        </div>
        <div className="mt-4 flex items-center gap-3"><Button disabled={!f.bankAccountId || !f.accountId || !(Number(f.amount) > 0) || m.isPending} onClick={() => m.mutate()}>Save entry</Button>{m.data && <span className="text-sm text-emerald-700">Saved as {m.data.voucherNo}</span>}</div>
        <ErrorBox error={m.error || opts.error} />
      </Card>
      <Card title="Recent entries"><DataTable exportName="BankEntries" data={list.data ?? []} columns={[{ header: 'Date', accessorKey: 'date', cell: (c) => fmtDate(c.getValue()) }, { header: 'Voucher', accessorKey: 'voucherNo' }, { header: 'Book', accessorKey: 'book' }, { header: 'Name', accessorFn: (r) => r.name ?? '' }, { header: 'Accounts', accessorFn: (r) => r.lines.map((l) => `${Number(l.debit) ? 'Dr' : 'Cr'} ${l.account.title}`).join(' / '), cell: (c) => <span className="text-xs">{String(c.getValue())}</span> }, { header: 'Amount', accessorFn: (r) => r.lines.reduce((s, l) => s + Number(l.debit), 0), cell: (c) => <span className="num block font-semibold">{peso(c.getValue())}</span> }, { header: 'Entered by', accessorFn: (r) => r.enteredBy ?? '' }]} /></Card>
    </>}
    {tab === 'payables' && <Payables />}
    {tab === 'expenses' && <OfficeExpenses />}
    {tab === 'balances' && <Balances />}
  </div>;
}

function Payables() {
  const q = useQuery({ queryKey: ['bank-payables'], queryFn: () => api.get<{ supplierCode: string; supplierName?: string; controlNo: string; supplierRef: string | null; docDate: string; dueDate: string; amountDue: string; daysOverdue: number }[]>('/api/bank-entries/payables') });
  const total = (q.data ?? []).reduce((s, r) => s + Number(r.amountDue), 0);
  return <Card title={<>Supplier payables <Badge tone="amber">{peso(total)}</Badge></>}><DataTable exportName="SupplierPayables" data={q.data ?? []} columns={[{ header: 'Supplier', accessorFn: (r) => r.supplierName ?? r.supplierCode }, { header: 'Receiving', accessorKey: 'controlNo' }, { header: 'Invoice ref', accessorFn: (r) => r.supplierRef ?? '' }, { header: 'Date', accessorKey: 'docDate' }, { header: 'Due', accessorKey: 'dueDate' }, { header: 'Amount due', accessorKey: 'amountDue', cell: (c) => <span className="num block font-semibold">{peso(c.getValue())}</span> }, { header: 'Overdue', accessorKey: 'daysOverdue', cell: (c) => (Number(c.getValue()) > 0 ? <Badge tone="red">{String(c.getValue())} d</Badge> : <Badge tone="green">current</Badge>) }]} /><ErrorBox error={q.error} /></Card>;
}
function OfficeExpenses() {
  const [r, setR] = useState({ from: today().slice(0, 8) + '01', to: today() });
  const q = useQuery({ queryKey: ['office-expenses', r], queryFn: () => api.get<{ id: string; controlNo: string; docDate: string; payee: string | null; amount: string; notes: string | null; account: { code: string; title: string }; location: { name: string } }[]>(`/api/bank-entries/office-expenses?from=${r.from}&to=${r.to}`) });
  return <Card title="Main office expenses" actions={<><Input type="date" value={r.from} onChange={(e) => setR({ ...r, from: e.target.value })} /><Input type="date" value={r.to} onChange={(e) => setR({ ...r, to: e.target.value })} /></>}><DataTable exportName="OfficeExpenses" data={q.data ?? []} columns={[{ header: 'Date', accessorKey: 'docDate', cell: (c) => fmtDate(c.getValue()) }, { header: 'No.', accessorKey: 'controlNo' }, { header: 'Account', accessorFn: (x) => x.account.title }, { header: 'Payee', accessorFn: (x) => x.payee ?? '' }, { header: 'Where', accessorFn: (x) => x.location.name }, { header: 'Amount', accessorKey: 'amount', cell: (c) => <span className="num block">{peso(c.getValue())}</span> }]} /><ErrorBox error={q.error} /></Card>;
}
function Balances() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const q = useQuery({ queryKey: ['bs-balances', year], queryFn: () => api.get<{ rows: { id: string; code: string; title: string; class: string; beginning: string; movement: string; balance: string }[]; totals: { assets: string; liabilities: string; equity: string }; note: string }>(`/api/bank-entries/balances?year=${year}`) });
  const d = q.data;
  return <Card title="Balance sheet — per account" actions={<Select value={year} onChange={(e) => setYear(e.target.value)}>{[0, 1, 2].map((k) => { const y = String(new Date().getFullYear() - k); return <option key={y}>{y}</option>; })}</Select>}>
    {!d ? <Empty>Loading…</Empty> : <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">{[['Assets', d.totals.assets], ['Liabilities', d.totals.liabilities], ['Equity', d.totals.equity]].map(([k, v]) => <div key={k} className="rounded-xl bg-silver p-3"><div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{k}</div><div className="text-xl font-bold text-navy">{peso(v)}</div></div>)}</div>
      {Object.keys(CLASS_LABEL).map((cls) => { const rows = d.rows.filter((r) => r.class === cls); if (!rows.length) return null; return <div key={cls} className="mb-4"><div className="mb-1 text-xs font-semibold uppercase tracking-wider text-brand">{CLASS_LABEL[cls]}</div><div className="sticky-head"><table className="w-full text-sm"><tbody>{rows.map((r) => <tr key={r.id} className="border-t border-slate-100"><td className="w-24 py-1.5 text-xs text-slate-400">{r.code}</td><td>{r.title}</td><td className="num text-xs text-slate-500">beg {peso(r.beginning)}</td><td className="num font-semibold text-navy">{peso(r.balance)}</td></tr>)}</tbody></table></div></div>; })}
      <p className="text-xs text-slate-500">{d.note}</p>
    </>}
    <ErrorBox error={q.error} />
  </Card>;
}
