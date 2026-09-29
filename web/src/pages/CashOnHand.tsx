import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, fmtDate, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Select, Stat } from '@/components/ui/primitives';

interface Day { businessDate: string; toDeposit: string; deposited: string; outstanding: string; dueDate: string; daysLeft: number; status: 'DEPOSITED' | 'OPEN' | 'DUE_TODAY' | 'OVERDUE'; extension: { status: string; requestedUntil: string; reason: string } | null }
interface Branch { location: { id: string; name: string }; maxDays: number; cashOnHand: string; overdue: number; dueToday: number; days: Day[] }
interface Row { id: string; name: string; maxDays: number; cashOnHand: string; overdue: number; dueToday: number; oldest: string | null }

const TONE = { DEPOSITED: 'green', OPEN: 'blue', DUE_TODAY: 'amber', OVERDUE: 'red' } as const;
const LABEL = { DEPOSITED: 'Deposited', OPEN: 'Not yet due', DUE_TODAY: 'Due today', OVERDUE: 'Overdue' } as const;

/** Cash on hand: each day's cash sales not yet deposited, when each is due, extensions, and (auditors/Admin) every branch. */
export function CashOnHandPage() {
  const { me, can } = useAuth(); const [sp, setSp] = useSearchParams(); const qc = useQueryClient();
  const all = can('cashdeposit.view.all');
  const [locationId, setLocationId] = useState(sp.get('locationId') ?? (all ? '' : me!.locations[0]?.id ?? ''));
  useEffect(() => { if (sp.get('locationId')) setLocationId(sp.get('locationId')!); }, [sp]);
  const branches = useQuery({ queryKey: ['coh-branches'], queryFn: () => api.get<Row[]>('/api/cash-on-hand/branches'), enabled: all });
  const q = useQuery({ queryKey: ['coh', locationId], queryFn: () => api.get<Branch>(`/api/cash-on-hand?locationId=${locationId}`), enabled: !!locationId });
  const [days, setDays] = useState<Record<string, string>>({});
  const setMax = useMutation({ mutationFn: (x: { id: string; maxDays: number }) => api.put(`/api/cash-on-hand/settings/${x.id}`, { maxDays: x.maxDays }), onSuccess: () => { setDays({}); void qc.invalidateQueries({ queryKey: ['coh-branches'] }); void qc.invalidateQueries({ queryKey: ['coh'] }); } });
  const [ext, setExt] = useState<{ day: string; until: string; reason: string } | null>(null);
  const reqExt = useMutation({ mutationFn: () => api.post('/api/cash-on-hand/extensions', { locationId, businessDate: ext!.day, requestedUntil: ext!.until, reason: ext!.reason }), onSuccess: () => { setExt(null); void qc.invalidateQueries({ queryKey: ['coh'] }); } });
  const b = q.data;
  return <div className="space-y-4">
    <h1 className="text-2xl font-bold tracking-tight text-navy">Cash on Hand</h1>
    {all && <Card title="Every branch" actions={<span className="text-xs text-slate-500">Days allowed = how many days after the sales day the cash must be in the bank</span>}>
      {branches.data?.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-2">Branch</th><th className="num">Cash on hand</th><th>Overdue</th><th>Due today</th><th>Oldest undeposited</th><th>Days allowed</th><th /></tr></thead><tbody>{branches.data.map((r) => <tr key={r.id} className={`border-t ${r.id === locationId ? 'bg-brand-soft/40' : ''}`}>
        <td className="py-2 font-medium">{r.name}</td><td className="num">{peso(r.cashOnHand)}</td><td>{r.overdue ? <Badge tone="red">{r.overdue} day(s)</Badge> : '—'}</td><td>{r.dueToday ? <Badge tone="amber">{r.dueToday}</Badge> : '—'}</td><td>{r.oldest ? fmtDate(r.oldest) : '—'}</td>
        <td>{can('cashdeposit.settings') ? <span className="flex items-center gap-1"><Input type="number" min={0} max={30} className="w-16" value={days[r.id] ?? String(r.maxDays)} onChange={(e) => setDays({ ...days, [r.id]: e.target.value })} />{days[r.id] !== undefined && days[r.id] !== String(r.maxDays) && <Button size="sm" onClick={() => setMax.mutate({ id: r.id, maxDays: Number(days[r.id]) })}>Save</Button>}</span> : r.maxDays}</td>
        <td><Button size="sm" variant="outline" onClick={() => { setLocationId(r.id); setSp({ locationId: r.id }); }}>Open</Button></td></tr>)}</tbody></table></div> : <Empty>No branch has cash waiting to be deposited.</Empty>}
      <ErrorBox error={setMax.error} />
    </Card>}
    {b && <>
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label={`Cash on hand — ${b.location.name}`} value={peso(b.cashOnHand)} tone={b.overdue ? 'red' : b.dueToday ? 'amber' : undefined} />
        <Stat label="Overdue days" value={b.overdue} tone={b.overdue ? 'red' : 'green'} />
        <Stat label="Due today" value={b.dueToday} tone={b.dueToday ? 'amber' : undefined} />
        <Stat label="Days allowed to deposit" value={b.maxDays} sub="set by the Head Auditor / Admin" />
      </div>
      <Card title="Sales cash per day">
        {b.days.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-2">Sales day</th><th className="num">To deposit</th><th className="num">Deposited</th><th className="num">Still on hand</th><th>Deposit by</th><th>Status</th><th>Extension</th><th /></tr></thead><tbody>{[...b.days].reverse().map((d) => <tr key={d.businessDate} className="border-t">
          <td className="py-2">{fmtDate(d.businessDate)}</td><td className="num">{peso(d.toDeposit)}</td><td className="num">{peso(d.deposited)}</td><td className="num font-semibold">{peso(d.outstanding)}</td>
          <td>{fmtDate(d.dueDate)}{d.status !== 'DEPOSITED' && <span className={`ml-1 text-xs ${d.daysLeft < 0 ? 'font-bold text-red-700' : 'text-slate-500'}`}>{d.daysLeft < 0 ? `${-d.daysLeft} day(s) late` : d.daysLeft === 0 ? 'today' : `${d.daysLeft} day(s) left`}</span>}</td>
          <td><Badge tone={TONE[d.status]}>{LABEL[d.status]}</Badge></td>
          <td className="text-xs">{d.extension ? <>{d.extension.status === 'PENDING' ? 'Waiting for Head Auditor + Admin' : d.extension.status === 'APPROVED' ? 'Approved' : 'Not approved'} (until {fmtDate(d.extension.requestedUntil)})</> : '—'}</td>
          <td>{d.status !== 'DEPOSITED' && can('sale.create') && d.extension?.status !== 'PENDING' && <Button size="sm" variant="outline" onClick={() => setExt({ day: d.businessDate, until: '', reason: '' })}>Request extension</Button>}</td></tr>)}</tbody></table></div> : <Empty>Nothing to deposit.</Empty>}
        <p className="mt-3 text-xs text-slate-500">Record each bank deposit in <Link className="text-brand underline" to="/closing">Daily Close</Link> for the sales day it covers. When a day is due, the auditors are reminded; past the deadline without an approved extension, HR is notified to issue a Notice to Explain.</p>
      </Card>
      {ext && <Card title={`Request more days to deposit the ${fmtDate(ext.day)} sales`}>
        <div className="grid gap-3 md:grid-cols-3"><Field label="Deposit by (new date)"><Input type="date" min={today()} value={ext.until} onChange={(e) => setExt({ ...ext, until: e.target.value })} /></Field><Field label="Reason" className="md:col-span-2"><Input value={ext.reason} onChange={(e) => setExt({ ...ext, reason: e.target.value })} placeholder="e.g. bank closed for the holiday" /></Field></div>
        <div className="mt-3 flex gap-2"><Button disabled={!ext.until || ext.reason.trim().length < 5 || reqExt.isPending} onClick={() => reqExt.mutate()}>Send to the Head Auditor and Admin</Button><Button variant="ghost" onClick={() => setExt(null)}>Cancel</Button></div>
        <ErrorBox error={reqExt.error} />
      </Card>}
    </>}
    {!locationId && all && <p className="text-sm text-slate-500">Open a branch above to see its days.</p>}
    <ErrorBox error={q.error} />
  </div>;
}

interface Notice { id: string; kind: string; title: string; status: 'OPEN' | 'NTE_ISSUED' | 'REFERRED' | 'CLOSED'; note: string | null; createdAt: string; details: { outstanding?: string; businessDate?: string; dueDate?: string; transferId?: string; items?: string; outcomeLabel?: string; adjustmentForms?: string[]; staffName?: string; role?: string; countIn30Days?: number; recommendReferral?: boolean } | null; staffIds: { id: string; name: string }[] | null }

/** HR: notices that need action, e.g. a Notice to Explain for cash not deposited on time. */
export function HrNoticesPage() {
  const qc = useQueryClient(); const [status, setStatus] = useState('OPEN'); const [notes, setNotes] = useState<Record<string, string>>({});
  const q = useQuery({ queryKey: ['hr-notices', status], queryFn: () => api.get<Notice[]>(`/api/hr-notices${status ? `?status=${status}` : ''}`) });
  const upd = useMutation({ mutationFn: (x: { id: string; status: string }) => api.put(`/api/hr-notices/${x.id}`, { status: x.status, note: notes[x.id] }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['hr-notices'] }) });
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">HR Notices (NTE)</h1><Field label="Show"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="OPEN">Open</option><option value="NTE_ISSUED">NTE issued</option><option value="REFERRED">Referred to the Owner</option><option value="CLOSED">Closed</option><option value="">All</option></Select></Field></div>
    {q.data?.length ? q.data.map((n) => <Card key={n.id} title={<span className="flex items-center gap-2">{n.title}<Badge tone={n.status === 'OPEN' ? 'red' : n.status === 'NTE_ISSUED' || n.status === 'REFERRED' ? 'amber' : 'green'}>{n.status === 'REFERRED' ? 'REFERRED TO OWNER' : n.status.replace('_', ' ')}</Badge>{n.details?.recommendReferral && n.status === 'OPEN' ? <Badge tone="red">{n.details.countIn30Days}× in 30 days: refer to the Owner</Badge> : null}</span>}>
      {n.kind === 'TRANSFER_DISCREPANCY' ? <div className="grid gap-2 text-sm md:grid-cols-4"><div><div className="text-xs uppercase text-slate-500">Difference</div>{n.details?.items}</div><div><div className="text-xs uppercase text-slate-500">Decision</div>{n.details?.outcomeLabel}{n.details?.adjustmentForms?.length ? ` (${n.details.adjustmentForms.join(', ')})` : ''}</div><div><div className="text-xs uppercase text-slate-500">Staff</div>{n.details?.staffName} · {n.details?.role}</div><div><div className="text-xs uppercase text-slate-500">Cases in 30 days</div>{n.details?.countIn30Days}{n.details?.transferId ? <> · <a className="text-brand underline" href={`/transfers/${n.details.transferId}`}>open transfer</a></> : null}</div></div> :
      <div className="grid gap-2 text-sm md:grid-cols-4"><div><div className="text-xs uppercase text-slate-500">Amount not deposited</div>{peso(n.details?.outstanding ?? 0)}</div><div><div className="text-xs uppercase text-slate-500">Sales day</div>{n.details?.businessDate ? fmtDate(n.details.businessDate) : '—'}</div><div><div className="text-xs uppercase text-slate-500">Was due</div>{n.details?.dueDate ? fmtDate(n.details.dueDate) : '—'}</div><div><div className="text-xs uppercase text-slate-500">Staff on duty</div>{n.staffIds?.map((s) => s.name).join(', ') || '—'}</div></div>}
      <div className="mt-3 flex flex-wrap items-end gap-2"><Field label="HR note" className="flex-1"><Input value={notes[n.id] ?? n.note ?? ''} onChange={(e) => setNotes({ ...notes, [n.id]: e.target.value })} placeholder="e.g. NTE served on …, reply received …" /></Field>
        {n.status !== 'NTE_ISSUED' && <Button variant="outline" onClick={() => upd.mutate({ id: n.id, status: 'NTE_ISSUED' })}>Mark NTE issued</Button>}
        {n.status === 'OPEN' && <Button variant={n.details?.recommendReferral ? 'danger' : 'outline'} onClick={() => upd.mutate({ id: n.id, status: 'REFERRED' })}>Refer to the Owner</Button>}
        {n.status !== 'CLOSED' && <Button onClick={() => upd.mutate({ id: n.id, status: 'CLOSED' })}>Close</Button>}
        {n.status === 'CLOSED' && <Button variant="ghost" onClick={() => upd.mutate({ id: n.id, status: 'OPEN' })}>Reopen</Button>}</div>
    </Card>) : <Card><Empty>No notices.</Empty></Card>}
    <ErrorBox error={upd.error} />
  </div>;
}
