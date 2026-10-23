import { locLabel } from '@/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, fmtDate, peso } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Select } from '@/components/ui/primitives';
import { Searchable } from '@/components/Searchable';

interface Fund { id: string; name: string; purpose: string; locationId: string; imprestAmount: string; balance: string; spent: string; lastReplenishedAt: string | null; location: { id: string; name: string; code: string }; lastCheck: { checkedAt: string; countedAmount: string; systemBalance: string; variance: string; reason: string | null } | null }
interface FundDetail extends Fund { txns: { id: string; personName?: string | null; reference?: string | null; drSiNo?: string | null; salesDocId?: string | null; controlNo: string | null; businessDate: string; kind: string; amount: string; balanceAfter: string; notes: string | null; by: string | null; createdAt: string }[]; checks: { id: string; checkedAt: string; countedAmount: string; systemBalance: string; variance: string; reason: string | null; by: string | null }[] }

const KIND: Record<string, string> = { ADVANCE_IN: 'Additional cash fund (advance from)', ADVANCE_OUT: 'Pull-out lent to someone (advance to)', ADVANCE_RETURN: 'Pull-out paid back', SETUP: 'Fund set up', TOP_UP: 'Fund changed', EXPENSE: 'Expense paid from fund', FRANCHISE_RECEIPT: 'Cash received from a franchise (shipping)', EXPENSE_VOID: 'Expense voided (returned)', REPLENISH: 'Replenished from cash sales', ADJUST: 'Adjustment' };

/**
 * Branch cash fund: a fixed amount kept at the branch for small expenses, topped back up from the day's cash sales.
 * Branch staff see and replenish their own fund; Admin, auditors and Accounting see every fund; the Field Auditor counts and confirms it.
 */
export function CashFundPage() {
  const { can, me } = useAuth(); const qc = useQueryClient();
  const list = useQuery({ queryKey: ['cash-funds'], queryFn: () => api.get<Fund[]>('/api/cash-funds') });
  const [sel, setSel] = useState<string>('');
  const locationId = sel || (list.data?.length === 1 ? list.data[0].id : '');
  const detail = useQuery({ queryKey: ['cash-fund', locationId], queryFn: () => api.get<FundDetail>(`/api/cash-funds/${locationId}`), enabled: !!locationId });
  const inv = () => { void qc.invalidateQueries({ queryKey: ['cash-funds'] }); void qc.invalidateQueries({ queryKey: ['cash-fund', locationId] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); };
  const replenish = useMutation({ mutationFn: (amount?: number) => api.post(`/api/cash-funds/${locationId}/replenish`, amount ? { amount } : {}), onSuccess: inv });
  const [check, setCheck] = useState({ countedAmount: '', reason: '' });
  const doCheck = useMutation({ mutationFn: () => api.post(`/api/cash-funds/${locationId}/check`, { countedAmount: Number(check.countedAmount), reason: check.reason || undefined }), onSuccess: () => { setCheck({ countedAmount: '', reason: '' }); inv(); } });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; type: string }[]>('/api/locations'), enabled: can('cashfund.manage') });
  const [setup, setSetup] = useState({ locationId: '', imprestAmount: '', purpose: '' });
  const doSetup = useMutation({ mutationFn: () => api.put(`/api/cash-funds/${setup.locationId}`, { imprestAmount: Number(setup.imprestAmount), ...(setup.purpose ? { purpose: setup.purpose } : {}) }), onSuccess: () => { setSetup({ locationId: '', imprestAmount: '', purpose: '' }); inv(); } });
  const d = detail.data;
  const variance = check.countedAmount !== '' && d ? Number(check.countedAmount) - Number(d.balance) : 0;
  return <div className="space-y-4">
    <h1 className="text-2xl font-bold tracking-tight text-navy">Petty Cash Fund</h1>
    {(list.data?.length ?? 0) > 1 && <Card title="All cash funds"><Searchable><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Fund</th><th className="num">Amount</th><th className="num">Balance</th><th className="num">Spent</th><th>Last replenished</th><th>Last store check</th></tr></thead>
      <tbody>{list.data!.map((f) => <tr key={f.id} className={`cursor-pointer border-t hover:bg-slate-50 ${locationId === f.id ? 'bg-slate-50' : ''}`} onClick={() => setSel(f.id)}><td className="py-1">{f.name}{f.purpose !== 'GENERAL' && <span className="ml-1 text-xs text-slate-500">({f.location.name})</span>}</td><td className="num">{peso(f.imprestAmount)}</td><td className={`num font-medium ${Number(f.balance) < Number(f.imprestAmount) * 0.3 ? 'text-red-700' : ''}`}>{peso(f.balance)}</td><td className="num">{peso(f.spent)}</td><td className="text-xs">{f.lastReplenishedAt ? new Date(f.lastReplenishedAt).toLocaleDateString() : '—'}</td><td className="text-xs">{f.lastCheck ? <>{new Date(f.lastCheck.checkedAt).toLocaleDateString()} {Number(f.lastCheck.variance) ? <span className="font-semibold text-red-700">{peso(f.lastCheck.variance)}</span> : <span className="text-emerald-700">matched</span>}</> : '—'}</td></tr>)}</tbody></table></Searchable></Card>}
    {!list.data?.length && <Empty>No cash fund set up{me?.locationScoped ? ' for your branch yet — ask Admin or the Accounting Head' : ''}.</Empty>}
    {d && <>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={d.name}>
          <div className="text-3xl font-semibold">{peso(d.balance)}</div>
          <div className="text-sm text-slate-500">of {peso(d.imprestAmount)} · spent {peso(d.spent)} to replenish</div>
          {can('cashfund.use') && d.purpose === 'GENERAL' && Number(d.spent) > 0 && <Button className="mt-3" disabled={replenish.isPending} onClick={() => replenish.mutate(undefined)}>Replenish {peso(d.spent)} from today's cash sales</Button>}
          {d.purpose === 'GENERAL' && Number(d.spent) > 0 && can('cashfund.use') && <p className="mt-1 text-xs text-slate-500">This comes out of today's cash for deposit (Daily Close and the Daily Sales Report show it).</p>}
          {d.purpose !== 'GENERAL' && <p className="mt-2 text-xs text-slate-500">{d.purpose === 'FRANCHISE' ? 'Fills up when a franchise pays the shipping in cash, and when Accounting tops it up.' : 'The warehouse has no cash sales: Accounting tops this fund up from the bank.'} Used by the Warehouse Associate and In-Charge.</p>}
          {can('cashfund.manage') && <TopUp fundId={d.id} onDone={inv} />}
          <ErrorBox error={replenish.error} />
        </Card>
        {can('cashfund.check') && <Card title="Confirm cash fund found in the store">
          <Field label="Cash counted (₱)"><Input type="number" step="0.01" value={check.countedAmount} onChange={(e) => setCheck({ ...check, countedAmount: e.target.value })} /></Field>
          {check.countedAmount !== '' && <p className={`mt-1 text-sm ${variance ? 'font-semibold text-red-700' : 'text-emerald-700'}`}>{variance ? `Difference ${peso(variance)} vs system ${peso(d.balance)}` : 'Matches the system balance'}</p>}
          {variance !== 0 && <Field label="Reason for lacking / difference"><Input value={check.reason} onChange={(e) => setCheck({ ...check, reason: e.target.value })} /></Field>}
          <Button className="mt-2" disabled={check.countedAmount === '' || (variance !== 0 && !check.reason) || doCheck.isPending} onClick={() => doCheck.mutate()}>Confirm count</Button>
          <ErrorBox error={doCheck.error} />
        </Card>}
        <Card title="Store checks">{!d.checks.length ? <Empty>No checks yet.</Empty> : <ul className="divide-y text-xs">{d.checks.map((c) => <li key={c.id} className="py-1">{new Date(c.checkedAt).toLocaleString()} · {c.by} · counted {peso(c.countedAmount)} {Number(c.variance) ? <b className="text-red-700">({peso(c.variance)}{c.reason ? `: ${c.reason}` : ''})</b> : <span className="text-emerald-700">(matched)</span>}</li>)}</ul>}</Card>
      </div>
      {(can('cashfund.spend') || can('cashfund.manage')) && <AdvanceCard fundId={d.id} onDone={inv} />}
      <FundReport fundId={d.id} name={d.name} />
      <Card title="Movements"><Searchable><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Date</th><th>What</th><th>Voucher</th><th className="num">Amount</th><th className="num">Balance</th><th>By</th></tr></thead>
        <tbody>{d.txns.map((t) => <tr key={t.id} className="border-t"><td className="py-1">{fmtDate(t.businessDate)}</td><td>{KIND[t.kind] ?? t.kind}{t.notes ? <span className="text-xs text-slate-500"> — {t.notes}</span> : null}</td><td>{t.drSiNo ? <span className="mr-1 rounded bg-amber-50 px-1 text-xs text-amber-800">DR {t.drSiNo}</span> : null}{t.controlNo ? <button className="text-brand underline" onClick={() => api.download(`/api/reports/forms/fund-replenishment/${t.id}.pdf`, `${t.controlNo}.pdf`)}>{t.controlNo}</button> : ''}</td><td className={`num ${Number(t.amount) < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{peso(t.amount)}</td><td className="num">{peso(t.balanceAfter)}</td><td className="text-xs">{t.by ?? 'system'}</td></tr>)}</tbody></table></Searchable></Card>
    </>}
    {can('cashfund.manage') && <Card title="Set up or change a cash fund">
      <div className="flex flex-wrap items-end gap-2"><Field label="Branch"><Select value={setup.locationId} onChange={(e) => setSetup({ ...setup, locationId: e.target.value })}><option value="">—</option>{locations.data?.filter((l) => ['BRANCH', 'WAREHOUSE', 'OFFICE'].includes(l.type)).map((l) => <option key={l.id} value={l.id}>{locLabel(l)}</option>)}</Select></Field><Field label="Kind of fund"><Select value={setup.purpose} onChange={(e) => setSetup({ ...setup, purpose: e.target.value })}><option value="">Automatic (branch fund · warehouse Office)</option><option value="GENERAL">Branch cash fund</option><option value="OFFICE">Warehouse – Office</option><option value="FRANCHISE">Warehouse – Franchise (franchise DR shipping)</option></Select></Field><Field label="Fund amount (₱)"><Input type="number" value={setup.imprestAmount} onChange={(e) => setSetup({ ...setup, imprestAmount: e.target.value })} /></Field><Button disabled={!setup.locationId || !setup.imprestAmount} onClick={() => doSetup.mutate()}>Save</Button><Badge>the balance moves by the change</Badge></div>
      <ErrorBox error={doSetup.error} />
    </Card>}
  </div>;
}

/** Accounting adds money to a fund from a bank / cash account (the warehouse funds have no cash sales to replenish them). */
function TopUp({ fundId, onDone }: { fundId: string; onDone: () => void }) {
  const [amount, setAmount] = useState(''); const [from, setFrom] = useState('');
  const accts = useQuery({ queryKey: ['payment-accounts-all'], queryFn: () => api.get<{ id: string; title: string }[]>('/api/accounts/payment') });
  const m = useMutation({ mutationFn: () => api.post(`/api/cash-funds/${fundId}/top-up`, { amount: Number(amount), fromAccountId: from }), onSuccess: () => { setAmount(''); onDone(); } });
  return <div className="mt-3 border-t pt-3"><div className="text-xs font-semibold text-slate-600">Top up from an account</div><div className="mt-1 flex flex-wrap items-end gap-2"><Field label="From"><Select value={from} onChange={(e) => setFrom(e.target.value)}><option value="">—</option>{(accts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</Select></Field><Field label="Amount ₱"><Input className="w-28" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field><Button size="sm" disabled={!from || !Number(amount) || m.isPending} onClick={() => m.mutate()}>Top up</Button></div><ErrorBox error={m.error} /></div>;
}

type Acct = { id: string; code: string; title: string };
/** More cash into the fund from "Advances from …" (e.g. Advances from AMV), cash lent out as "Advances to …", and its repayment (owner request 2026-10-23). */
function AdvanceCard({ fundId, onDone }: { fundId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const accts = useQuery({ queryKey: ['advance-accounts'], queryFn: () => api.get<{ from: Acct[]; to: Acct[] }>('/api/cash-funds/advance-accounts') });
  const open = useQuery({ queryKey: ['fund-advances', fundId], queryFn: () => api.get<{ counterAccountId: string; account: string; code: string; personName: string; lent: string; returned: string; outstanding: string; since: string }[]>(`/api/cash-funds/${fundId}/advances`) });
  const [kind, setKind] = useState<'IN' | 'OUT' | 'RETURN'>('IN'); const [f, setF] = useState({ account: '', person: '', amount: '', reference: '', notes: '', date: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10) });
  const list = kind === 'IN' ? accts.data?.from : accts.data?.to;
  const m = useMutation({ mutationFn: () => api.post(`/api/cash-funds/${fundId}/advance`, { kind, amount: Number(f.amount), counterAccountId: f.account, personName: f.person || null, reference: f.reference || null, notes: f.notes || null, date: f.date }), onSuccess: () => { setF({ ...f, amount: '', person: '', reference: '', notes: '' }); void qc.invalidateQueries({ queryKey: ['fund-advances', fundId] }); onDone(); } });
  const KINDS: [typeof kind, string, string][] = [['IN', 'Additional cash fund', 'Cash put into the fund from an "Advances from" account (for example Advances from AMV)'], ['OUT', 'Pull-out (to be returned)', 'Cash taken out and borrowed by someone: it is an "Advances to" that must be returned'], ['RETURN', 'Paid back', 'The borrowed cash is returned to the fund: choose the same "Advances to" account']];
  return <Card title="Additional cash and pull-outs">
    <div className="mb-3 flex flex-wrap gap-2">{KINDS.map(([k, l]) => <button key={k} type="button" className={`rounded-full px-3 py-1.5 text-sm font-semibold ${kind === k ? 'grad-brand text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`} onClick={() => { setKind(k); setF({ ...f, account: '' }); }}>{l}</button>)}</div>
    <p className="mb-3 text-xs text-slate-500">{KINDS.find((x) => x[0] === kind)![2]}.</p>
    <div className="grid gap-3 md:grid-cols-3">
      <Field label={kind === 'IN' ? 'Advances from (where the cash comes from)' : 'Advances to (account)'}><Select value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })}><option value="">—</option>{(list ?? []).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.title}</option>)}</Select></Field>
      {kind !== 'IN' && <Field label={kind === 'OUT' ? 'Who borrowed it' : 'Who paid it back'}><Input value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })} list="adv-people" />{kind === 'RETURN' && <datalist id="adv-people">{(open.data ?? []).map((o) => <option key={o.counterAccountId + o.personName} value={o.personName} />)}</datalist>}</Field>}
      <Field label="Amount ₱"><Input type="number" step="0.01" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
      <Field label="Date"><Input type="date" value={f.date} max={new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label="Reference (e.g. CF #)"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
      <Field label="Remarks"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. CASH FUND PULLOUT TO AMV SALES" /></Field>
    </div>
    <ErrorBox error={m.error} />
    <div className="mt-3"><Button disabled={!f.account || !Number(f.amount) || (kind !== 'IN' && !f.person.trim()) || m.isPending} onClick={() => m.mutate()}>{kind === 'IN' ? 'Add cash to the fund' : kind === 'OUT' ? 'Record the pull-out' : 'Record the payment back'}</Button></div>
    {(open.data ?? []).length > 0 && <div className="mt-4"><div className="mb-1 text-sm font-semibold text-navy">Pull-outs not yet returned</div>
      <table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Who</th><th>Advances to</th><th>Since</th><th className="num">Lent</th><th className="num">Returned</th><th className="num">Still to return</th><th /></tr></thead><tbody>{open.data!.map((o) => <tr key={o.counterAccountId + o.personName} className="border-t"><td className="py-1 font-medium">{o.personName}</td><td>{o.code} · {o.account}</td><td>{fmtDate(o.since)}</td><td className="num">{peso(o.lent)}</td><td className="num">{peso(o.returned)}</td><td className="num font-semibold text-amber-700">{peso(o.outstanding)}</td><td><button className="text-xs font-semibold text-brand underline" onClick={() => { setKind('RETURN'); setF({ ...f, account: o.counterAccountId, person: o.personName, amount: o.outstanding }); }}>Paid back</button></td></tr>)}</tbody></table></div>}
  </Card>;
}

/** The cash fund ledger in the company's voucher format, in Excel or PDF (owner request 2026-10-23). */
function FundReport({ fundId, name }: { fundId: string; name: string }) {
  const first = new Date(Date.now() + 8 * 3600e3); first.setUTCDate(1);
  const [from, setFrom] = useState(first.toISOString().slice(0, 10)); const [to, setTo] = useState(new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)); const [err, setErr] = useState<string | null>(null);
  const get = (ext: 'xlsx' | 'pdf') => api.download(`/api/cash-funds/${fundId}/report.${ext}?from=${from}&to=${to}`, `${name.replace(/[^A-Za-z0-9]+/g, '-')}-${from}-to-${to}.${ext}`).catch((e: Error) => setErr(e.message));
  return <Card title="Cash fund report (voucher format)">
    <div className="flex flex-wrap items-end gap-2"><Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field><Button onClick={() => get('xlsx')}>Excel</Button><Button variant="outline" onClick={() => get('pdf')}>PDF</Button></div>
    <p className="mt-2 text-xs text-slate-500">One voucher number per day; each movement has two lines (the expense or advance account and Petty Cash) with the person, the account code and the debit and credit.</p>
    {err && <p className="mt-1 text-sm text-red-700">{err}</p>}
  </Card>;
}
