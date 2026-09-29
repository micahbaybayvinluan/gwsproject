import { useAuth } from '@/lib/auth';
import { LetterheadSettings } from '@/components/LetterheadSettings';
import { PendingMaster, pendingMessage } from '@/components/PendingMaster';
import { AccountFields, missingFor } from '@/components/NewUserFields';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { Badge, Button, Card, ErrorBox, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';

interface User { id: string; username: string; email: string; fullName: string; idNumber: string | null; accountabilityAcceptedAt: string | null; lastLoginAt: string | null; active: boolean; totpEnabled: boolean; role: { key: string; name: string }; assignments: { location: { id: string; name: string } }[]; permissionOverrides: { permissionKey: string; granted: boolean }[] }

/** §5 users, roles, per-user permission overrides ("tick which information can be shared and which approvals are needed"). */
export function UsersPage() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/api/users') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<{ key: string; name: string; permissions: string[] }[]>('/api/roles') });
  const keys = useQuery({ queryKey: ['permission-keys'], queryFn: () => api.get<string[]>('/api/users/permission-keys') });
  const locations = useQuery({ queryKey: ['locations-all-typed'], queryFn: () => api.get<{ id: string; name: string; type: string }[]>('/api/locations?all=1') });
  const blank = { username: '', email: '', fullName: '', idNumber: '', roleKey: 'SALES_ASSOCIATE', password: '', locationIds: [] as string[] };
  const [f, setF] = useState(blank);
  const [sent, setSent] = useState('');
  const create = useMutation({ mutationFn: () => api.post('/api/users', { ...f, username: f.username.trim(), email: f.email.trim() }), onSuccess: (r) => { setSent(pendingMessage(r) || `Account created. Give ${f.fullName} the username "${f.username.trim()}" and the temporary password "${f.password}". They choose their own password at first sign-in.`); setF(blank); void qc.invalidateQueries({ queryKey: ['users'] }); void qc.invalidateQueries({ queryKey: ['master-pending'] }); } });
  const missing = missingFor(f, [[f.fullName.trim().length >= 3, 'the full name'], [!!f.idNumber.trim(), 'the company ID number']]);
  const [sel, setSel] = useState<User | null>(null); const [ov, setOv] = useState<Record<string, boolean | undefined>>({});
  const saveOv = useMutation({ mutationFn: () => api.put(`/api/users/${sel!.id}/overrides`, { overrides: Object.entries(ov).filter(([, v]) => v !== undefined).map(([permissionKey, granted]) => ({ permissionKey, granted })) }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }) });
  const patch = useMutation({ mutationFn: (p: Record<string, unknown>) => api.patch(`/api/users/${sel!.id}`, p), onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }) });
  const rolePerms = new Set(roles.data?.find((r) => r.key === sel?.role.key)?.permissions ?? []);
  return <div className="space-y-4">
    <h1 className="text-2xl font-bold tracking-tight text-navy">Users & Roles</h1>
    <Card title="New user (one account per person)">
      <p className="mb-4 text-sm text-slate-500">Each account belongs to one named person. The person replaces the temporary password and accepts the accountability statement at first sign-in.</p>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Field label="Full name of the person"><Input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
        <Field label="Company ID number" hint="From the person's company ID"><Input value={f.idNumber} onChange={(e) => setF({ ...f, idNumber: e.target.value })} /></Field>
        <AccountFields f={f} setF={(d) => setF({ ...f, ...d })} roles={roles.data ?? []} locations={locations.data ?? []} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3"><Button disabled={missing.length > 0 || create.isPending} onClick={() => { setSent(''); create.mutate(); }}>Create account</Button>{missing.length > 0 && <span className="text-sm text-slate-500">Still needed: {missing.join(', ')}</span>}</div>
      <ErrorBox error={create.error} />{sent && <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{sent}</p>}<div className="mt-3"><PendingMaster kind="UserAccount" label="New user accounts" /></div>
    </Card>
    <DataTable exportName="Users" data={users.data ?? []} onRowClick={(u) => { setSel(u); setOv(Object.fromEntries(u.permissionOverrides.map((o) => [o.permissionKey, o.granted]))); }} columns={[{ header: 'Username', accessorKey: 'username' }, { header: 'Name', accessorKey: 'fullName' }, { header: 'Role', accessorFn: (r) => r.role.name }, { header: 'Locations', accessorFn: (r) => r.assignments.map((a) => a.location.name).join(', ') }, { header: '2FA', cell: (c) => c.row.original.totpEnabled ? <Badge tone="green">enrolled</Badge> : <Badge>none</Badge> }, { header: 'ID no.', accessorKey: 'idNumber' }, { header: 'Accountability', cell: (c) => c.row.original.accountabilityAcceptedAt ? <Badge tone="green">accepted {c.row.original.accountabilityAcceptedAt.slice(0, 10)}</Badge> : <Badge tone="amber">not yet</Badge> }, { header: 'Last sign-in', accessorFn: (r) => (r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleString() : '—') }, { header: 'Active', cell: (c) => <Badge tone={c.row.original.active ? 'green' : 'red'}>{c.row.original.active ? 'yes' : 'no'}</Badge> }, { header: 'Overrides', accessorFn: (r) => r.permissionOverrides.length }]} />
    {sel && <Card title={`${sel.fullName} — permissions (role ${sel.role.name} ± overrides)`} actions={<><Link className="self-center text-sm text-brand underline" to={`/audit-log?userId=${sel.id}`}>Activity</Link><Button size="sm" variant="outline" onClick={() => { const v = prompt(`Company ID no. of ${sel.fullName}`, sel.idNumber ?? ''); if (v) patch.mutate({ idNumber: v }); }}>Set ID no.</Button><Button size="sm" variant="outline" onClick={() => patch.mutate({ active: !sel.active })}>{sel.active ? 'Deactivate' : 'Activate'}</Button><Button size="sm" variant="outline" onClick={() => patch.mutate({ resetTotp: true })}>Reset 2FA</Button><Button size="sm" variant="outline" onClick={() => { const p = prompt('New temporary password (10+ chars)'); if (p) patch.mutate({ resetPassword: p }); }}>Reset password</Button><Button size="sm" onClick={() => saveOv.mutate()}>Save overrides</Button></>}>
      <div className="grid gap-1 md:grid-cols-3 lg:grid-cols-4">{keys.data?.map((k) => { const fromRole = rolePerms.has(k); const o = ov[k]; const eff = o ?? fromRole; return <label key={k} className={`flex items-center gap-2 rounded px-2 py-1 text-xs ${o !== undefined ? 'bg-amber-50' : ''}`}><input type="checkbox" checked={eff} onChange={(e) => setOv({ ...ov, [k]: e.target.checked === fromRole ? undefined : e.target.checked })} /><span className={fromRole ? '' : 'text-slate-500'}>{k}</span>{o !== undefined && <Badge tone="amber">{o ? 'granted' : 'revoked'}</Badge>}</label>; })}</div>
      <ErrorBox error={saveOv.error || patch.error} />
      <Logins userId={sel.id} />
    </Card>}
  </div>;
}

function Logins({ userId }: { userId: string }) {
  const q = useQuery({ queryKey: ['logins', userId], queryFn: () => api.get<{ id: string; createdAt: string; revokedAt: string | null; ip: string | null; userAgent: string | null }[]>(`/api/users/${userId}/logins`) });
  if (!q.data?.length) return null;
  return <div className="mt-4"><div className="text-xs uppercase text-slate-500">Recent sign-ins (one device at a time)</div><table className="w-full text-xs"><tbody>{q.data.map((l) => <tr key={l.id} className="border-t"><td className="py-1 pr-2">{new Date(l.createdAt).toLocaleString()}</td><td className="pr-2">{l.ip ?? ''}</td><td className="max-w-md truncate pr-2 text-slate-500">{l.userAgent ?? ''}</td><td>{l.revokedAt ? <Badge>ended {new Date(l.revokedAt).toLocaleString()}</Badge> : <Badge tone="green">active / expired</Badge>}</td></tr>)}</tbody></table></div>;
}

export function AuditLogPage() {
  const [sp] = useSearchParams();
  const [f, setF] = useState({ entityType: '', userId: sp.get('userId') ?? '', from: '', to: '' });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ id: string; username: string; fullName: string; idNumber: string | null }[]>('/api/users'), retry: false });
  const q = useQuery({ queryKey: ['audit', f], queryFn: () => api.get<{ id: string; at: string; action: string; entityType: string; entityId: string | null; ip: string | null; before: unknown; after: unknown; user: { username: string; fullName: string; idNumber: string | null; role?: { name: string } } | null }[]>(`/api/audit-log?entityType=${f.entityType}&userId=${f.userId}&from=${f.from}&to=${f.to}`) });
  const [open, setOpen] = useState<string | null>(null);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Audit Log</h1><Field label="Person"><Select value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}><option value="">Everyone</option>{users.data?.map((u) => <option key={u.id} value={u.id}>{u.fullName} ({u.username}{u.idNumber ? ` · ${u.idNumber}` : ''})</option>)}{f.userId && !users.data && <option value={f.userId}>selected person</option>}</Select></Field><Field label="Entity"><Input value={f.entityType} onChange={(e) => setF({ ...f, entityType: e.target.value })} placeholder="SalesDoc" /></Field><Field label="From"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field><Field label="To"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field></div>
    <Card><ul className="divide-y text-sm">{q.data?.map((l) => <li key={l.id} className="py-1"><button className="flex w-full flex-wrap gap-2 text-left" onClick={() => setOpen(open === l.id ? null : l.id)}><span className="text-slate-500">{new Date(l.at).toLocaleString()}</span><span className="font-medium">{l.user ? `${l.user.fullName} (${l.user.username}${l.user.idNumber ? ` · ${l.user.idNumber}` : ''})` : 'system'}</span><Badge>{l.action}</Badge><span>{l.entityType} {l.entityId?.slice(0, 8)}</span><span className="ml-auto text-xs text-slate-400">{l.ip}</span></button>{open === l.id && <div className="grid gap-2 md:grid-cols-2"><pre className="overflow-auto rounded bg-slate-50 p-2 text-xs">before: {JSON.stringify(l.before, null, 1)}</pre><pre className="overflow-auto rounded bg-slate-50 p-2 text-xs">after: {JSON.stringify(l.after, null, 1)}</pre></div>}</li>)}</ul></Card>
  </div>;
}

/** §6.1 thresholds, §7.4 consignment setting, Phase 2 posting switch, session timeouts, attachment rules. */
export function SettingsPage() {
  const qc = useQueryClient(); const { me } = useAuth();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Record<string, unknown>>('/api/settings') });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const save = useMutation({ mutationFn: () => api.put('/api/settings', Object.fromEntries(Object.entries(edits).map(([k, v]) => [k, parse(v)]))), onSuccess: () => { setEdits({}); void qc.invalidateQueries({ queryKey: ['settings'] }); } });
  const parse = (v: string) => { try { return JSON.parse(v); } catch { return v; } };
  const HELP: Record<string, string> = { 'approval.cost_unchanged_auto_hours': 'COST_ON_RECEIVING auto-approves after N hours when every product exists with unchanged cost', 'approval.transfer_internal_auto_max': 'Auto-approve restock transfers from warehouse ≤ ₱X at cost (null = off)', 'approval.transfer_franchise_auto_max': 'Auto-approve transfers to franchise ≤ ₱X (null = off)', 'approval.special_price_auto_discount_pct': 'Discount ≤ N% auto-approved (default 0)', consignment_in_on_balance_sheet: 'false = off-balance-sheet until sold (correct accounting); true = legacy treatment', 'gl.auto_posting_enabled': 'Phase 2 switch: post R1–R14 journal entries automatically', 'gl.ni_allocation_basis': 'REVENUE (pro-rata) or EQUAL', 'attachments.required': 'Required-attachment rules per document type', 'alerts.near_expiry_days': 'Sales of batches expiring within N days show a warning', 'discrepancy.window_days': 'Days before a discrepancy case finalizes into a charge form' };
  return <div className="space-y-4">
    {me?.roleKey === 'ADMIN' && <LetterheadSettings />}{me?.roleKey === 'ADMIN' && q.data && <CustomerMessageSettings settings={q.data} />}<h1 className="text-2xl font-bold tracking-tight text-navy">Settings</h1>
    <Card actions={<Button disabled={!Object.keys(edits).length} onClick={() => save.mutate()}>Save</Button>}><table className="w-full text-sm"><tbody>{Object.entries(q.data ?? {}).filter(([k]) => !k.startsWith('followup.')).map(([k, v]) => <tr key={k} className="border-t"><td className="py-2 pr-4 align-top"><div className="font-mono text-xs">{k}</div><div className="text-xs text-slate-500">{HELP[k]}</div></td><td className="py-2"><Input value={edits[k] ?? (typeof v === 'string' ? v : JSON.stringify(v))} onChange={(e) => setEdits({ ...edits, [k]: e.target.value })} /></td></tr>)}</tbody></table><ErrorBox error={save.error} /></Card>
  </div>;
}

/** The Owner's message to customers who may have finished their supplements, and whether it goes out by itself. */
function CustomerMessageSettings({ settings }: { settings: Record<string, unknown> }) {
  const qc = useQueryClient();
  const init = () => ({ sms: String(settings['followup.sms_template'] ?? ''), subject: String(settings['followup.email_subject'] ?? ''), email: String(settings['followup.email_template'] ?? ''), autoSms: !!settings['followup.auto_sms'], autoEmail: !!settings['followup.auto_email'] });
  const [f, setF] = useState(init);
  const save = useMutation({ mutationFn: () => api.put('/api/settings', { 'followup.sms_template': f.sms, 'followup.email_subject': f.subject, 'followup.email_template': f.email, 'followup.auto_sms': f.autoSms, 'followup.auto_email': f.autoEmail }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['settings'] }) });
  return <Card title="Customer re-order messages (SMS and email)">
    <p className="mb-3 text-sm text-slate-600">Sent to customers when their supplement is probably finished (days to consume on the product × quantity bought). Use <code>{'{customer}'}</code>, <code>{'{product}'}</code>, <code>{'{store}'}</code> and <code>{'{storePhone}'}</code> (the phone on the letterhead); they are filled in for each customer. Staff can still edit each message before sending.</p>
    <div className="grid gap-3 md:grid-cols-2">
      <Field label="SMS message" hint={`${f.sms.length} characters (160 per SMS)`}><Textarea rows={4} value={f.sms} onChange={(e) => setF({ ...f, sms: e.target.value })} /></Field>
      <div className="space-y-2"><Field label="Email subject"><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field><Field label="Email message"><Textarea rows={5} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field></div>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={f.autoSms} onChange={(e) => setF({ ...f, autoSms: e.target.checked })} /> Send the SMS automatically</label><label className="flex items-center gap-2"><input type="checkbox" checked={f.autoEmail} onChange={(e) => setF({ ...f, autoEmail: e.target.checked })} /> Send the email automatically</label><Button onClick={() => save.mutate()} disabled={save.isPending}>Save messages</Button>{save.isSuccess && <span className="text-emerald-700">Saved</span>}</div>
    <p className="mt-2 text-xs text-slate-500">Automatic messages go out at 9 AM on the day the product is probably finished, and the store is reminded to call at the same time. SMS needs an SMS account (Semaphore: SEMAPHORE_API_KEY in api/.env); email needs SMTP_URL in api/.env. Until they are set, messages are recorded as “not set up” and nothing is sent.</p>
    <ErrorBox error={save.error} />
  </Card>;
}
