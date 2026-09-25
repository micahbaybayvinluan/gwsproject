import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, fmtDate, peso } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Select } from '@/components/ui/primitives';

interface Fund { id: string; locationId: string; imprestAmount: string; balance: string; spent: string; lastReplenishedAt: string | null; location: { id: string; name: string; code: string }; lastCheck: { checkedAt: string; countedAmount: string; systemBalance: string; variance: string; reason: string | null } | null }
interface FundDetail extends Fund { txns: { id: string; controlNo: string | null; businessDate: string; kind: string; amount: string; balanceAfter: string; notes: string | null; by: string | null; createdAt: string }[]; checks: { id: string; checkedAt: string; countedAmount: string; systemBalance: string; variance: string; reason: string | null; by: string | null }[] }

const KIND: Record<string, string> = { SETUP: 'Fund set up', TOP_UP: 'Fund changed', EXPENSE: 'Expense paid from fund', EXPENSE_VOID: 'Expense voided (returned)', REPLENISH: 'Replenished from cash sales', ADJUST: 'Adjustment' };

/**
 * Branch cash fund: a fixed amount kept at the branch for small expenses, topped back up from the day's cash sales.
 * Branch staff see and replenish their own fund; Admin, auditors and Accounting see every fund; the Field Auditor counts and confirms it.
 */
export function CashFundPage() {
  const { can, me } = useAuth(); const qc = useQueryClient();
  const list = useQuery({ queryKey: ['cash-funds'], queryFn: () => api.get<Fund[]>('/api/cash-funds') });
  const [sel, setSel] = useState<string>('');
  const locationId = sel || (list.data?.length === 1 ? list.data[0].locationId : '');
  const detail = useQuery({ queryKey: ['cash-fund', locationId], queryFn: () => api.get<FundDetail>(`/api/cash-funds/${locationId}`), enabled: !!locationId });
  const inv = () => { void qc.invalidateQueries({ queryKey: ['cash-funds'] }); void qc.invalidateQueries({ queryKey: ['cash-fund', locationId] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); };
  const replenish = useMutation({ mutationFn: (amount?: number) => api.post(`/api/cash-funds/${locationId}/replenish`, amount ? { amount } : {}), onSuccess: inv });
  const [check, setCheck] = useState({ countedAmount: '', reason: '' });
  const doCheck = useMutation({ mutationFn: () => api.post(`/api/cash-funds/${locationId}/check`, { countedAmount: Number(check.countedAmount), reason: check.reason || undefined }), onSuccess: () => { setCheck({ countedAmount: '', reason: '' }); inv(); } });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; type: string }[]>('/api/locations'), enabled: can('cashfund.manage') });
  const [setup, setSetup] = useState({ locationId: '', imprestAmount: '' });
  const doSetup = useMutation({ mutationFn: () => api.put(`/api/cash-funds/${setup.locationId}`, { imprestAmount: Number(setup.imprestAmount) }), onSuccess: () => { setSetup({ locationId: '', imprestAmount: '' }); inv(); } });
  const d = detail.data;
  const variance = check.countedAmount !== '' && d ? Number(check.countedAmount) - Number(d.balance) : 0;
  return <div className="space-y-4">
    <h1 className="text-xl font-semibold">Cash fund</h1>
    {(list.data?.length ?? 0) > 1 && <Card title="All branch funds"><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Branch</th><th className="num">Fund</th><th className="num">Balance</th><th className="num">Spent</th><th>Last replenished</th><th>Last store check</th></tr></thead>
      <tbody>{list.data!.map((f) => <tr key={f.id} className={`cursor-pointer border-t hover:bg-slate-50 ${locationId === f.locationId ? 'bg-slate-50' : ''}`} onClick={() => setSel(f.locationId)}><td className="py-1">{f.location.name}</td><td className="num">{peso(f.imprestAmount)}</td><td className={`num font-medium ${Number(f.balance) < Number(f.imprestAmount) * 0.3 ? 'text-red-700' : ''}`}>{peso(f.balance)}</td><td className="num">{peso(f.spent)}</td><td className="text-xs">{f.lastReplenishedAt ? new Date(f.lastReplenishedAt).toLocaleDateString() : '—'}</td><td className="text-xs">{f.lastCheck ? <>{new Date(f.lastCheck.checkedAt).toLocaleDateString()} {Number(f.lastCheck.variance) ? <span className="font-semibold text-red-700">{peso(f.lastCheck.variance)}</span> : <span className="text-emerald-700">matched</span>}</> : '—'}</td></tr>)}</tbody></table></Card>}
    {!list.data?.length && <Empty>No cash fund set up{me?.locationScoped ? ' for your branch yet — ask Admin or the Accounting Head' : ''}.</Empty>}
    {d && <>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={`${d.location.name} fund`}>
          <div className="text-3xl font-semibold">{peso(d.balance)}</div>
          <div className="text-sm text-slate-500">of {peso(d.imprestAmount)} · spent {peso(d.spent)} to replenish</div>
          {can('cashfund.use') && Number(d.spent) > 0 && <Button className="mt-3" disabled={replenish.isPending} onClick={() => replenish.mutate(undefined)}>Replenish {peso(d.spent)} from today's cash sales</Button>}
          {Number(d.spent) > 0 && can('cashfund.use') && <p className="mt-1 text-xs text-slate-500">This comes out of today's cash for deposit (Daily Close and the Daily Sales Report show it).</p>}
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
      <Card title="Movements"><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Date</th><th>What</th><th>Voucher</th><th className="num">Amount</th><th className="num">Balance</th><th>By</th></tr></thead>
        <tbody>{d.txns.map((t) => <tr key={t.id} className="border-t"><td className="py-1">{fmtDate(t.businessDate)}</td><td>{KIND[t.kind] ?? t.kind}{t.notes ? <span className="text-xs text-slate-500"> — {t.notes}</span> : null}</td><td>{t.controlNo ? <button className="text-brand underline" onClick={() => api.download(`/api/reports/forms/fund-replenishment/${t.id}.pdf`, `${t.controlNo}.pdf`)}>{t.controlNo}</button> : ''}</td><td className={`num ${Number(t.amount) < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{peso(t.amount)}</td><td className="num">{peso(t.balanceAfter)}</td><td className="text-xs">{t.by ?? 'system'}</td></tr>)}</tbody></table></Card>
    </>}
    {can('cashfund.manage') && <Card title="Set up or change a branch fund">
      <div className="flex flex-wrap items-end gap-2"><Field label="Branch"><Select value={setup.locationId} onChange={(e) => setSetup({ ...setup, locationId: e.target.value })}><option value="">—</option>{locations.data?.filter((l) => ['BRANCH', 'WAREHOUSE', 'OFFICE'].includes(l.type)).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field><Field label="Fund amount (₱)"><Input type="number" value={setup.imprestAmount} onChange={(e) => setSetup({ ...setup, imprestAmount: e.target.value })} /></Field><Button disabled={!setup.locationId || !setup.imprestAmount} onClick={() => doSetup.mutate()}>Save</Button><Badge>the balance moves by the change</Badge></div>
      <ErrorBox error={doSetup.error} />
    </Card>}
  </div>;
}
