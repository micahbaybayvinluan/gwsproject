import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fmtDate, peso } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, ErrorBox, Field, Input, Select, statusTone } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';

interface Count { id: string; controlNo: string; countDate: string; status: string; location: { id: string; name: string }; lines: { id: string; productId: string; systemQty: number; actualQty: number | null; variance: number; remarks: string | null; product: { sku: string; name: string } }[]; discrepancyCase: { id: string; status: string; deadline: string } | null }

/** §7.7 Actual Inventory Count with Excel template download/upload, and the discrepancy case workflow. */
export function CountsPage() {
  const nav = useNavigate(); const { me, can } = useAuth(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['counts'], queryFn: () => api.get<Count[]>('/api/counts') });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/locations') });
  const [locationId, setLocationId] = useState(me!.locations[0]?.id ?? ''); const [all, setAll] = useState(false);
  const m = useMutation({ mutationFn: () => api.post<{ id: string }>('/api/counts', { locationId, allProducts: all }), onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['counts'] }); nav(`/counts/${r.id}`); } });
  return <div className="space-y-4">
    <h1 className="text-xl font-semibold">Actual Inventory Count</h1>
    {can('count.create') && <Card title="Start a count"><div className="flex flex-wrap items-end gap-2"><Field label="Location"><Select value={locationId} onChange={(e) => setLocationId(e.target.value)}><option value="">—</option>{locations.data?.filter((l) => !me!.locationScoped || me!.locations.some((x) => x.id === l.id)).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field><label className="flex items-center gap-1 pb-2 text-sm"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> include all active products (not only those with stock)</label><Button disabled={!locationId || m.isPending} onClick={() => m.mutate()}>Create count sheet</Button></div><ErrorBox error={m.error} /></Card>}
    <DataTable data={q.data ?? []} onRowClick={(r) => nav(`/counts/${r.id}`)} columns={[{ header: 'Date', accessorKey: 'countDate', cell: (c) => fmtDate(c.getValue()) }, { header: 'Control #', accessorKey: 'controlNo' }, { header: 'Location', accessorFn: (r) => r.location.name }, { header: 'Lines', accessorFn: (r) => r.lines.length }, { header: 'Variances', accessorFn: (r) => r.lines.filter((l) => l.variance !== 0).length }, { header: 'Status', accessorKey: 'status', cell: (c) => <Badge tone={statusTone(String(c.getValue()))}>{String(c.getValue())}</Badge> }, { header: 'Case', cell: (c) => c.row.original.discrepancyCase ? <Badge tone={statusTone(c.row.original.discrepancyCase.status)}>{c.row.original.discrepancyCase.status}</Badge> : null }]} />
  </div>;
}

export function CountDetailPage() {
  const { id } = useParams(); const qc = useQueryClient(); const { can } = useAuth();
  const q = useQuery({ queryKey: ['count', id], queryFn: () => api.get<Count>(`/api/counts/${id}`) });
  const [actual, setActual] = useState<Record<string, string>>({});
  const inv = () => void qc.invalidateQueries({ queryKey: ['count', id] });
  const save = useMutation({ mutationFn: () => api.put(`/api/counts/${id}/lines`, { lines: (q.data?.lines ?? []).filter((l) => actual[l.productId] !== undefined && actual[l.productId] !== '').map((l) => ({ productId: l.productId, actualQty: Number(actual[l.productId]) })) }), onSuccess: inv });
  const submit = useMutation({ mutationFn: () => api.post(`/api/counts/${id}/submit`), onSuccess: inv });
  const upload = useMutation({ mutationFn: async (f: File) => { const r = await api.upload<{ lines: { productId: string; actualQty: number; remarks?: string }[]; errors: string[] }>('/api/imports/count-lines', f); await api.put(`/api/counts/${id}/lines`, { lines: r.lines }); return r; }, onSuccess: inv });
  const d = q.data; if (!d) return null;
  const editable = d.status === 'DRAFT' && can('count.create');
  return <div className="mx-auto max-w-4xl space-y-4">
    <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">{d.controlNo} — {d.location.name}</h1><Badge tone={statusTone(d.status)}>{d.status}</Badge><span className="ml-auto flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => api.download(`/api/reports/forms/count/${d.id}.xlsx`, `${d.controlNo}.xlsx`)}>Download sheet (xlsx)</Button><Button size="sm" variant="outline" onClick={() => api.download(`/api/reports/forms/count/${d.id}.pdf`, `${d.controlNo}.pdf`)}>PDF</Button>{editable && <label className="inline-flex min-h-8 cursor-pointer items-center rounded-md border border-slate-300 bg-white px-3 text-xs">Upload filled sheet<input type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} /></label>}</span></div>
    {d.discrepancyCase && <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">Discrepancy case <Badge tone={statusTone(d.discrepancyCase.status)}>{d.discrepancyCase.status}</Badge> — deadline {fmtDate(d.discrepancyCase.deadline)}. <Link className="text-brand underline" to={`/discrepancies/${d.discrepancyCase.id}`}>Open case</Link></div>}
    <Card><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>SKU</th><th>Name</th><th className="num">System Qty</th><th className="num">Actual Qty</th><th className="num">Variance</th><th>Remarks</th></tr></thead><tbody>{d.lines.map((l) => { const a = actual[l.productId] !== undefined ? Number(actual[l.productId]) : l.actualQty; const v = a == null ? null : a - l.systemQty; return <tr key={l.id} className="border-t"><td className="text-xs">{l.product.sku}</td><td>{l.product.name}</td><td className="num">{l.systemQty}</td><td className="num">{editable ? <Input type="number" inputMode="numeric" min={0} className="w-24 text-right" value={actual[l.productId] ?? (l.actualQty ?? '')} onChange={(e) => setActual({ ...actual, [l.productId]: e.target.value })} /> : l.actualQty ?? '—'}</td><td className={`num ${v ? 'font-medium text-red-700' : ''}`}>{v ?? ''}</td><td className="text-xs">{l.remarks}</td></tr>; })}</tbody></table>
      {editable && <div className="mt-3 flex gap-2"><Button variant="outline" onClick={() => save.mutate()}>Save actuals</Button><Button onClick={async () => { await save.mutateAsync(); submit.mutate(); }}>Submit count</Button></div>}<ErrorBox error={save.error || submit.error || upload.error} />
    </Card>
  </div>;
}

interface Case { id: string; status: string; deadline: string; resolutionNote: string | null; finalReportGeneratedAt: string | null; countDoc: { controlNo: string; countDate: string; location: { name: string } }; chargeForm: { id: string; controlNo: string; totalAmount: string; finalizedByHrAt: string | null } | null; variances?: { product: { name: string; sku: string }; systemQty: number; actualQty: number | null; variance: number; remarks: string | null }[]; linked?: { sales: number; transfers: number } }
export function DiscrepanciesPage() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['discrepancies'], queryFn: () => api.get<Case[]>('/api/discrepancies') });
  return <div className="space-y-4"><h1 className="text-xl font-semibold">Discrepancy cases</h1><DataTable data={q.data ?? []} onRowClick={(r) => nav(`/discrepancies/${r.id}`)} columns={[{ header: 'Count #', accessorFn: (r) => r.countDoc.controlNo }, { header: 'Location', accessorFn: (r) => r.countDoc.location.name }, { header: 'Count date', accessorFn: (r) => fmtDate(r.countDoc.countDate) }, { header: 'Deadline', accessorKey: 'deadline', cell: (c) => fmtDate(c.getValue()) }, { header: 'Status', accessorKey: 'status', cell: (c) => <Badge tone={statusTone(String(c.getValue()))}>{String(c.getValue())}</Badge> }, { header: 'Charge form', accessorFn: (r) => (r.chargeForm ? `${r.chargeForm.controlNo} ${peso(r.chargeForm.totalAmount)}` : '') }]} /></div>;
}
export function DiscrepancyDetailPage() {
  const { id } = useParams(); const qc = useQueryClient(); const { can } = useAuth(); const [note, setNote] = useState('');
  const q = useQuery({ queryKey: ['discrepancy', id], queryFn: () => api.get<Case>(`/api/discrepancies/${id}`) });
  const resolve = useMutation({ mutationFn: (mode: 'ADJUST' | 'RESOLVED') => api.post(`/api/discrepancies/${id}/resolve`, { mode, note }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['discrepancy', id] }) });
  const c = q.data; if (!c) return null;
  return <div className="mx-auto max-w-4xl space-y-4">
    <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">Discrepancy — {c.countDoc.controlNo} ({c.countDoc.location.name})</h1><Badge tone={statusTone(c.status)}>{c.status}</Badge><span className="ml-auto flex gap-2"><Button size="sm" variant="outline" onClick={() => api.download(`/api/reports/forms/discrepancy/${c.id}.pdf`, `Discrepancy-${c.countDoc.controlNo}.pdf`)}>{c.status === 'FINALIZED' ? 'Final report PDF' : 'Report PDF'}</Button><Button size="sm" variant="outline" onClick={() => api.download(`/api/reports/forms/discrepancy/${c.id}.xlsx`, `Discrepancy-${c.countDoc.controlNo}.xlsx`)}>xlsx</Button></span></div>
    <Card><dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">{[['Count date', fmtDate(c.countDoc.countDate)], ['Deadline (7 days)', fmtDate(c.deadline)], ['Correcting docs linked', `${c.linked?.sales ?? 0} sales · ${c.linked?.transfers ?? 0} transfers`], ['Resolution', c.resolutionNote ?? '—']].map(([k, v]) => <div key={k}><dt className="text-xs uppercase text-slate-500">{k}</dt><dd>{v}</dd></div>)}</dl></Card>
    <Card title="Variances"><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>SKU</th><th>Name</th><th className="num">System</th><th className="num">Actual</th><th className="num">Variance</th><th>Remarks</th></tr></thead><tbody>{c.variances?.map((v, i) => <tr key={i} className="border-t"><td className="text-xs">{v.product.sku}</td><td>{v.product.name}</td><td className="num">{v.systemQty}</td><td className="num">{v.actualQty}</td><td className={`num ${v.variance < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{v.variance}</td><td>{v.remarks}</td></tr>)}</tbody></table></Card>
    {c.status === 'OPEN' && can('discrepancy.resolve') && <Card title="Resolve (Head Auditor)"><Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" disabled={!note} onClick={() => resolve.mutate('RESOLVED')}>Mark resolved (fresh count matches)</Button><Button disabled={!note} onClick={() => resolve.mutate('ADJUST')}>Accept variance as ADJUST_COUNT (requests approval)</Button></div><ErrorBox error={resolve.error} /></Card>}
    {c.chargeForm && <Card title="Charge form"><p className="text-sm">{c.chargeForm.controlNo} — total {peso(c.chargeForm.totalAmount)} at franchise cost · {c.chargeForm.finalizedByHrAt ? 'finalized by HR' : 'awaiting HR allocation'}. <Link className="text-brand underline" to={`/charge-forms/${c.chargeForm.id}`}>Open</Link></p></Card>}
  </div>;
}
