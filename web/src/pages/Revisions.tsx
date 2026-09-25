import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Badge, Card, Empty, Field, Input, Select } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';

interface Rev { id: string; date: string; createdAt: string; source: string; sourceLabel: string; documentType: string; documentId: string; controlNo: string | null; location: string | null; staff: string | null; staffUserId: string | null; requestedByName: string | null; approvedByName: string | null; reason: string | null; changes: unknown }
interface ByStaff { staffUserId: string; staff: string; total: number; bySource: Record<string, number>; lastAt: string }

const SOURCE: Record<string, string> = { AUDIT_REVISION: 'Audit revision', POST_CLOSE_EDIT: 'Post-close edit', WAREHOUSE_EDIT: 'Warehouse edit', COUNT_REVISION: 'Count revision' };
const LINK: Record<string, string> = { SalesDoc: '/sales/', TransferDoc: '/transfers/', ReceivingDoc: '/receiving/', CountDoc: '/counts/', ExpenseDoc: '/expenses' };
const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };

function describe(c: unknown): string {
  if (!c) return '';
  if (Array.isArray(c)) return c.map((x: { product?: string; before?: unknown; after?: unknown }) => (x.product ? `${x.product}: ${String(x.before)} → ${String(x.after)}` : JSON.stringify(x))).join('; ');
  const o = c as { before?: Record<string, unknown>; after?: Record<string, unknown> };
  if (o.after) return Object.keys(o.after).map((k) => `${k}: ${String(o.before?.[k] ?? '—')} → ${String(o.after![k])}`).join('; ');
  return JSON.stringify(c);
}

/** Revision log (owner request 2026-09-26): every approved correction, and which staff have the most errors in their reports. */
export function RevisionsPage() {
  const [from, setFrom] = useState(monthStart()); const [to, setTo] = useState(''); const [source, setSource] = useState(''); const [staff, setStaff] = useState('');
  const qs = `from=${from}${to ? `&to=${to}` : ''}`;
  const by = useQuery({ queryKey: ['revisions-by-staff', qs], queryFn: () => api.get<ByStaff[]>(`/api/revisions/by-staff?${qs}`) });
  const log = useQuery({ queryKey: ['revisions', qs, source, staff], queryFn: () => api.get<Rev[]>(`/api/revisions?${qs}${source ? `&source=${source}` : ''}${staff ? `&staffUserId=${staff}` : ''}`) });
  const max = Math.max(1, ...(by.data ?? []).map((r) => r.total));
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-xl font-semibold">Revision Log</h1>
      <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      <Field label="Kind"><Select value={source} onChange={(e) => setSource(e.target.value)}><option value="">All</option>{Object.entries(SOURCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
    </div>
    <Card title="Errors per staff (corrections of their documents)">
      {!by.data?.length ? <Empty>No corrections in this period.</Empty> : <table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th>Staff</th><th className="num">Corrections</th><th className="w-1/3" /><th>By kind</th><th>Last</th></tr></thead>
        <tbody>{by.data.map((r) => <tr key={r.staffUserId} className={`cursor-pointer border-t hover:bg-slate-50 ${staff === r.staffUserId ? 'bg-slate-50' : ''}`} onClick={() => setStaff(staff === r.staffUserId ? '' : r.staffUserId)}>
          <td className="py-1 font-medium">{r.staff}</td><td className={`num font-semibold ${r.total >= 3 ? 'text-red-700' : ''}`}>{r.total}</td>
          <td><div className="h-2 rounded bg-red-200" style={{ width: `${(r.total / max) * 100}%` }} /></td>
          <td className="text-xs">{Object.entries(r.bySource).map(([k, n]) => <Badge key={k}>{SOURCE[k] ?? k}: {n}</Badge>)}</td>
          <td className="text-xs">{new Date(r.lastAt).toLocaleDateString()}</td></tr>)}</tbody></table>}
      <p className="mt-2 text-xs text-slate-500">Click a name to filter the log below. Three or more corrections in the period are shown in red.</p>
    </Card>
    <Card title={staff ? `Corrections for ${by.data?.find((r) => r.staffUserId === staff)?.staff ?? ''}` : 'All corrections'}>
      <DataTable exportName="RevisionLog" data={log.data ?? []} columns={[
        { header: 'Date', accessorKey: 'date' }, { header: 'Kind', accessorFn: (r) => SOURCE[r.source] ?? r.source }, { header: 'Document', accessorFn: (r) => r.controlNo ?? r.documentType, cell: (c) => { const r = c.row.original; const l = LINK[r.documentType]; return l ? <Link className="text-brand underline" to={l.endsWith('/') ? `${l}${r.documentId}` : l}>{String(c.getValue())}</Link> : String(c.getValue()); } },
        { header: 'Branch', accessorFn: (r) => r.location ?? '' }, { header: 'Staff (document owner)', accessorFn: (r) => r.staff ?? '' }, { header: 'Requested by', accessorFn: (r) => r.requestedByName ?? '' }, { header: 'Approved by', accessorFn: (r) => r.approvedByName ?? '' }, { header: 'Reason', accessorFn: (r) => r.reason ?? '' }, { header: 'Change', accessorFn: (r) => describe(r.changes), cell: (c) => <span className="text-xs">{String(c.getValue())}</span> },
      ]} />
    </Card>
  </div>;
}
