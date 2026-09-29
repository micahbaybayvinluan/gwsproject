import { locLabel } from '@/lib/utils';
import { Button, Field, Input, Select } from '@/components/ui/primitives';

/** Roles that work at exactly one branch, and roles limited to the branches ticked (same lists as the API). */
export const SINGLE_BRANCH_ROLES = ['SALES_ASSOCIATE', 'FRANCHISE_SALES_ASSOCIATE', 'FRANCHISE_OWNER'];
export const BRANCH_ROLES = [...SINGLE_BRANCH_ROLES, 'WAREHOUSE_IN_CHARGE', 'WAREHOUSE_ASSOCIATE'];

/** A temporary password that is easy to read out: no look-alike characters, 12 characters. */
export function generatePassword() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz', digits = '23456789';
  const pick = (s: string) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  return `Gws-${Array.from({ length: 4 }, () => pick(letters)).join('')}-${Array.from({ length: 4 }, () => pick(digits)).join('')}`;
}

export interface AccountDraft { username: string; email: string; roleKey: string; password: string; locationIds: string[] }

/** What still has to be filled in before the account can be sent; empty when complete. */
export function missingFor(f: AccountDraft, extra: [boolean, string][] = []) {
  const out: string[] = [];
  for (const [ok, label] of extra) if (!ok) out.push(label);
  if (f.username.trim().length < 3) out.push('a username (3+ characters)');
  else if (!/^[A-Za-z0-9._-]+$/.test(f.username.trim())) out.push('a username without spaces');
  if (f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim())) out.push('a valid email (or leave it empty)');
  if (f.password.length < 10) out.push(`a temporary password of 10+ characters (now ${f.password.length})`);
  if (SINGLE_BRANCH_ROLES.includes(f.roleKey) && f.locationIds.length !== 1) out.push('the branch');
  if (BRANCH_ROLES.includes(f.roleKey) && !SINGLE_BRANCH_ROLES.includes(f.roleKey) && f.locationIds.length === 0) out.push('at least one branch');
  return out;
}

/** Username, email, role, branch and temporary password, with labels and hints; shared by Admin and HR. */
export function AccountFields({ f, setF, roles, locations }: { f: AccountDraft; setF: (f: AccountDraft) => void; roles: { key: string; name: string }[]; locations: { id: string; name: string; type?: string }[] }) {
  // franchise roles: franchises; warehouse roles: the warehouse; sales associates: company branches and the warehouse counter
  const allowed = f.roleKey.startsWith('FRANCHISE') ? ['FRANCHISE'] : f.roleKey.startsWith('WAREHOUSE') ? ['WAREHOUSE'] : ['BRANCH', 'WAREHOUSE'];
  const branches = locations.filter((l) => allowed.includes(l.type ?? ''));
  const setRole = (roleKey: string) => {
    const ok = locations.filter((l) => (roleKey.startsWith('FRANCHISE') ? l.type === 'FRANCHISE' : roleKey.startsWith('WAREHOUSE') ? l.type === 'WAREHOUSE' : ['BRANCH', 'WAREHOUSE'].includes(l.type ?? ''))).map((l) => l.id);
    let ids = f.locationIds.filter((id) => ok.includes(id));
    if (SINGLE_BRANCH_ROLES.includes(roleKey)) ids = ids.slice(0, 1);
    if (!ids.length && ok.length === 1 && BRANCH_ROLES.includes(roleKey)) ids = ok; // only one choice: pick it
    setF({ ...f, roleKey, locationIds: BRANCH_ROLES.includes(roleKey) ? ids : [] });
  };
  const single = SINGLE_BRANCH_ROLES.includes(f.roleKey), multi = BRANCH_ROLES.includes(f.roleKey) && !single;
  return <>
    <Field label="Username" hint="Used to sign in. No spaces, e.g. juan.cruz"><Input autoComplete="off" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.replace(/\s/g, '') })} /></Field>
    <Field label="Email (optional)" hint="Leave empty if the person has none"><Input type="email" autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
    <Field label="Role"><Select value={f.roleKey} onChange={(e) => setRole(e.target.value)}>{[...roles].sort((a, b) => a.name.localeCompare(b.name)).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</Select></Field>
    {single && <Field label="Branch"><Select value={f.locationIds[0] ?? ''} onChange={(e) => setF({ ...f, locationIds: e.target.value ? [e.target.value] : [] })}><option value="">— choose the branch —</option>{branches.map((l) => <option key={l.id} value={l.id}>{locLabel(l)}</option>)}</Select></Field>}
    {multi && <Field label="Branches" hint="Tick where this person works"><div className="flex flex-wrap gap-x-4 gap-y-1 rounded-xl border border-slate-200 p-2.5">{branches.map((l) => <label key={l.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={f.locationIds.includes(l.id)} onChange={(e) => setF({ ...f, locationIds: e.target.checked ? [...f.locationIds, l.id] : f.locationIds.filter((x) => x !== l.id) })} />{l.name}</label>)}</div></Field>}
    {!single && !multi && <Field label="Branch"><div className="rounded-xl border border-dashed border-slate-200 px-3 py-2.5 text-sm text-slate-500">Not needed: this role works for the whole company.</div></Field>}
    <Field label="Temporary password" hint={f.password.length >= 10 ? 'Give this to the person; they choose their own at first sign-in.' : `At least 10 characters (now ${f.password.length})`}>
      <div className="flex gap-2"><Input autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /><Button type="button" variant="outline" onClick={() => setF({ ...f, password: generatePassword() })}>Generate</Button></div>
    </Field>
  </>;
}
