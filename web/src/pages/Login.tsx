import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, setToken } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, ErrorBox, Field, Input } from '@/components/ui/primitives';

/** Username/email + password, then TOTP (mandatory for Admin, External Auditor, Head Auditor, Accounting Head). */
export function LoginPage() {
  const nav = useNavigate(); const { refresh } = useAuth(); const [sp] = useSearchParams();
  const [step, setStep] = useState<'creds' | 'totp' | 'enroll'>(sp.get('totp') ? 'totp' : 'creds');
  const [identifier, setIdentifier] = useState(''); const [password, setPassword] = useState(''); const [code, setCode] = useState(''); const [secret, setSecret] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const submitCreds = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { const r = await api.post<{ token: string; totpRequired: boolean; totpEnrolled: boolean }>('/api/auth/login', { identifier, password }); setToken(r.token); if (r.totpRequired) { if (!r.totpEnrolled) { setSecret(await api.post('/api/auth/totp/setup')); setStep('enroll'); } else setStep('totp'); } else { await refresh(); nav('/'); } }
    catch (err) { setError(err); } finally { setBusy(false); }
  };
  const submitTotp = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setError(null); try { await api.post('/api/auth/totp/verify', { code }); await refresh(); nav('/'); } catch (err) { setError(err); } finally { setBusy(false); } };
  return <div className="flex min-h-full items-center justify-center bg-slate-100 p-4">
    <Card className="w-full max-w-sm" title={<span className="text-brand">GWS-ERP</span>}>
      {sp.get('replaced') && step === 'creds' && <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">You were signed out because your account was signed in on another device. Accounts are personal: if that was not you, tell the Admin and change your password.</p>}
      {step === 'creds' && <form onSubmit={submitCreds} className="space-y-4" data-testid="login-form">
        <Field label="Username or email"><Input autoFocus value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" name="identifier" /></Field>
        <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" name="password" /></Field>
        <ErrorBox error={error} />
        <Button className="w-full" size="lg" disabled={busy}>Sign in</Button>
      </form>}
      {step === 'enroll' && secret && <div className="space-y-3 text-sm">
        <p>Two-factor authentication is required for your role. Add this secret to Google Authenticator / Authy, then enter the 6-digit code.</p>
        <code className="block break-all rounded bg-slate-100 p-2 text-xs">{secret.secret}</code>
        <a className="text-brand underline" href={secret.otpauthUrl}>Open in authenticator app</a>
        <form onSubmit={submitTotp} className="space-y-3"><Field label="6-digit code"><Input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} /></Field><ErrorBox error={error} /><Button className="w-full" disabled={busy}>Verify & enrol</Button></form>
      </div>}
      {step === 'totp' && <form onSubmit={submitTotp} className="space-y-4">
        <p className="text-sm">Enter the 6-digit code from your authenticator app.</p>
        <Field label="Code"><Input autoFocus inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        <ErrorBox error={error} />
        <Button className="w-full" disabled={busy}>Verify</Button>
        <button type="button" className="w-full text-xs text-slate-500 underline" onClick={() => { setToken(null); setStep('creds'); }}>Use a different account</button>
      </form>}
    </Card>
  </div>;
}
