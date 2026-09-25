import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, ErrorBox, Field, Input } from './ui/primitives';

/**
 * Accounts are personal (owner rule). Before any work the person
 * 1) replaces the temporary password the Admin gave them, and
 * 2) accepts that the account is theirs alone and everything done under it is their responsibility.
 */
export function AccountGate() {
  const { me, refresh, logout } = useAuth();
  const [pw, setPw] = useState({ current: '', next: '', again: '' }); const [agree, setAgree] = useState(false);
  const change = useMutation({ mutationFn: () => { if (pw.next !== pw.again) throw new Error('The two new passwords do not match'); return api.post('/api/auth/password', { current: pw.current, next: pw.next }); }, onSuccess: () => refresh() });
  const accept = useMutation({ mutationFn: () => api.post('/api/auth/accept-accountability'), onSuccess: () => refresh() });
  if (!me) return null;
  return <div className="flex min-h-full items-center justify-center bg-slate-100 p-4">
    <Card className="w-full max-w-lg" title={<span className="text-brand">GWS-ERP · {me.fullName}</span>}>
      {me.mustChangePassword ? <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); change.mutate(); }}>
        <p className="text-sm">Set your own password. It is personal: never tell it to anyone, including co-workers and supervisors.</p>
        <Field label="Temporary password"><Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
        <Field label="New password (10+ characters)"><Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
        <Field label="New password again"><Input type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} /></Field>
        <ErrorBox error={change.error} />
        <Button className="w-full" disabled={change.isPending || pw.next.length < 10}>Save my password</Button>
      </form> : <div className="space-y-3 text-sm">
        <p className="font-medium">Account accountability</p>
        <p className="rounded-md border border-slate-300 bg-slate-50 p-3 leading-relaxed" data-testid="accountability-statement">{me.accountabilityStatement}</p>
        <ul className="list-disc pl-5 text-slate-600">
          <li>Only one device can be signed in to this account at a time. Signing in somewhere else signs this device out, and you are notified.</li>
          <li>Every sale, transfer, receiving, approval, edit and export is recorded with your name{me.idNumber ? ` and ID ${me.idNumber}` : ''}.</li>
        </ul>
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> <span>I am {me.fullName} and I accept this statement.</span></label>
        <ErrorBox error={accept.error} />
        <div className="flex gap-2"><Button className="flex-1" disabled={!agree || accept.isPending} onClick={() => accept.mutate()}>I accept</Button><Button variant="outline" onClick={() => void logout()}>This is not me — sign out</Button></div>
      </div>}
    </Card>
  </div>;
}
