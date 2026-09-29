import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, ErrorBox, Field, Input } from '@/components/ui/primitives';

const KINDS: { kind: string; label: string; endpoint: string; perm: string; query?: (v: string) => string; extra?: string }[] = [
  { kind: 'products', label: 'Products (template)', endpoint: '/api/imports/products', perm: 'product.create' },
  { kind: 'prices', label: 'Price lists', endpoint: '/api/imports/prices', perm: 'price.edit' },
  { kind: 'min-stock', label: 'Minimum stock', endpoint: '/api/imports/min-stock', perm: 'settings.thresholds' },
  { kind: 'opening-stock', label: 'Opening stock per location (cost: Admin)', endpoint: '/api/imports/opening-stock', perm: 'cost.edit', query: (v) => `?date=${v}`, extra: 'Cut-over date' },
  { kind: 'beginning-balances', label: 'Beginning balances', endpoint: '/api/imports/beginning-balances', perm: 'gl.beginning_balance', query: (v) => `?year=${v}`, extra: 'Fiscal year' },
  { kind: 'employees', label: 'Employees', endpoint: '/api/imports/employees', perm: 'employee.manage' },
  { kind: 'open-ar', label: 'Open AR (migration)', endpoint: '/api/imports/open-ar', perm: 'ar.collect' },
];

/** §13 bulk upload templates + §7.1 seed workbook import + §10.1 COA import review. */
export function ImportsPage() {
  const { can } = useAuth();
  const [results, setResults] = useState<Record<string, unknown>>({}); const [extra, setExtra] = useState<Record<string, string>>({});
  const show = (v: unknown) => (v === undefined ? null : <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(v, null, 1)}</pre>);
  const run = useMutation({ mutationFn: ({ endpoint, file }: { endpoint: string; file: File }) => api.upload<unknown>(endpoint, file), onSuccess: (r, v) => setResults({ ...results, [v.endpoint]: r }) });
  const seed = useMutation({ mutationFn: (file: File) => api.upload<unknown>('/api/imports/products/seed-workbook', file) });
  const [coa, setCoa] = useState<{ title: string; code: string | null; class: string; branchCode: string | null; branchName: string | null; channelTag: string | null; templateKey: string | null; entryScope: string; beginningDebit: number; beginningCredit: number }[] | null>(null);
  const coaPreview = useMutation({ mutationFn: ({ file, sheet }: { file: File; sheet: string }) => api.upload<typeof coa>(`/api/imports/coa/preview${sheet ? `?sheet=${encodeURIComponent(sheet)}` : ''}`, file), onSuccess: (r) => setCoa(r) });
  const coaCommit = useMutation({ mutationFn: () => api.post('/api/imports/coa/commit', { year: Number(extra.coaYear || new Date().getFullYear()), rows: coa }) });
  const recon = useMutation({ mutationFn: (file: File) => api.upload<unknown[]>('/api/imports/reconcile', file) });
  return <div className="space-y-4">
    <h1 className="text-2xl font-bold tracking-tight text-navy">Excel Imports</h1>
    {can('product.create') && <Card title="Seed workbook: inventory.xlsm → products + tiers (sheet DAILY INVTY COUNT)"><p className="mb-2 text-sm text-slate-600">B = name, C = FRANCHISEE, D = DEALER, E = RETAILER (SRP), F = COST. SKUs GWS-000001… are generated; ambiguous rows are flagged for Head Auditor review.</p><input type="file" accept=".xlsx,.xlsm" onChange={(e) => e.target.files?.[0] && seed.mutate(e.target.files[0])} />{seed.data ? <pre className="mt-2 rounded bg-slate-50 p-2 text-xs">{JSON.stringify(seed.data, null, 1)}</pre> : null}<ErrorBox error={seed.error} /></Card>}
    <Card title="Templates"><div className="grid gap-3 md:grid-cols-2">{KINDS.filter((k) => can(k.perm)).map((k) => <div key={k.kind} className="rounded border p-3 text-sm"><div className="flex items-center justify-between"><span className="font-medium">{k.label}</span><Button size="sm" variant="outline" onClick={() => api.download(`/api/imports/templates/${k.kind}.xlsx`, `${k.kind}-template.xlsx`)}>Template</Button></div>{k.extra && <Field label={k.extra} className="mt-2"><Input value={extra[k.kind] ?? ''} onChange={(e) => setExtra({ ...extra, [k.kind]: e.target.value })} placeholder={k.kind === 'opening-stock' ? 'YYYY-MM-DD' : 'YYYY'} /></Field>}<input className="mt-2 block text-xs" type="file" accept=".xlsx" onChange={(e) => e.target.files?.[0] && run.mutate({ endpoint: `${k.endpoint}${k.query ? k.query(extra[k.kind] ?? '') : ''}`, file: e.target.files[0] })} />{results[`${k.endpoint}${k.query ? k.query(extra[k.kind] ?? '') : ''}`] !== undefined ? <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(results[`${k.endpoint}${k.query ? k.query(extra[k.kind] ?? '') : ''}`], null, 1)}</pre> : null}</div>)}</div><ErrorBox error={run.error} /></Card>
    {can('gl.account.edit') && <Card title="Chart of accounts import (ACCTG PROGRAM - FORMAT.xlsm) with review">
      <div className="flex flex-wrap items-end gap-2"><Field label="Sheet (BALANCE SHEET / INCOME STATEMENT, or blank for template)"><Input value={extra.coaSheet ?? ''} onChange={(e) => setExtra({ ...extra, coaSheet: e.target.value })} /></Field><Field label="Fiscal year for beginning balances"><Input value={extra.coaYear ?? ''} onChange={(e) => setExtra({ ...extra, coaYear: e.target.value })} placeholder="2026" /></Field><input type="file" accept=".xlsx,.xlsm" onChange={(e) => e.target.files?.[0] && coaPreview.mutate({ file: e.target.files[0], sheet: extra.coaSheet ?? '' })} /></div>
      {coa && <><p className="mt-2 text-sm">Review parsed branch / channel tags, then commit ({coa.length} accounts).</p><div className="max-h-96 overflow-auto"><table className="w-full text-xs"><thead className="sticky top-0 bg-slate-50"><tr><th>Code</th><th>Title</th><th>Class</th><th>Branch</th><th>Channel</th><th>Template</th><th>Scope</th></tr></thead><tbody>{coa.map((r, i) => <tr key={i} className="border-t"><td><Input className="min-h-7 w-20 text-xs" value={r.code ?? ''} onChange={(e) => setCoa(coa.map((x, k) => (k === i ? { ...x, code: e.target.value || null } : x)))} /></td><td>{r.title}</td><td><Input className="min-h-7 w-32 text-xs" value={r.class} onChange={(e) => setCoa(coa.map((x, k) => (k === i ? { ...x, class: e.target.value } : x)))} /></td><td><Input className="min-h-7 w-24 text-xs" value={r.branchCode ?? ''} onChange={(e) => setCoa(coa.map((x, k) => (k === i ? { ...x, branchCode: e.target.value || null } : x)))} /></td><td><Input className="min-h-7 w-28 text-xs" value={r.channelTag ?? ''} onChange={(e) => setCoa(coa.map((x, k) => (k === i ? { ...x, channelTag: e.target.value || null } : x)))} /></td><td>{r.templateKey ?? ''}</td><td>{r.entryScope}</td></tr>)}</tbody></table></div><Button className="mt-2" onClick={() => coaCommit.mutate()}>Commit chart of accounts</Button>{coaCommit.data ? <pre className="mt-2 rounded bg-slate-50 p-2 text-xs">{JSON.stringify(coaCommit.data, null, 1)}</pre> : null}</>}
      <ErrorBox error={coaPreview.error || coaCommit.error} /></Card>}
    {can('report.sales.all') && <Card title="Parallel-run reconciliation (system vs Excel totals per day / branch)"><p className="mb-2 text-sm text-slate-600">Upload a sheet with columns LocationCode, Date, ExcelSales, ExcelExpenses.</p><input type="file" accept=".xlsx" onChange={(e) => e.target.files?.[0] && recon.mutate(e.target.files[0])} />{recon.data ? <pre className="mt-2 max-h-80 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(recon.data, null, 1)}</pre> : null}<ErrorBox error={recon.error} /></Card>}
  </div>;
}
