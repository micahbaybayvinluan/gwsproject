import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, fmtDate, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, ErrorBox, Field, Input, Select } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';
import { Attachments } from '@/components/Attachments';

/** §8.6 Branch expenses (accounts tagged to the branch, exact COA names) and main expenses for accounting roles. */
export function ExpensesPage() {
  const { me, can } = useAuth(); const qc = useQueryClient();
  const [locationId, setLocationId] = useState(me!.locations[0]?.id ?? ''); const [main, setMain] = useState(false);
  const [f, setF] = useState({ accountId: '', payee: '', amount: '', paidFrom: 'CASH_DRAWER', paidFromAccountId: '', notes: '', docDate: today() });
  const [created, setCreated] = useState<string | null>(null);
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; type: string }[]>('/api/locations'), enabled: !me!.locationScoped });
  const accounts = useQuery({ queryKey: ['expense-accounts', locationId, main], queryFn: () => api.get<{ id: string; title: string }[]>(`/api/expenses/accounts${main ? '' : `?locationId=${locationId}`}`), enabled: main || !!locationId });
  const payAccts = useQuery({ queryKey: ['payment-accounts', locationId], queryFn: () => api.get<{ id: string; title: string }[]>(`/api/accounts/payment?locationId=${locationId}`) });
  const list = useQuery({ queryKey: ['expenses', locationId, main], queryFn: () => api.get<{ id: string; controlNo: string; docDate: string; amount: string; payee: string | null; paidFrom: string; account: { title: string }; location: { name: string } }[]>(`/api/expenses?${main ? 'main=1' : locationId ? `locationId=${locationId}` : ''}`) });
  const fund = useQuery({ queryKey: ['cash-fund', locationId], queryFn: () => api.get<{ balance: string }>(`/api/cash-funds/${locationId}`).catch(() => null), enabled: !!locationId && f.paidFrom === 'PETTY_CASH' });
  const m = useMutation({ mutationFn: () => api.post<{ id: string }>('/api/expenses', { locationId: main ? undefined : locationId, docDate: f.docDate, accountId: f.accountId, payee: f.payee, amount: Number(f.amount), paidFrom: f.paidFrom, paidFromAccountId: f.paidFromAccountId || null, notes: f.notes }), onSuccess: (r) => { setCreated(r.id); setF({ ...f, amount: '', payee: '', notes: '' }); void qc.invalidateQueries({ queryKey: ['expenses'] }); void qc.invalidateQueries({ queryKey: ['cash-fund', locationId] }); } });
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-xl font-semibold">Expenses</h1>{!me!.locationScoped && <Field label="Branch"><Select value={locationId} onChange={(e) => { setLocationId(e.target.value); setMain(false); }}><option value="">—</option>{locations.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>}{can('expense.create.main') && <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={main} onChange={(e) => setMain(e.target.checked)} /> Main / office expenses</label>}</div>
    <Card title="New expense">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Account" className="md:col-span-2"><Select value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}><option value="">—</option>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</Select></Field>
        <Field label="Date"><Input type="date" value={f.docDate} onChange={(e) => setF({ ...f, docDate: e.target.value })} /></Field>
        <Field label="Payee"><Input value={f.payee} onChange={(e) => setF({ ...f, payee: e.target.value })} /></Field>
        <Field label="Amount"><Input type="number" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} data-testid="expense-amount" /></Field>
        <Field label="Paid from"><Select value={f.paidFrom} onChange={(e) => setF({ ...f, paidFrom: e.target.value })}><option value="CASH_DRAWER">Cash drawer</option><option value="PETTY_CASH">Cash fund</option><option value="BANK_ACCOUNT">Bank account</option><option value="OWNER_ADVANCE">Owner advance</option></Select></Field>
        {f.paidFrom === 'PETTY_CASH' && !main && <p className="self-end pb-2 text-xs text-slate-600">Cash fund balance: <b>{fund.data ? peso(fund.data.balance) : '—'}</b> (top it up from cash sales under Cash Fund)</p>}
        {(f.paidFrom === 'BANK_ACCOUNT' || f.paidFrom === 'OWNER_ADVANCE') && <Field label="Paid-from account"><Select value={f.paidFromAccountId} onChange={(e) => setF({ ...f, paidFromAccountId: e.target.value })}><option value="">—</option>{payAccts.data?.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</Select></Field>}
        <Field label="Notes" className="md:col-span-3"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <div className="mt-3 flex items-center gap-3"><Button disabled={!f.accountId || !f.amount || m.isPending} onClick={() => m.mutate()}>Save expense</Button>{created && <span className="text-sm text-emerald-700">Saved. Attach the receipt below.</span>}</div>
      <ErrorBox error={m.error} />
      {created && <div className="mt-3"><Attachments type="ExpenseDoc" id={created} /></div>}
    </Card>
    <DataTable exportName="Expenses" data={list.data ?? []} columns={[{ header: 'Date', accessorKey: 'docDate', cell: (c) => fmtDate(c.getValue()) }, { header: 'Control #', accessorKey: 'controlNo' }, { header: 'Branch', accessorFn: (r) => r.location.name }, { header: 'Account', accessorFn: (r) => r.account.title }, { header: 'Payee', accessorKey: 'payee' }, { header: 'Paid from', accessorKey: 'paidFrom' }, { header: 'Amount', accessorKey: 'amount', cell: (c) => <span className="num block">{peso(c.getValue())}</span> }]} />
  </div>;
}
