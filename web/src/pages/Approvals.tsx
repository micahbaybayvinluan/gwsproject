import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api, peso } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Input, statusTone } from '@/components/ui/primitives';

interface Req { id: string; type: string; documentType: string; documentId: string; requestedBy: string; requesterName: string; requiredApproverRoles: string[]; anyOf: boolean; status: string; summary: Record<string, unknown> | null; autoApproveAt: string | null; createdAt: string; decisions: { roleKey: string; decision: string; note: string | null; user: { fullName: string } }[] }
const LINKS: Record<string, string> = { ReceivingDoc: '/receiving', TransferDoc: '/transfers', SalesDoc: '/sales', ExpiryWriteoffDoc: '/writeoffs', PriceChangeDoc: '/price-changes', CountDoc: '/counts', DiscrepancyCase: '/discrepancies', PostCloseEdit: '/closing', Payment: '/ar' };
const TYPE_LABEL: Record<string, string> = { AUDIT_REVISION: 'Audit Associate correction (Head Auditor only)', AR_PAYMENT: 'AR payment entered by branch', COUNT_REVISION: 'Count sheet revision', DISCREPANCY_EXPLANATION: 'Discrepancy explanation', WAREHOUSE_EDIT: 'Edit of your warehouse document', MASTER_DATA_NEW: 'New master data (Owner approves)', WAREHOUSE_IN: 'Goods into the warehouse (In-Charge approves)', WAREHOUSE_OUT: 'Goods out of the warehouse (In-Charge approves)', CASH_DEPOSIT_EXTENSION: 'More days to deposit cash sales (Head Auditor + Admin)', CONSIGNMENT_CHECK_WH: 'Consignment check (In-Charge, then the Owner)', CONSIGNMENT_CHECK_BRANCH: 'Consignment check (auditor, then the Owner)', CONSIGNMENT_OUT: 'Consignment (Owner approves)', COST_EDIT: 'Product cost change', ECOM_PULLOUT: 'E-commerce pull-out from the Warehouse (In-Charge approves)', ECOM_SETTLEMENT: 'E-commerce payout: sale, fees and payout (Accounting Head)' };

/** §6.2 Approvals inbox: grouped by type, newest first, select-all + bulk approve/reject with one note, inline expand. */
export function ApprovalsPage() {
  const qc = useQueryClient(); const { can } = useAuth(); const [sp] = useSearchParams();
  const q = useQuery({ queryKey: ['approvals-inbox'], queryFn: () => api.get<{ count: number; oldestDays: number; items: Req[] }>('/api/approvals/inbox'), refetchInterval: 30000 });
  const [selected, setSelected] = useState<Set<string>>(new Set()); const [note, setNote] = useState(''); const [open, setOpen] = useState<string | null>(null);
  const [results, setResults] = useState<{ id: string; ok: boolean; error?: string }[] | null>(null);
  const bulk = useMutation({ mutationFn: (decision: 'APPROVE' | 'REJECT') => api.post<{ id: string; ok: boolean; error?: string }[]>('/api/approvals/bulk', { ids: [...selected], decision, note: note || undefined }), onSuccess: (r) => { setResults(r); setSelected(new Set()); setNote(''); void qc.invalidateQueries({ queryKey: ['approvals-inbox'] }); void qc.invalidateQueries({ queryKey: ['approvals-count'] }); } });
  const one = useMutation({ mutationFn: ({ id, decision }: { id: string; decision: 'APPROVE' | 'REJECT' }) => api.post(`/api/approvals/${id}/decide`, { decision, note: note || undefined }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['approvals-inbox'] }); void qc.invalidateQueries({ queryKey: ['approvals-count'] }); } });
  const items = (q.data?.items ?? []).filter((i) => !sp.get('type') || i.type === sp.get('type'));
  const groups = [...new Set(items.map((i) => i.type))].map((t) => ({ type: t, items: items.filter((i) => i.type === t) }));
  const toggle = (id: string) => { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n); };
  const selectAll = () => setSelected(selected.size === items.length ? new Set() : new Set(items.map((i) => i.id)));
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-2xl font-bold tracking-tight text-navy">Approvals Waiting for Me <span className="text-base text-slate-500">({q.data?.count ?? 0} pending{q.data?.oldestDays ? `, oldest ${q.data.oldestDays} d` : ''})</span></h1></div>
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={items.length > 0 && selected.size === items.length} onChange={selectAll} /> Select all ({selected.size})</label>
        <Input className="max-w-xs" placeholder="Note applied to all selected (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button disabled={!selected.size || bulk.isPending} onClick={() => bulk.mutate('APPROVE')}>Approve selected</Button>
        <Button variant="danger" disabled={!selected.size || bulk.isPending} onClick={() => bulk.mutate('REJECT')}>Reject selected</Button>
      </div>
      <ErrorBox error={bulk.error || one.error} />
      {results && <div className="mt-2 text-sm">{results.filter((r) => r.ok).length} succeeded{results.some((r) => !r.ok) && <ul className="list-disc pl-5 text-red-700">{results.filter((r) => !r.ok).map((r) => <li key={r.id}>{r.error}</li>)}</ul>}</div>}
    </Card>
    {!items.length && <Empty>Nothing waiting for you.</Empty>}
    {groups.map((g) => <Card key={g.type} title={<>{TYPE_LABEL[g.type] ?? g.type.replace(/_/g, ' ')} <Badge>{g.items.length}</Badge></>}>
      <ul className="divide-y">{g.items.map((r) => <li key={r.id} className="py-2">
        <div className="flex flex-wrap items-start gap-2">
          <input type="checkbox" className="mt-1" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
          <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
            <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">{String(r.summary?.controlNo ?? r.summary?.drSiNo ?? r.documentType)}</span>{r.summary?.locationName ? <span className="text-slate-500">{String(r.summary.locationName)}</span> : null}{r.summary?.total !== undefined ? <span>{peso(r.summary.total)}</span> : null}{r.summary?.franchiseTier === true ? <Badge tone="purple">FRANCHISE</Badge> : null}{r.autoApproveAt && <Badge tone="blue">auto-approves {new Date(r.autoApproveAt).toLocaleString()}</Badge>}{!r.anyOf && r.requiredApproverRoles.length > 1 && <Badge tone="amber">needs all: {r.requiredApproverRoles.join(' + ')}</Badge>}</div>
            <div className="text-xs text-slate-500">by {r.requesterName} · {new Date(r.createdAt).toLocaleString()}{r.decisions.length ? ` · decided by ${r.decisions.map((d) => `${d.user.fullName} (${d.decision})`).join(', ')}` : ''}</div>
          </button>
          <div className="flex gap-1"><Button size="sm" onClick={() => one.mutate({ id: r.id, decision: 'APPROVE' })}>{r.type === 'WAREHOUSE_EDIT' ? 'Accept' : 'Approve'}</Button><Button size="sm" variant="danger" onClick={() => one.mutate({ id: r.id, decision: 'REJECT' })}>Reject</Button></div>
        </div>
        {r.type === 'WAREHOUSE_EDIT' && Array.isArray(r.summary?.changes) && <div className="ml-6 mt-1 rounded border border-amber-200 bg-amber-50 p-2 text-sm">
          <div className="text-xs text-slate-600">{String(r.summary?.proposedBy ?? r.requesterName)} wants to change your {String(r.summary?.document ?? 'document')}. Nothing changes unless you accept.</div>
          <ul className="list-disc pl-5">{(r.summary!.changes as string[]).map((c, i) => <li key={i}>{c}</li>)}</ul>
        </div>}
        {open === r.id && <div className="mt-2 rounded bg-slate-50 p-3 text-sm">
          <Summary s={r.summary} showCost={can('cost.view')} />
          <Link className="mt-2 inline-block text-brand underline" to={r.documentType === 'EcomSettlement' ? `/ecommerce?payout=${r.documentId}` : `${LINKS[r.documentType] ?? '/'}${['PostCloseEdit', 'Payment'].includes(r.documentType) ? '' : `/${r.documentId}`}`}>Open full document</Link>
        </div>}
      </li>)}</ul>
    </Card>)}
  </div>;
}
function Summary({ s, showCost }: { s: Record<string, unknown> | null; showCost: boolean }) {
  if (!s) return null;
  const lines = Array.isArray(s.lines) ? (s.lines as Record<string, unknown>[]) : null;
  const scalars = Object.entries(s).filter(([k, v]) => !['lines', 'before', 'after', 'variances', 'changes', 'payload', 'kind'].includes(k) && (typeof v !== 'object' || v === null));
  return <div className="space-y-2">
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-4">{scalars.map(([k, v]) => <div key={k}><dt className="text-xs uppercase text-slate-500">{k}</dt><dd>{String(v)}</dd></div>)}</dl>
    {lines && typeof lines[0] === 'object' && <table className="w-full text-xs"><thead><tr>{Object.keys(lines[0]).filter((k) => showCost || !/cost|margin/i.test(k)).map((k) => <th key={k} className="text-left">{k}</th>)}</tr></thead><tbody>{lines.map((l, i) => <tr key={i} className="border-t">{Object.entries(l).filter(([k]) => showCost || !/cost|margin/i.test(k)).map(([k, v]) => <td key={k} className={typeof v === 'number' || /^\d/.test(String(v)) ? 'num' : ''}>{String(v ?? '')}</td>)}</tr>)}</tbody></table>}
    {(s.before || s.after) ? <div className="grid gap-2 md:grid-cols-2"><div><div className="text-xs uppercase text-slate-500">Before</div><pre className="overflow-auto rounded bg-white p-2 text-xs">{JSON.stringify(s.before, null, 1)}</pre></div><div><div className="text-xs uppercase text-slate-500">After</div><pre className="overflow-auto rounded bg-white p-2 text-xs">{JSON.stringify(s.after, null, 1)}</pre></div></div> : null}
    {Array.isArray(s.variances) && <ul className="list-disc pl-5">{(s.variances as { product: string; variance: number }[]).map((v, i) => <li key={i}>{v.product}: {v.variance}</li>)}</ul>}
  </div>;
}
export { statusTone };
