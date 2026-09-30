import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Button, ErrorBox, Field, Input, Modal } from '@/components/ui/primitives';

/** Anyone may change their own password at any time: accounts are personal and the person is answerable for them (owner request 2026-09-30). */
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  const save = useMutation({ mutationFn: () => { if (pw.next !== pw.again) throw new Error('The two new passwords do not match'); return api.post('/api/auth/password', { current: pw.current, next: pw.next }); } });
  return <Modal title="Change my password" onClose={onClose}>
    {save.isSuccess ? <div className="space-y-3"><p className="text-sm text-emerald-700">Your password was changed. Use it the next time you sign in.</p><div className="flex justify-end"><Button onClick={onClose}>Done</Button></div></div>
      : <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <p className="text-sm text-slate-600">Your account is personal and everything done under it is your responsibility. Never tell your password to anyone, including co-workers, supervisors, HR or the Owner. Nobody can see it; if you forget it, the Owner can only give you a new temporary one.</p>
        <Field label="Current password"><Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
        <Field label="New password (10+ characters)"><Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
        <Field label="New password again"><Input type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} /></Field>
        <ErrorBox error={save.error} />
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.isPending || !pw.current || pw.next.length < 10}>Change password</Button></div>
      </form>}
  </Modal>;
}
