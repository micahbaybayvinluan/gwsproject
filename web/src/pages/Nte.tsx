import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, fmtDate } from '@/lib/api';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, Select } from '@/components/ui/primitives';
import { Searchable } from '@/components/Searchable';
import { personLabel } from '@/lib/utils';

export interface Nte { id: string; nteNo: string | null; employeeId: string; employeeName: string; subject: string; details: string; issuedOn: string; replyDueOn: string; incidentDate: string | null; status: 'DRAFT' | 'ISSUED' | 'REPLIED' | 'DECIDED' | 'VOIDED'; reply: string | null; repliedOn: string | null; decision: string | null; decisionNote: string | null; voidReason: string | null }
const DECISIONS: [string, string][] = [['NO_ACTION', 'No action (explanation accepted)'], ['WARNING', 'Written warning'], ['SUSPENSION', 'Suspension'], ['CHARGE', 'Charge / salary deduction'], ['OTHER', 'Other']];
const tone = (s: string) => (s === 'DRAFT' ? 'slate' : s === 'ISSUED' ? 'amber' : s === 'REPLIED' ? 'blue' : s === 'DECIDED' ? 'green' : 'red') as 'amber' | 'blue' | 'green' | 'red' | 'slate';
const textarea = 'min-h-24 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-inset focus:outline-none focus:ring-2 focus:ring-brand/30';

/** HR: write a Notice to Explain to one employee (owner request 2026-10-16). */
export function NewNteModal({ onClose, employeeId, subject, details, noticeId, userIds }: { onClose: () => void; employeeId?: string; subject?: string; details?: string; noticeId?: string; userIds?: string[] }) {
  const qc = useQueryClient();
  const emps = useQuery({ queryKey: ['employees-pick'], queryFn: () => api.get<{ id: string; fullName: string; employeeNo: string; position: string | null; userId: string | null; location: { name: string } | null }[]>('/api/payroll/employees') });
  const [emp, setEmp] = useState(employeeId ?? ''); const [subj, setSubj] = useState(subject ?? ''); const [det, setDet] = useState(details ?? ''); const [incident, setIncident] = useState(''); const [due, setDue] = useState('');
  const save = useMutation({
    mutationFn: () => noticeId ? api.post(`/api/hr-notices/${noticeId}/issue-nte`, { userIds, employeeIds: emp ? [emp] : undefined, details: det || undefined, replyDueOn: due || null }) : api.post('/api/ntes', { employeeId: emp, subject: subj, details: det, incidentDate: incident || null, replyDueOn: due || null }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['ntes'] }); void qc.invalidateQueries({ queryKey: ['hr-notices'] }); onClose(); },
  });
  return <Modal title="Notice to Explain (NTE)" onClose={onClose} wide>
    <div className="space-y-3">
      {!noticeId && <Field label="Employee"><Select value={emp} onChange={(e) => setEmp(e.target.value)} data-testid="nte-employee"><option value="">Choose the employee…</option>{emps.data?.map((e) => <option key={e.id} value={e.id}>{e.fullName} · {e.employeeNo}{e.position ? ` · ${e.position}` : ''}{e.location ? ` · ${e.location.name}` : ''}</option>)}</Select></Field>}
      {!noticeId && <Field label="Subject (what it is about)"><Input value={subj} onChange={(e) => setSubj(e.target.value)} placeholder="e.g. Late deposit of the cash sales of 10 Oct" /></Field>}
      <Field label={noticeId ? 'What the NTE says (leave blank to use the notice details)' : 'What happened (the facts the employee must explain)'}><textarea className={textarea} value={det} onChange={(e) => setDet(e.target.value)} placeholder="Date, place, amount, the rule or policy concerned…" /></Field>
      <div className="grid gap-3 md:grid-cols-2">{!noticeId && <Field label="Date it happened (optional)"><Input type="date" value={incident} onChange={(e) => setIncident(e.target.value)} /></Field>}<Field label="Reply due by (default 5 days)"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field></div>
      <ErrorBox error={save.error} />
      <div className="flex gap-2"><Button disabled={save.isPending || (!noticeId && (!emp || subj.trim().length < 3 || det.trim().length < 5))} onClick={() => save.mutate()} data-testid="nte-issue">Issue the NTE</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
    </div>
  </Modal>;
}

/** The employee's reply box (My Pay & Charges) or HR typing the reply received on paper. */
function ReplyBox({ nte, onDone }: { nte: Nte; onDone: () => void }) {
  const [text, setText] = useState(''); const save = useMutation({ mutationFn: () => api.post(`/api/ntes/${nte.id}/reply`, { reply: text }), onSuccess: () => { setText(''); onDone(); } });
  return <div className="mt-2 space-y-2"><textarea className={textarea} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type the explanation here" /><ErrorBox error={save.error} /><Button size="sm" disabled={save.isPending || text.trim().length < 3} onClick={() => save.mutate()}>Send the reply</Button></div>;
}

/** HR: the list of NTEs with reply, decision, print and cancel. */
export function NtePanel() {
  const qc = useQueryClient(); const [status, setStatus] = useState(''); const [open, setOpen] = useState(false); const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['ntes', status], queryFn: () => api.get<Nte[]>(`/api/ntes${status ? `?status=${status}` : ''}`) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['ntes'] });
  const [dec, setDec] = useState<Record<string, { decision: string; note: string }>>({});
  const decide = useMutation({ mutationFn: (id: string) => api.post(`/api/ntes/${id}/decision`, dec[id] ?? { decision: 'NO_ACTION' }), onSuccess: refresh });
  const voidIt = useMutation({ mutationFn: (id: string) => api.post(`/api/ntes/${id}/void`, { reason }), onSuccess: () => { setReason(''); refresh(); } });
  return <div className="space-y-3">
    <div className="flex flex-wrap items-end gap-2"><Field label="Show"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="ISSUED">Waiting for the reply</option><option value="REPLIED">Replied: needs a decision</option><option value="DECIDED">Decided</option><option value="VOIDED">Cancelled</option></Select></Field><Button className="ml-auto" onClick={() => setOpen(true)} data-testid="new-nte">+ Issue an NTE to an employee</Button></div>
    {open && <NewNteModal onClose={() => setOpen(false)} />}
    <Searchable>{q.data?.length ? q.data.map((n) => <Card key={n.id} title={<span className="flex flex-wrap items-center gap-2"><span className="font-mono text-sm">{n.nteNo}</span>{n.employeeName}<Badge tone={tone(n.status)}>{n.status === 'ISSUED' ? 'WAITING FOR REPLY' : n.status}</Badge></span>}>
      <div className="text-sm"><b>{n.subject}</b><p className="mt-1 whitespace-pre-line text-slate-700">{n.details}</p><p className="mt-1 text-xs text-slate-500">Issued {fmtDate(n.issuedOn)} · reply due {fmtDate(n.replyDueOn)}{n.incidentDate ? ` · happened ${fmtDate(n.incidentDate)}` : ''}</p></div>
      {n.reply && <div className="mt-2 rounded-xl bg-slate-50 p-2 text-sm"><div className="text-xs font-semibold uppercase text-slate-500">Employee's reply{n.repliedOn ? ` (${fmtDate(n.repliedOn)})` : ''}</div><p className="whitespace-pre-line">{n.reply}</p></div>}
      {n.decision && <div className="mt-2 rounded-xl bg-emerald-50 p-2 text-sm"><b>Decision: {DECISIONS.find(([k]) => k === n.decision)?.[1] ?? n.decision}</b>{n.decisionNote ? ` — ${n.decisionNote}` : ''}</div>}
      {n.status === 'VOIDED' && <p className="mt-2 text-sm text-red-700">Cancelled: {n.voidReason}</p>}
      {n.status === 'ISSUED' && <details className="mt-2"><summary className="cursor-pointer text-sm font-semibold text-brand">Type the reply received on paper</summary><ReplyBox nte={n} onDone={refresh} /></details>}
      {(n.status === 'REPLIED' || n.status === 'ISSUED') && <div className="mt-3 flex flex-wrap items-end gap-2"><Field label="HR decision"><Select value={dec[n.id]?.decision ?? 'NO_ACTION'} onChange={(e) => setDec({ ...dec, [n.id]: { decision: e.target.value, note: dec[n.id]?.note ?? '' } })}>{DECISIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field><Field label="Note" className="flex-1"><Input value={dec[n.id]?.note ?? ''} onChange={(e) => setDec({ ...dec, [n.id]: { decision: dec[n.id]?.decision ?? 'NO_ACTION', note: e.target.value } })} /></Field><Button onClick={() => decide.mutate(n.id)}>Record the decision</Button></div>}
      <div className="mt-3 flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" onClick={() => api.download(`/api/ntes/${n.id}/pdf`, `${n.nteNo}.pdf`)}>Print the NTE (PDF)</Button>
        {n.status !== 'VOIDED' && <><Input className="w-56" placeholder="Reason to cancel" value={reason} onChange={(e) => setReason(e.target.value)} /><Button size="sm" variant="ghost" disabled={reason.trim().length < 3} onClick={() => voidIt.mutate(n.id)}>Cancel this NTE</Button></>}</div>
    </Card>) : <Card><Empty>No NTEs yet. Issue one from an HR notice, or press “Issue an NTE to an employee”.</Empty></Card>}</Searchable>
    <ErrorBox error={decide.error ?? voidIt.error} />
  </div>;
}

/** My Pay & Charges: the employee reads their NTEs, prints them and types the explanation. */
export function MyNtes() {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['my-ntes'], queryFn: () => api.get<Nte[]>('/api/me/ntes') });
  if (!q.data?.length) return null;
  return <Card title="Notice to Explain (NTE)">
    <div className="space-y-3">{q.data.map((n) => <div key={n.id} className="rounded-xl border p-3 text-sm" data-testid="my-nte">
      <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs">{n.nteNo}</span><b>{n.subject}</b><Badge tone={tone(n.status)}>{n.status === 'ISSUED' ? 'PLEASE EXPLAIN' : n.status}</Badge></div>
      <p className="mt-1 whitespace-pre-line text-slate-700">{n.details}</p><p className="text-xs text-slate-500">Issued {fmtDate(n.issuedOn)} · please explain by {fmtDate(n.replyDueOn)}</p>
      {n.reply && <p className="mt-1 rounded-lg bg-slate-50 p-2">Your reply: {n.reply}</p>}{n.decision && <p className="mt-1 font-semibold">Decision: {DECISIONS.find(([k]) => k === n.decision)?.[1] ?? n.decision}{n.decisionNote ? ` — ${n.decisionNote}` : ''}</p>}
      {n.status === 'ISSUED' && <ReplyBox nte={n} onDone={() => void qc.invalidateQueries({ queryKey: ['my-ntes'] })} />}
      <Button className="mt-2" size="sm" variant="outline" onClick={() => api.download(`/api/ntes/${n.id}/pdf`, `${n.nteNo}.pdf`)}>Print</Button>
    </div>)}</div>
  </Card>;
}


/**
 * Create the NTE for an HR notice (owner request 2026-10-19): the people the notice names (name and position), their drafts already prefilled,
 * and one button to issue. Opened from the Notifications page, the HR dashboard and HR Notices.
 */
export function NteNoticeModal({ noticeId, onClose }: { noticeId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notice-people', noticeId], queryFn: () => api.get<{ notice: { id: string; kind: string; title: string; status: string; details: Record<string, unknown> | null }; people: { userId: string; name: string; employeeId: string | null; position: string | null }[]; defaultText: string; ntes: Nte[] }>(`/api/hr-notices/${noticeId}/people`) });
  const [pick, setPick] = useState<string[] | null>(null); const [text, setText] = useState<string | null>(null); const [due, setDue] = useState('');
  const d = q.data;
  const drafts = d?.ntes.filter((n) => n.status === 'DRAFT') ?? []; const issued = d?.ntes.filter((n) => n.status !== 'DRAFT' && n.status !== 'VOIDED') ?? [];
  const people = d?.people ?? []; const chosen = pick ?? (drafts.length ? people.filter((p) => drafts.some((x) => (x as unknown as { employeeId: string }).employeeId === p.employeeId)).map((p) => p.userId) : people.length === 1 ? [people[0].userId] : []);
  const words = text ?? drafts[0]?.details ?? d?.defaultText ?? '';
  const go = useMutation({ mutationFn: () => api.post(`/api/hr-notices/${noticeId}/issue-nte`, { userIds: chosen, details: words, replyDueOn: due || null }), onSuccess: () => { void qc.invalidateQueries(); onClose(); } });
  return <Modal title={`Notice to Explain: ${d?.notice.title ?? ''}`} onClose={onClose} wide>
    {!d ? <p className="text-sm text-slate-500">{q.error ? (q.error as Error).message : 'Loading…'}</p> : <div className="space-y-3" data-testid="nte-notice-modal">
      {issued.length > 0 && <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">Already issued: {issued.map((n) => `${n.nteNo} (${n.employeeName})`).join(', ')}.</p>}
      <div><div className="mb-1 text-xs font-semibold uppercase text-slate-500">Who must explain</div>
        {people.length ? <div className="space-y-1">{people.map((p) => <label key={p.userId} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!p.employeeId} checked={chosen.includes(p.userId)} onChange={(e) => setPick(e.target.checked ? [...chosen, p.userId] : chosen.filter((x) => x !== p.userId))} />{personLabel(p)}{!p.employeeId && <span className="text-xs text-red-700"> no employee record: add them under Payroll first</span>}{drafts.some((x) => (x as unknown as { employeeId: string }).employeeId === p.employeeId) && <Badge tone="slate">draft ready</Badge>}</label>)}</div> : <p className="text-sm text-slate-500">The notice names nobody: use "Issue an NTE to an employee" in NTEs issued.</p>}
        {d.notice.details && (d.notice.details as { ambiguous?: boolean }).ambiguous && <p className="mt-1 text-xs text-amber-800">The system could not tell who was involved, so it lists everyone concerned: tick only those who must explain.</p>}</div>
      <Field label="What the NTE says (you may change it)"><textarea className={textarea} value={words} onChange={(e) => setText(e.target.value)} /></Field>
      <Field label="Reply due by (default 5 days)"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      <ErrorBox error={go.error} />
      <div className="flex gap-2"><Button disabled={go.isPending || !chosen.length} onClick={() => go.mutate()} data-testid="nte-issue-notice">Issue {chosen.length || ''} NTE{chosen.length > 1 ? 's' : ''}</Button><Button variant="ghost" onClick={onClose}>Close</Button></div>
    </div>}
  </Modal>;
}
