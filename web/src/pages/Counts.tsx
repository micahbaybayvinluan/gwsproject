import { ApprovalTimeline } from '@/components/ApprovalTimeline';
import { History } from '@/components/DocEdits';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, fmtDate, peso } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Field, Input, Select, statusTone } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';

interface Count { id: string; controlNo: string; countDate: string; status: string; countType: 'AUDIT' | 'WEEKLY'; countedBy: string | null; submittedAt: string | null; location: { id: string; name: string }; lines: { id: string; productId: string; beginQty: number; systemQty: number; actualQty: number | null; variance: number; remarks: string | null; product: { sku: string; name: string }; expiries?: { expiry: string; batchNo: string | null; qty: number }[] }[]; discrepancyCase: { id: string; caseNo: string | null; status: string; deadline: string } | null }
const TYPE_LABEL = { AUDIT: 'Audit count', WEEKLY: 'Weekly count' } as const;

/** §7.7 Actual Inventory Count with Excel template download/upload, and the discrepancy case workflow. */
export function CountsPage() {
  const nav = useNavigate(); const { me, can } = useAuth(); const qc = useQueryClient();
  const [params] = useSearchParams();
  const q = useQuery({ queryKey: ['counts'], queryFn: () => api.get<Count[]>('/api/counts') });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; type: string }[]>('/api/locations') });
  // branch staff count their own branch every week; auditors choose the branch or franchise they are auditing
  const weeklyOnly = ['SALES_ASSOCIATE', 'WAREHOUSE_ASSOCIATE', 'FRANCHISE_SALES_ASSOCIATE'].includes(me!.roleKey);
  const [locationId, setLocationId] = useState(me!.locations[0]?.id ?? ''); const [all, setAll] = useState(false);
  const m = useMutation({ mutationFn: () => api.post<{ id: string }>('/api/counts', { locationId, allProducts: all, countType: weeklyOnly ? 'WEEKLY' : 'AUDIT' }), onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['counts'] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); nav(`/counts/${r.id}`); } });
  const choices = locations.data?.filter((l) => !me!.locationScoped || me!.locations.some((x) => x.id === l.id)).filter((l) => ['BRANCH', 'FRANCHISE', 'WAREHOUSE'].includes(l.type) || me!.locationScoped) ?? [];
  return <div className="space-y-4">
    <h1 className="text-xl font-semibold">Actual Inventory Count</h1>
    {can('count.create') && <Card title={weeklyOnly ? 'Weekly count sheet' : 'Start an audit count'}>
      {weeklyOnly && <p className={`mb-2 text-sm ${params.get('weekly') ? 'font-semibold text-red-700' : 'text-slate-600'}`}>Every sales associate submits one count sheet per week. The sheet is filled in for you with today's beginning count; you only type what you actually count.</p>}
      {!weeklyOnly && <p className="mb-2 text-sm text-slate-600">Choose the branch you are auditing. The sheet lists every item with its start-of-day beginning count; you only type the actual count. Once submitted it is locked — a revision needs the Head Auditor's approval.</p>}
      <div className="flex flex-wrap items-end gap-2"><Field label={weeklyOnly ? 'Branch' : 'Branch / franchise being audited'}><Select value={locationId} onChange={(e) => setLocationId(e.target.value)}><option value="">—</option>{choices.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field><label className="flex items-center gap-1 pb-2 text-sm"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> include all active products (not only those with stock)</label><Button disabled={!locationId || m.isPending} onClick={() => m.mutate()}>{weeklyOnly ? 'Start my weekly count sheet' : 'Create count sheet'}</Button></div><ErrorBox error={m.error} /></Card>}
    <DataTable data={q.data ?? []} onRowClick={(r) => nav(`/counts/${r.id}`)} columns={[{ header: 'Date', accessorKey: 'countDate', cell: (c) => fmtDate(c.getValue()) }, { header: 'Control #', accessorKey: 'controlNo' }, { header: 'Type', accessorKey: 'countType', cell: (c) => <Badge tone={c.getValue() === 'WEEKLY' ? 'blue' : 'purple'}>{TYPE_LABEL[c.getValue() as 'AUDIT' | 'WEEKLY'] ?? String(c.getValue())}</Badge> }, { header: 'Location', accessorFn: (r) => r.location.name }, { header: 'Lines', accessorFn: (r) => r.lines.length }, { header: 'Variances', accessorFn: (r) => r.lines.filter((l) => l.variance !== 0).length }, { header: 'Status', accessorKey: 'status', cell: (c) => <Badge tone={statusTone(String(c.getValue()))}>{String(c.getValue())}</Badge> }, { header: 'Case', cell: (c) => c.row.original.discrepancyCase ? <Badge tone={statusTone(c.row.original.discrepancyCase.status)}>{c.row.original.discrepancyCase.caseNo ?? c.row.original.discrepancyCase.status}</Badge> : null }]} />
  </div>;
}

export function CountDetailPage() {
  const { id } = useParams(); const qc = useQueryClient(); const { can, me } = useAuth();
  const q = useQuery({ queryKey: ['count', id], queryFn: () => api.get<Count>(`/api/counts/${id}`) });
  const [actual, setActual] = useState<Record<string, string>>({});
  const [rev, setRev] = useState<Record<string, string>>({}); const [reason, setReason] = useState(''); const [revOpen, setRevOpen] = useState(false);
  const inv = () => { void qc.invalidateQueries({ queryKey: ['count', id] }); void qc.invalidateQueries({ queryKey: ['counts'] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); };
  const save = useMutation({ mutationFn: () => api.put(`/api/counts/${id}/lines`, { lines: (q.data?.lines ?? []).filter((l) => actual[l.productId] !== undefined && actual[l.productId] !== '').map((l) => ({ productId: l.productId, actualQty: Number(actual[l.productId]) })) }), onSuccess: inv });
  const submit = useMutation({ mutationFn: () => api.post(`/api/counts/${id}/submit`), onSuccess: inv });
  const upload = useMutation({ mutationFn: async (f: File) => { const r = await api.upload<{ lines: { productId: string; actualQty: number; remarks?: string }[]; errors: string[] }>('/api/imports/count-lines', f); await api.put(`/api/counts/${id}/lines`, { lines: r.lines }); return r; }, onSuccess: inv });
  const revise = useMutation({ mutationFn: () => api.post(`/api/counts/${id}/revision`, { reason, lines: Object.entries(rev).filter(([, v]) => v !== '').map(([productId, v]) => ({ productId, actualQty: Number(v) })) }), onSuccess: () => { setRev({}); setReason(''); setRevOpen(false); inv(); } });
  const d = q.data; if (!d) return null;
  const editable = d.status === 'DRAFT' && can('count.create');
  const canRevise = d.status !== 'DRAFT' && can('count.create') && (d.countedBy === me!.id || can('approval.act.COUNT_REVISION')) && d.discrepancyCase?.status !== 'FINALIZED';
  const missing = editable ? d.lines.filter((l) => (actual[l.productId] ?? (l.actualQty == null ? '' : String(l.actualQty))) === '').length : 0;
  return <div className="mx-auto max-w-5xl space-y-4">
    <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">{d.controlNo} — {d.location.name}</h1><Badge tone={d.countType === 'WEEKLY' ? 'blue' : 'purple'}>{TYPE_LABEL[d.countType]}</Badge><Badge tone={statusTone(d.status)}>{d.status}</Badge><span className="ml-auto flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => api.download(`/api/reports/forms/count/${d.id}.xlsx`, `${d.controlNo}.xlsx`)}>Download sheet (xlsx)</Button><Button size="sm" variant="outline" onClick={() => api.download(`/api/reports/forms/count/${d.id}.pdf`, `${d.controlNo}.pdf`)}>PDF</Button>{editable && <label className="inline-flex min-h-8 cursor-pointer items-center rounded-md border border-slate-300 bg-white px-3 text-xs">Upload filled sheet<input type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} /></label>}</span></div>
    {editable && <p className="text-sm text-slate-600">Every item is already listed with its beginning count for {fmtDate(d.countDate)}. Type only the <b>actual count</b>. Differences are computed for you and sent to the auditors when you submit.</p>}
    {!editable && d.status !== 'DRAFT' && <p className="text-sm text-slate-600">Submitted {d.submittedAt ? new Date(d.submittedAt).toLocaleString() : ''}. This sheet is locked. A correction needs the Head Auditor's approval{d.countType === 'AUDIT' ? ' and Admin is notified' : ''}.</p>}
    {d.discrepancyCase && <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">Discrepancy case {d.discrepancyCase.caseNo} <Badge tone={statusTone(d.discrepancyCase.status)}>{d.discrepancyCase.status}</Badge> — deadline {fmtDate(d.discrepancyCase.deadline)}. <Link className="text-brand underline" to={`/discrepancies/${d.discrepancyCase.id}`}>Open case</Link></div>}
    <Card><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>SKU</th><th>Name</th><th className="num">Beginning (start of day)</th><th className="num">Expected now</th><th className="num">Actual count</th><th className="num">Difference</th><th>Expiry dates on hand</th><th>Remarks</th>{revOpen && <th className="num">Corrected actual</th>}</tr></thead><tbody>{d.lines.map((l) => { const a = actual[l.productId] !== undefined && actual[l.productId] !== '' ? Number(actual[l.productId]) : l.actualQty; const v = a == null ? null : a - l.systemQty; return <tr key={l.id} className="border-t"><td className="text-xs">{l.product.sku}</td><td>{l.product.name}</td><td className="num">{l.beginQty}</td><td className="num text-slate-500">{l.systemQty}</td><td className="num">{editable ? <Input type="number" inputMode="numeric" min={0} className="w-24 text-right" value={actual[l.productId] ?? (l.actualQty ?? '')} onChange={(e) => setActual({ ...actual, [l.productId]: e.target.value })} /> : l.actualQty ?? '—'}</td><td className={`num ${v ? 'font-semibold text-red-700' : ''}`}>{v == null ? '' : v > 0 ? `+${v}` : v}</td><td className="text-xs">{l.expiries?.length ? l.expiries.map((e) => <span key={e.expiry} className="mr-1 inline-block rounded bg-slate-100 px-1">{e.expiry}: {e.qty}</span>) : '—'}</td><td className="text-xs">{l.remarks}</td>{revOpen && <td className="num"><Input type="number" min={0} className="w-24 text-right" value={rev[l.productId] ?? ''} placeholder={String(l.actualQty ?? 0)} onChange={(e) => setRev({ ...rev, [l.productId]: e.target.value })} /></td>}</tr>; })}</tbody></table></div>
      {editable && <div className="mt-3 flex flex-wrap items-center gap-2"><Button variant="outline" onClick={() => save.mutate()}>Save actuals</Button><Button disabled={missing > 0} onClick={async () => { if (!confirm('Submit this count sheet? It cannot be edited after submission.')) return; await save.mutateAsync(); submit.mutate(); }}>Submit count</Button>{missing > 0 && <span className="text-xs text-slate-500">{missing} item(s) still without an actual count</span>}</div>}<ErrorBox error={save.error || submit.error || upload.error} />
    </Card>
    {canRevise && <Card title="Ask for a revision (Head Auditor approves)">
      {!revOpen ? <Button variant="outline" onClick={() => setRevOpen(true)}>Correct this count…</Button> : <div className="space-y-2">
        <p className="text-sm text-slate-600">Type the corrected actual count in the last column for the items that were wrong, then give the reason.</p>
        <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. found 1 box behind the counter" /></Field>
        <div className="flex gap-2"><Button disabled={reason.length < 3 || !Object.values(rev).some((v) => v !== '') || revise.isPending} onClick={() => revise.mutate()}>Send to the Head Auditor</Button><Button variant="outline" onClick={() => { setRevOpen(false); setRev({}); }}>Cancel</Button></div>
      </div>}
      {revise.isSuccess && <p className="mt-2 text-sm text-emerald-700">Sent. The Head Auditor decides{d.countType === 'AUDIT' ? '; Admin was notified' : ''}.</p>}
      <ErrorBox error={revise.error} />
    </Card>}
    <ApprovalTimeline documentType="CountDoc" documentId={d.id} />
    <History entityType="CountDoc" id={d.id} />
  </div>;
}

interface Case { id: string; caseNo: string | null; status: string; deadline: string; resolutionNote: string | null; finalReportGeneratedAt: string | null; countDoc: { controlNo: string; countDate: string; location: { name: string } }; chargeForm: { id: string; controlNo: string; totalAmount: string; finalizedByHrAt: string | null } | null; variances?: { product: { name: string; sku: string }; systemQty: number; actualQty: number | null; variance: number; remarks: string | null }[]; linked?: { sales: number; transfers: number; approvals?: { type: string; status: string; summary: { explanation?: string; explainedBy?: string } | null }[] } }
export function DiscrepanciesPage() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['discrepancies'], queryFn: () => api.get<Case[]>('/api/discrepancies') });
  return <div className="space-y-4"><h1 className="text-xl font-semibold">Discrepancy cases</h1><DataTable data={q.data ?? []} onRowClick={(r) => nav(`/discrepancies/${r.id}`)} columns={[{ header: 'Case #', accessorFn: (r) => r.caseNo ?? '' }, { header: 'Count #', accessorFn: (r) => r.countDoc.controlNo }, { header: 'Location', accessorFn: (r) => r.countDoc.location.name }, { header: 'Count date', accessorFn: (r) => fmtDate(r.countDoc.countDate) }, { header: 'Deadline', accessorKey: 'deadline', cell: (c) => fmtDate(c.getValue()) }, { header: 'Status', accessorKey: 'status', cell: (c) => <Badge tone={statusTone(String(c.getValue()))}>{String(c.getValue())}</Badge> }, { header: 'Charge form', accessorFn: (r) => (r.chargeForm ? `${r.chargeForm.controlNo} ${peso(r.chargeForm.totalAmount)}` : '') }]} /></div>;
}
export function DiscrepancyDetailPage() {
  const { id } = useParams(); const qc = useQueryClient(); const { can } = useAuth(); const [note, setNote] = useState('');
  const q = useQuery({ queryKey: ['discrepancy', id], queryFn: () => api.get<Case>(`/api/discrepancies/${id}`) });
  const resolve = useMutation({ mutationFn: (mode: 'ADJUST' | 'RESOLVED') => api.post(`/api/discrepancies/${id}/resolve`, { mode, note }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['discrepancy', id] }) });
  const [why, setWhy] = useState('');
  const explain = useMutation({ mutationFn: () => api.post(`/api/discrepancies/${id}/explain`, { explanation: why }), onSuccess: () => { setWhy(''); void qc.invalidateQueries({ queryKey: ['discrepancy', id] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); } });
  const c = q.data; if (!c) return null;
  const daysLeft = Math.ceil((new Date(c.deadline).getTime() - Date.now()) / 86400000);
  const explanations = (c.linked?.approvals ?? []).filter((a) => a.type === 'DISCREPANCY_EXPLANATION');
  const pendingExplanation = explanations.some((a) => a.status === 'PENDING');
  return <div className="mx-auto max-w-4xl space-y-4">
    <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">Discrepancy {c.caseNo ?? ''} — {c.countDoc.controlNo} ({c.countDoc.location.name})</h1><Badge tone={statusTone(c.status)}>{c.status}</Badge><span className="ml-auto flex gap-2"><Button size="sm" variant="outline" onClick={() => api.download(`/api/reports/forms/discrepancy/${c.id}.pdf`, `Discrepancy-${c.countDoc.controlNo}.pdf`)}>{c.status === 'FINALIZED' ? 'Final report PDF' : 'Report PDF'}</Button><Button size="sm" variant="outline" onClick={() => api.download(`/api/reports/forms/discrepancy/${c.id}.xlsx`, `Discrepancy-${c.countDoc.controlNo}.xlsx`)}>xlsx</Button></span></div>
    <Card><dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">{[['Count date', fmtDate(c.countDoc.countDate)], ['Deadline (7 days)', fmtDate(c.deadline)], ['Correcting docs linked', `${c.linked?.sales ?? 0} sales · ${c.linked?.transfers ?? 0} transfers`], ['Resolution', c.resolutionNote ?? '—']].map(([k, v]) => <div key={k}><dt className="text-xs uppercase text-slate-500">{k}</dt><dd>{v}</dd></div>)}</dl></Card>
    <Card title="Variances"><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>SKU</th><th>Name</th><th className="num">System</th><th className="num">Actual</th><th className="num">Variance</th><th>Remarks</th></tr></thead><tbody>{c.variances?.map((v, i) => <tr key={i} className="border-t"><td className="text-xs">{v.product.sku}</td><td>{v.product.name}</td><td className="num">{v.systemQty}</td><td className="num">{v.actualQty}</td><td className={`num ${v.variance < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{v.variance}</td><td>{v.remarks}</td></tr>)}</tbody></table></Card>
    <ApprovalTimeline documentType="DiscrepancyCase" documentId={c.id} />
    {c.status === 'OPEN' && daysLeft >= 0 && <p className="text-base font-bold text-red-700">{daysLeft} day(s) left before the shortage is charged to the staff on duty.</p>}
    {explanations.length > 0 && <Card title="Explanations">{explanations.map((a, i) => <p key={i} className="text-sm">{a.summary?.explainedBy}: “{a.summary?.explanation}” <Badge tone={statusTone(a.status)}>{a.status === 'PENDING' ? 'waiting for the Head Auditor' : a.status}</Badge></p>)}</Card>}
    {c.status === 'OPEN' && can('discrepancy.explain') && !pendingExplanation && <Card title="Explain this discrepancy">
      <p className="mb-2 text-sm text-slate-600">HR is notified and the Head Auditor decides. If accepted, the difference is adjusted and nobody is charged.</p>
      <textarea className="w-full rounded-md border border-slate-300 p-2 text-sm" rows={3} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="What happened? e.g. a sale was keyed the next day" />
      <Button className="mt-2" disabled={why.trim().length < 5 || explain.isPending} onClick={() => explain.mutate()}>Send explanation</Button><ErrorBox error={explain.error} />
    </Card>}
    {c.status === 'OPEN' && can('discrepancy.resolve') && <Card title="Resolve (Head Auditor)"><Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" disabled={!note} onClick={() => resolve.mutate('RESOLVED')}>Mark resolved (fresh count matches)</Button><Button disabled={!note} onClick={() => resolve.mutate('ADJUST')}>Accept variance as ADJUST_COUNT (requests approval)</Button></div><ErrorBox error={resolve.error} /></Card>}
    {c.chargeForm && <Card title="Charge form"><p className="text-sm">{c.chargeForm.controlNo} — total {peso(c.chargeForm.totalAmount)} at franchise cost · {c.chargeForm.finalizedByHrAt ? 'finalized by HR' : 'awaiting HR allocation'}. <Link className="text-brand underline" to={`/charge-forms/${c.chargeForm.id}`}>Open</Link></p></Card>}
  </div>;
}
