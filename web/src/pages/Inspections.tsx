import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, fmtDate, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Field, Input, Select, Textarea, statusTone } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';

type Status = 'COMPLIED' | 'NO' | 'NA';
interface Item { key: string; no: string; label: string; section: string; group?: string; extras?: ('date' | 'amount' | 'reason')[]; extraLabel?: string }
interface Answer { key: string; status: Status | null; date?: string | null; amount?: number | null; reason?: string | null }
interface Insp { id: string; controlNo: string; status: string; inspectionDate: string; locationId: string; location: { id?: string; name: string; shortCode?: string | null }; inspectorId: string; inspectorName: string | null; staffOnDuty: { id: string; fullName: string; userId: string | null } | null; staffOnDutyName: string | null; staffOnDutyEmployeeId: string | null; items: Answer[]; comments: string | null; cashFundCounted: string | null; cashFundSystem: string | null; submittedAt: string | null; staffAcknowledgedAt: string | null; staffAcknowledgedByName: string | null; hrReviewedAt: string | null; hrReviewedByName: string | null; hrNotes: string | null; nonCompliant?: number; cashFund?: { balance: string; imprestAmount: string } | null; checklist?: Item[] }

/** Store Inspection Report list (Field Auditor's own; everything for HR / Admin / auditors). */
export function InspectionsPage() {
  const nav = useNavigate(); const { can } = useAuth(); const [sp] = useSearchParams();
  const q = useQuery({ queryKey: ['inspections', sp.get('status')], queryFn: () => api.get<Insp[]>(`/api/inspections${sp.get('status') ? `?status=${sp.get('status')}` : ''}`) });
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2"><h1 className="mr-auto text-xl font-semibold">Store inspection reports</h1>{can('inspection.create') && <Button onClick={() => nav('/inspections/new')}>New inspection</Button>}</div>
    <DataTable exportName="StoreInspections" data={q.data ?? []} onRowClick={(r) => nav(`/inspections/${r.id}`)} columns={[{ header: 'No.', accessorKey: 'controlNo' }, { header: 'Date', accessorKey: 'inspectionDate', cell: (c) => fmtDate(c.getValue()) }, { header: 'Branch', accessorFn: (r) => r.location.name }, { header: 'Inspector', accessorKey: 'inspectorName' }, { header: 'Staff on duty', accessorFn: (r) => r.staffOnDuty?.fullName ?? r.staffOnDutyName ?? '' }, { header: 'Not complied', accessorKey: 'nonCompliant', cell: (c) => <span className={Number(c.getValue()) ? 'font-semibold text-red-700' : ''}>{String(c.getValue() ?? 0)}</span> }, { header: 'Status', accessorKey: 'status', cell: (c) => <Badge tone={statusTone(String(c.getValue()))}>{String(c.getValue())}</Badge> }]} />
  </div>;
}

/** New / draft inspection: the paper checklist on a phone — tap Complied / No / N/A, add dates, amounts and reasons, count the cash fund. */
export function InspectionFormPage() {
  const { id } = useParams(); const nav = useNavigate(); const qc = useQueryClient(); const { me } = useAuth();
  const existing = useQuery({ queryKey: ['inspection', id], queryFn: () => api.get<Insp>(`/api/inspections/${id}`), enabled: !!id && id !== 'new' });
  const checklist = useQuery({ queryKey: ['inspection-checklist'], queryFn: () => api.get<Item[]>('/api/inspections/checklist') });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; type: string }[]>('/api/locations') });
  const [h, setH] = useState({ locationId: '', inspectionDate: today(), staffOnDutyEmployeeId: '', staffOnDutyName: '', comments: '' });
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  useEffect(() => { const e = existing.data; if (!e) return; setH({ locationId: e.locationId, inspectionDate: fmtDate(e.inspectionDate), staffOnDutyEmployeeId: e.staffOnDutyEmployeeId ?? '', staffOnDutyName: e.staffOnDutyName ?? '', comments: e.comments ?? '' }); setAnswers(Object.fromEntries(e.items.map((a) => [a.key, a]))); }, [existing.data]);
  const staff = useQuery({ queryKey: ['staff', h.locationId], queryFn: () => api.get<{ id: string; fullName: string; position: string | null }[]>(`/api/staff?locationId=${h.locationId}`), enabled: !!h.locationId });
  const fund = useQuery({ queryKey: ['cash-fund', h.locationId], queryFn: () => api.get<{ balance: string }>(`/api/cash-funds/${h.locationId}`).catch(() => null), enabled: !!h.locationId });
  const body = () => ({ ...h, staffOnDutyEmployeeId: h.staffOnDutyEmployeeId || null, staffOnDutyName: h.staffOnDutyName || null, comments: h.comments || null, items: (checklist.data ?? []).map((c) => answers[c.key] ?? { key: c.key, status: null }) });
  const save = useMutation({ mutationFn: async () => (id && id !== 'new' ? api.put<Insp>(`/api/inspections/${id}`, body()) : api.post<Insp>('/api/inspections', body())), onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['inspections'] }); if (!id || id === 'new') nav(`/inspections/${r.id}/edit`, { replace: true }); else void qc.invalidateQueries({ queryKey: ['inspection', id] }); } });
  const submit = useMutation({ mutationFn: async () => { const r = await save.mutateAsync(); await api.post(`/api/inspections/${r.id}/submit`); return r.id; }, onSuccess: (rid) => { void qc.invalidateQueries({ queryKey: ['inspections'] }); void qc.invalidateQueries({ queryKey: ['inspection', rid] }); nav(`/inspections/${rid}`); } });
  const set = (key: string, patch: Partial<Answer>) => setAnswers((a) => ({ ...a, [key]: { ...{ key, status: null as Status | null }, ...a[key], ...patch } }));
  const items = checklist.data ?? []; const answered = items.filter((c) => answers[c.key]?.status).length;
  let section = '';
  if (existing.data && existing.data.status !== 'DRAFT') return <p className="text-sm">This report is already submitted. <a className="text-brand underline" href={`/inspections/${id}`}>Open it</a></p>;
  return <div className="mx-auto max-w-3xl space-y-4">
    <h1 className="text-xl font-semibold">Store inspection report {existing.data?.controlNo ?? '(new)'}</h1>
    <Card>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Branch"><Select value={h.locationId} onChange={(e) => setH({ ...h, locationId: e.target.value, staffOnDutyEmployeeId: '' })}><option value="">—</option>{locations.data?.filter((l) => ['BRANCH', 'WAREHOUSE', 'FRANCHISE'].includes(l.type)).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        <Field label="Date"><Input type="date" value={h.inspectionDate} onChange={(e) => setH({ ...h, inspectionDate: e.target.value })} /></Field>
        <Field label="Name of inspector"><Input value={me?.fullName ?? ''} disabled /></Field>
        <Field label="Name of staff on duty"><Select value={h.staffOnDutyEmployeeId} onChange={(e) => setH({ ...h, staffOnDutyEmployeeId: e.target.value })}><option value="">— pick or type below —</option>{staff.data?.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}</Select>{!h.staffOnDutyEmployeeId && <Input className="mt-1" placeholder="Name (if not in the list)" value={h.staffOnDutyName} onChange={(e) => setH({ ...h, staffOnDutyName: e.target.value })} />}</Field>
      </div>
    </Card>
    <Card title={`Please check the boxes below (${answered} of ${items.length})`}>
      <div className="space-y-1">{items.map((c) => { const head = c.section !== section ? (section = c.section) : null; const a = answers[c.key]; return <div key={c.key}>
        {head && <div className="mt-3 border-b pb-1 text-sm font-bold tracking-wide text-slate-700">{head}</div>}
        <div className={`flex flex-wrap items-center gap-2 rounded px-2 py-1.5 ${a?.status === 'NO' ? 'bg-red-50' : ''}`}>
          <span className="w-6 text-xs text-slate-500">{c.no}.</span><span className="min-w-0 flex-1 text-sm">{c.group ? <span className="text-slate-500">{c.group}: </span> : null}{c.label}</span>
          <div className="flex gap-1">{(['COMPLIED', 'NO', 'NA'] as Status[]).map((st) => <button key={st} type="button" className={`rounded border px-2.5 py-1 text-xs font-semibold ${a?.status === st ? (st === 'COMPLIED' ? 'border-emerald-600 bg-emerald-600 text-white' : st === 'NO' ? 'border-red-600 bg-red-600 text-white' : 'border-slate-500 bg-slate-500 text-white') : 'border-slate-300 bg-white'}`} onClick={() => set(c.key, { status: st })}>{st === 'COMPLIED' ? '✔ Complied' : st === 'NO' ? '✘ No' : 'N/A'}</button>)}</div>
        </div>
        {c.extras && <div className="ml-8 mb-1 flex flex-wrap gap-2">
          {c.extras.includes('date') && <Field label={c.extraLabel ?? 'Date'}><Input type="date" value={a?.date ?? ''} onChange={(e) => set(c.key, { date: e.target.value })} /></Field>}
          {c.extras.includes('amount') && <Field label={`Amount found (₱)${fund.data ? ` — system shows ${peso(fund.data.balance)}` : ''}`}><Input type="number" step="0.01" value={a?.amount ?? ''} onChange={(e) => set(c.key, { amount: e.target.value === '' ? null : Number(e.target.value) })} /></Field>}
          {c.extras.includes('reason') && <Field label={c.key === 'cash_fund' ? 'Reason for lacking' : 'Reason if not complied'}><Input value={a?.reason ?? ''} onChange={(e) => set(c.key, { reason: e.target.value })} /></Field>}
        </div>}
      </div>; })}</div>
    </Card>
    <Card title="Comments"><Textarea rows={4} value={h.comments} onChange={(e) => setH({ ...h, comments: e.target.value })} placeholder="Sales today, deposits, stock situation, follow-ups…" /></Card>
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!h.locationId || save.isPending} onClick={() => save.mutate()}>Save draft</Button><Button disabled={!h.locationId || answered < items.length || submit.isPending} onClick={() => submit.mutate()}>Submit to HR (Admin and Head Auditor notified)</Button></div>
    <ErrorBox error={save.error || submit.error} />
  </div>;
}

/** Submitted report: print in the paper layout; staff on duty acknowledges; HR reviews. */
export function InspectionDetailPage() {
  const { id } = useParams(); const nav = useNavigate(); const qc = useQueryClient(); const { can, me } = useAuth();
  const q = useQuery({ queryKey: ['inspection', id], queryFn: () => api.get<Insp>(`/api/inspections/${id}`) });
  const [notes, setNotes] = useState('');
  const inv = () => { void qc.invalidateQueries({ queryKey: ['inspection', id] }); void qc.invalidateQueries({ queryKey: ['inspections'] }); };
  const ack = useMutation({ mutationFn: () => api.post(`/api/inspections/${id}/acknowledge`), onSuccess: inv });
  const review = useMutation({ mutationFn: () => api.post(`/api/inspections/${id}/review`, { notes: notes || undefined }), onSuccess: inv });
  const r = q.data; if (!r) return null;
  const items = r.checklist ?? []; let section = '';
  const mineToAck = r.staffOnDuty?.userId === me?.id && !r.staffAcknowledgedAt && r.status !== 'DRAFT';
  return <div className="mx-auto max-w-3xl space-y-4">
    <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">{r.controlNo}</h1><Badge tone={statusTone(r.status)}>{r.status}</Badge>
      <span className="ml-auto flex gap-2">{r.status === 'DRAFT' && r.inspectorId === me?.id && <Button size="sm" onClick={() => nav(`/inspections/${r.id}/edit`)}>Continue</Button>}<Button size="sm" variant="outline" onClick={() => api.download(`/api/reports/forms/inspection/${r.id}.pdf`, `${r.controlNo}.pdf`)}>Print</Button></span></div>
    <Card><dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">{[['Date', fmtDate(r.inspectionDate)], ['Branch', r.location.name], ['Inspector', r.inspectorName ?? ''], ['Staff on duty', r.staffOnDuty?.fullName ?? r.staffOnDutyName ?? '']].map(([k, v]) => <div key={k}><dt className="text-xs uppercase text-slate-500">{k}</dt><dd>{v}</dd></div>)}</dl></Card>
    <Card title="Checklist"><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>No.</th><th>Item</th><th className="text-center">Complied</th><th className="text-center">No</th><th className="text-center">N/A</th><th>Details</th></tr></thead>
      <tbody>{items.map((c) => { const a = r.items.find((x) => x.key === c.key); const head = c.section !== section ? (section = c.section) : null; return [head && <tr key={`${c.key}-h`}><td colSpan={6} className="pt-3 text-xs font-bold tracking-wide text-slate-700">{head}</td></tr>, <tr key={c.key} className={`border-t ${a?.status === 'NO' ? 'bg-red-50' : ''}`}><td className="text-xs">{c.no}</td><td>{c.group ? <span className="text-slate-500">{c.group}: </span> : null}{c.label}</td><td className="text-center text-emerald-700">{a?.status === 'COMPLIED' ? '✔' : ''}</td><td className="text-center font-bold text-red-700">{a?.status === 'NO' ? '✔' : ''}</td><td className="text-center text-xs">{a?.status === 'NA' ? 'N/A' : ''}</td><td className="text-xs">{[a?.date && `Date updated: ${a.date}`, a?.amount != null && `₱${Number(a.amount).toFixed(2)}${c.key === 'cash_fund' && r.cashFundSystem ? ` (system ${peso(r.cashFundSystem)})` : ''}`, a?.reason].filter(Boolean).join(' · ')}</td></tr>]; })}</tbody></table></Card>
    {r.comments && <Card title="Comments"><p className="whitespace-pre-wrap text-sm">{r.comments}</p></Card>}
    <Card title="Sign-off">
      <p className="text-sm">Staff on duty: {r.staffAcknowledgedAt ? <b className="text-emerald-700">acknowledged by {r.staffAcknowledgedByName} on {new Date(r.staffAcknowledgedAt).toLocaleString()}</b> : <span className="text-amber-700">not yet acknowledged</span>}</p>
      <p className="text-sm">HR: {r.hrReviewedAt ? <b className="text-emerald-700">reviewed by {r.hrReviewedByName} on {new Date(r.hrReviewedAt).toLocaleString()}{r.hrNotes ? ` — ${r.hrNotes}` : ''}</b> : <span className="text-amber-700">not yet reviewed</span>}</p>
      {mineToAck && <Button className="mt-2" onClick={() => ack.mutate()}>I have read this report (acknowledge)</Button>}
      {can('inspection.review') && r.status === 'SUBMITTED' && <div className="mt-2 flex flex-wrap items-end gap-2"><Field label="HR notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field><Button onClick={() => review.mutate()}>Mark reviewed</Button></div>}
      <ErrorBox error={ack.error || review.error} />
    </Card>
  </div>;
}
