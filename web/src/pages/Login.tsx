import { BrandMark } from '@/components/Brand';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, setToken } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, ErrorBox, Field, Input } from '@/components/ui/primitives';
import { IconInput } from '@/components/ui/widgets';
import { Lock, User } from 'lucide-react';

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
  return <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
    <div className="relative hidden overflow-hidden grad-brand lg:block">
      <div className="absolute -left-24 -top-24 size-96 rounded-full bg-white/10" /><div className="absolute -bottom-32 right-[-6rem] size-[30rem] rounded-full bg-white/10" /><div className="absolute bottom-24 left-16 size-40 rounded-full bg-white/10" />
      <div className="relative flex h-full flex-col justify-between p-12 text-white">
        <div className="w-fit rounded-3xl bg-white p-4 shadow-xl"><BrandMark size="lg" /></div>
        <div><h1 className="text-5xl font-extrabold leading-tight tracking-tight">Stronger stores,<br />every day.</h1><p className="mt-4 max-w-md text-lg text-white/85">Sales, stock, approvals, HR and accounting for every Get Wheysted branch and franchise, in one place.</p></div>
        <div className="text-xs text-white/70">GWS-ERP · Philippines</div>
      </div>
    </div>
    <div className="flex items-center justify-center p-4 sm:p-8">
    <Card className="w-full max-w-md" title={<span className="lg:hidden"><BrandMark size="sm" /></span>}>
      <div className="mb-5 hidden lg:block"><div className="text-2xl font-bold tracking-tight text-navy">Welcome back</div><div className="text-sm text-slate-500">Sign in with your personal account.</div></div>
      {sp.get('replaced') && step === 'creds' && <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">You were signed out because your account was signed in on another device. Accounts are personal: if that was not you, tell the Admin and change your password.</p>}
      {step === 'creds' && <form onSubmit={submitCreds} className="space-y-4" data-testid="login-form">
        <Field label="Username or email"><IconInput icon={<User />} autoFocus value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" name="identifier" placeholder="username" /></Field>
        <Field label="Password"><IconInput icon={<Lock />} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" name="password" placeholder="password" /></Field>
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
    </div>
  </div>;
}
