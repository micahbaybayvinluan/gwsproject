import { useEffect, useState } from 'react';
import { BrandMark } from '@/components/Brand';
import { QrCode } from '@/components/QrCode';

const BASE = import.meta.env.VITE_API_URL || '';
const KEY = 'gws_member_token';
const getToken = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const setTok = (t: string | null) => { try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch { /* private mode */ } };
async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const t = getToken();
  const res = await fetch(`${BASE}${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); const json = text ? JSON.parse(text) : null;
  if (!res.ok) { const e = new Error(typeof json?.message === 'string' ? json.message : Array.isArray(json?.message) ? json.message.join(', ') : `Something went wrong (${res.status})`) as Error & { status: number }; e.status = res.status; throw e; }
  return json as T;
}
const peso = (v: number) => `₱${v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
interface Me { memberNo: string; fullName: string; phone: string | null; email: string | null; birthday: string | null; emailOptIn: boolean; smsOptIn: boolean; qr: string; joined: string; stats: { orders: number; spent: number; lastPurchase: string | null; favoriteProduct: string | null }; purchases: { id: string; date: string; drSiNo: string; branch: string; total: number; items: { name: string; qty: number; price: number; amount: number; freebie: boolean }[] }[] }

const field = 'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-200';
const btn = 'w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-600 px-4 py-3 text-base font-bold text-white shadow disabled:opacity-50';

/** The Wheysted members' own page (public, phone-first): sign up, sign in, show the QR card at the counter, see my purchases. */
export function PortalPage() {
  const [signedIn, setSignedIn] = useState(!!getToken());
  const [me, setMe] = useState<Me | null>(null); const [err, setErr] = useState('');
  const load = () => call<Me>('GET', '/api/portal/me').then((m) => { setMe(m); setErr(''); }).catch((e: Error & { status?: number }) => { if (e.status === 401) { setTok(null); setSignedIn(false); } else setErr(e.message); });
  useEffect(() => { if (signedIn) void load(); }, [signedIn]);
  return <div className="min-h-screen bg-gradient-to-b from-orange-50 to-slate-100 px-4 py-6">
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex items-center justify-between"><div className="flex items-center gap-2"><BrandMark /><div className="text-sm font-extrabold tracking-tight text-slate-900">Get <span className="text-rose-600">Wheysted</span><div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Member page</div></div></div>{signedIn && <button className="text-sm text-slate-500 underline" onClick={() => { setTok(null); setSignedIn(false); setMe(null); }}>Sign out</button>}</div>
      {!signedIn ? <Auth onDone={() => setSignedIn(true)} /> : me ? <Home me={me} reload={load} /> : <p className="py-10 text-center text-slate-500">{err || 'Loading…'}</p>}
    </div>
  </div>;
}

function Auth({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'in' | 'up'>('in'); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [f, setF] = useState({ identifier: '', password: '', fullName: '', phone: '', email: '', birthday: '', memberNo: '', emailOptIn: true, smsOptIn: true, agree: false });
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const r = mode === 'in' ? await call<{ token: string }>('POST', '/api/portal/login', { identifier: f.identifier, password: f.password }) : await call<{ token: string }>('POST', '/api/portal/signup', { fullName: f.fullName, phone: f.phone, email: f.email, password: f.password, birthday: f.birthday, memberNo: f.memberNo || undefined, emailOptIn: f.emailOptIn, smsOptIn: f.smsOptIn, agree: f.agree });
      setTok(r.token); onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const set = (k: string, v: string | boolean) => setF({ ...f, [k]: v });
  return <div className="rounded-3xl bg-white p-5 shadow-xl">
    <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm font-bold"><button className={`rounded-lg py-2 ${mode === 'in' ? 'bg-white shadow' : 'text-slate-500'}`} onClick={() => { setMode('in'); setErr(''); }}>Sign in</button><button className={`rounded-lg py-2 ${mode === 'up' ? 'bg-white shadow' : 'text-slate-500'}`} onClick={() => { setMode('up'); setErr(''); }}>Become a member</button></div>
    <div className="space-y-3">
      {mode === 'in' ? <>
        <input className={field} placeholder="Mobile number, email or member number" value={f.identifier} onChange={(e) => set('identifier', e.target.value)} autoComplete="username" />
        <input className={field} type="password" placeholder="Password" value={f.password} onChange={(e) => set('password', e.target.value)} autoComplete="current-password" onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
      </> : <>
        <p className="text-sm text-slate-600">Join Wheysted: get your own QR card, see every purchase you made with us, and hear about offers.</p>
        <input className={field} placeholder="Full name" value={f.fullName} onChange={(e) => set('fullName', e.target.value)} autoComplete="name" />
        <input className={field} type="tel" inputMode="tel" placeholder="Mobile number" value={f.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" />
        <input className={field} type="email" placeholder="Email (optional)" value={f.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" />
        <label className="block text-xs text-slate-500">Birthday (optional, for a birthday treat)<input className={`${field} mt-1`} type="date" value={f.birthday} onChange={(e) => set('birthday', e.target.value)} /></label>
        <input className={field} type="password" placeholder="Password (at least 8 characters)" value={f.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
        <input className={field} placeholder="Member number, if the store already gave you one (WHY-…)" value={f.memberNo} onChange={(e) => set('memberNo', e.target.value)} />
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={f.emailOptIn} onChange={(e) => set('emailOptIn', e.target.checked)} /> Send me offers by email</label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={f.smsOptIn} onChange={(e) => set('smsOptIn', e.target.checked)} /> Send me offers by SMS</label>
        <label className="flex items-start gap-2 text-xs text-slate-600"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={f.agree} onChange={(e) => set('agree', e.target.checked)} /> I agree that Get Wheysted Supplements keeps my name, contact details and purchases to run my membership, in line with the Data Privacy Act. I can ask to be removed or unsubscribe any time.</label>
      </>}
      {err && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{err}</p>}
      <button className={btn} disabled={busy || (mode === 'in' ? !f.identifier || !f.password : !f.fullName || !f.phone || f.password.length < 8 || !f.agree)} onClick={() => void submit()}>{busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Create my account'}</button>
      {mode === 'in' && <p className="text-center text-xs text-slate-500">Forgot your password? Ask any Wheysted store to reset it.</p>}
    </div>
  </div>;
}

function Home({ me, reload }: { me: Me; reload: () => void }) {
  const [tab, setTab] = useState<'card' | 'buys' | 'me'>('card'); const [open, setOpen] = useState<string | null>(null);
  return <div className="space-y-4">
    <div className="grid grid-cols-3 gap-1 rounded-xl bg-white p-1 text-sm font-bold shadow">{([['card', 'My card'], ['buys', 'My purchases'], ['me', 'My details']] as const).map(([k, l]) => <button key={k} className={`rounded-lg py-2 ${tab === k ? 'bg-gradient-to-r from-orange-500 to-rose-600 text-white' : 'text-slate-500'}`} onClick={() => setTab(k)}>{l}</button>)}</div>
    {tab === 'card' && <div className="rounded-3xl bg-white p-6 text-center shadow-xl">
      <div className="text-xs font-bold uppercase tracking-widest text-rose-600">Wheysted member</div><div className="mt-1 text-2xl font-extrabold text-slate-900">{me.fullName}</div>
      <div className="mx-auto my-4 w-fit rounded-2xl border-2 border-rose-600 p-3"><QrCode value={me.qr} size={240} /></div>
      <div className="text-xl font-extrabold tracking-wider text-slate-900">{me.memberNo}</div><p className="mt-1 text-sm text-slate-500">Show this at the counter so your purchase goes on your account.</p>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-slate-50 p-2"><div className="text-lg font-bold">{me.stats.orders}</div><div className="text-[11px] text-slate-500">purchases</div></div><div className="rounded-xl bg-slate-50 p-2"><div className="text-lg font-bold">{peso(me.stats.spent)}</div><div className="text-[11px] text-slate-500">total</div></div><div className="rounded-xl bg-slate-50 p-2"><div className="truncate text-sm font-bold">{me.stats.favoriteProduct ?? '—'}</div><div className="text-[11px] text-slate-500">your favorite</div></div></div>
    </div>}
    {tab === 'buys' && <div className="space-y-2">{me.purchases.length ? me.purchases.map((p) => <div key={p.id} className="rounded-2xl bg-white p-4 shadow"><button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(open === p.id ? null : p.id)}><div className="flex-1"><div className="font-bold text-slate-900">{p.date}</div><div className="text-xs text-slate-500">{p.branch} · {p.drSiNo}</div></div><div className="font-bold">{peso(p.total)}</div></button>{open === p.id && <ul className="mt-2 divide-y border-t text-sm">{p.items.map((i, k) => <li key={k} className="flex justify-between gap-2 py-1.5"><span>{i.qty}× {i.name}{i.freebie ? ' (free)' : ''}</span><span className="text-slate-600">{peso(i.amount)}</span></li>)}</ul>}</div>) : <p className="rounded-2xl bg-white p-6 text-center text-slate-500 shadow">No purchases on your account yet. Show your card at the counter when you buy.</p>}</div>}
    {tab === 'me' && <Details me={me} reload={reload} />}
  </div>;
}

function Details({ me, reload }: { me: Me; reload: () => void }) {
  const [f, setF] = useState({ fullName: me.fullName, email: me.email ?? '', birthday: me.birthday ?? '', emailOptIn: me.emailOptIn, smsOptIn: me.smsOptIn }); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [pw, setPw] = useState({ current: '', next: '' });
  const run = async (fn: () => Promise<unknown>, ok: string) => { setErr(''); setMsg(''); try { await fn(); setMsg(ok); reload(); } catch (e) { setErr((e as Error).message); } };
  return <div className="space-y-4 rounded-3xl bg-white p-5 shadow-xl">
    <div className="space-y-3"><input className={field} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} placeholder="Full name" /><div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">Mobile: {me.phone ?? '—'} (to change it, ask the store)</div>
      <input className={field} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Email" /><input className={field} type="date" value={f.birthday} onChange={(e) => setF({ ...f, birthday: e.target.value })} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={f.emailOptIn} onChange={(e) => setF({ ...f, emailOptIn: e.target.checked })} /> Offers by email</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={f.smsOptIn} onChange={(e) => setF({ ...f, smsOptIn: e.target.checked })} /> Offers by SMS</label>
      <button className={btn} onClick={() => void run(() => call('POST', '/api/portal/me', { fullName: f.fullName, email: f.email || null, birthday: f.birthday || null, emailOptIn: f.emailOptIn, smsOptIn: f.smsOptIn }), 'Saved.')}>Save my details</button></div>
    <div className="space-y-3 border-t pt-4"><div className="text-sm font-bold">Change password</div><input className={field} type="password" placeholder="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /><input className={field} type="password" placeholder="New password (8+ characters)" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /><button className={btn} disabled={!pw.current || pw.next.length < 8} onClick={() => void run(async () => { await call('POST', '/api/portal/password', pw); setPw({ current: '', next: '' }); }, 'Password changed.')}>Change password</button></div>
    {msg && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{msg}</p>}{err && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{err}</p>}
  </div>;
}
