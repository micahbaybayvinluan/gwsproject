import { useEffect, useState } from 'react';
import { BrandMark } from '@/components/Brand';

const BASE = import.meta.env.VITE_API_URL || '';
async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(typeof json?.message === 'string' ? json.message : 'Something went wrong');
  return json as T;
}
interface View { member: string; date: string; drSiNo: string; branch: string; items: { productId: string; name: string }[]; answered: boolean }

/** The 20-second rating a member opens from the link we send (public page, no sign-in). */
export function SurveyPage() {
  const token = new URLSearchParams(window.location.search).get('t') ?? '';
  const [v, setV] = useState<View | null>(null); const [err, setErr] = useState(''); const [rating, setRating] = useState(0); const [comment, setComment] = useState(''); const [again, setAgain] = useState<Record<string, boolean>>({}); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { if (token) call<View>('GET', `/api/portal/survey/${encodeURIComponent(token)}`).then(setV).catch((e: Error) => setErr(e.message)); else setErr('This link is not valid'); }, [token]);
  const submit = async () => {
    setBusy(true); setErr('');
    try { await call('POST', `/api/portal/survey/${encodeURIComponent(token)}`, { rating, comment: comment || null, items: Object.entries(again).map(([productId, wouldBuyAgain]) => ({ productId, wouldBuyAgain })) }); setDone(true); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return <div className="min-h-screen bg-gradient-to-b from-orange-50 to-slate-100 px-4 py-6"><div className="mx-auto max-w-md space-y-4">
    <div className="flex items-center gap-2"><BrandMark /><div className="text-sm font-extrabold tracking-tight text-slate-900">Get <span className="text-rose-600">Wheysted</span></div></div>
    <div className="rounded-3xl bg-white p-5 shadow-xl">
      {done ? <div className="py-6 text-center"><div className="text-4xl">💪</div><h1 className="mt-2 text-xl font-extrabold">Thank you!</h1><p className="mt-1 text-sm text-slate-600">Your feedback helps us serve you better.</p></div>
      : v?.answered ? <p className="py-6 text-center text-slate-600">Thank you, you already answered this one.</p>
      : v ? <div className="space-y-4">
        <div><h1 className="text-xl font-extrabold">Hi {v.member}!</h1><p className="text-sm text-slate-600">How was your purchase at {v.branch} on {v.date}?</p></div>
        <div className="flex justify-center gap-1" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className={`text-4xl ${n <= rating ? 'text-amber-400' : 'text-slate-300'}`} onClick={() => setRating(n)}>★</button>)}</div>
        {v.items.length > 0 && <div className="space-y-2"><div className="text-sm font-bold">Would you buy these again?</div>{v.items.map((i) => <div key={i.productId} className="flex items-center gap-2 text-sm"><span className="flex-1">{i.name}</span><button type="button" className={`rounded-lg px-3 py-1 font-bold ${again[i.productId] === true ? 'bg-emerald-600 text-white' : 'bg-slate-100'}`} onClick={() => setAgain({ ...again, [i.productId]: true })}>Yes</button><button type="button" className={`rounded-lg px-3 py-1 font-bold ${again[i.productId] === false ? 'bg-rose-600 text-white' : 'bg-slate-100'}`} onClick={() => setAgain({ ...again, [i.productId]: false })}>No</button></div>)}</div>}
        <textarea className="w-full rounded-xl border border-slate-200 p-3 text-base" rows={3} placeholder="Anything we can do better? (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
        {err && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{err}</p>}
        <button className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-600 px-4 py-3 text-base font-bold text-white shadow disabled:opacity-50" disabled={!rating || busy} onClick={() => void submit()}>{busy ? 'Sending…' : 'Send my rating'}</button>
      </div> : <p className="py-6 text-center text-slate-500">{err || 'Loading…'}</p>}
    </div>
  </div></div>;
}
