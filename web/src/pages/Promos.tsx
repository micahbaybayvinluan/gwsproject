import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate, peso } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Select, Textarea } from '@/components/ui/primitives';
import type { PromoRow } from './CustomerService';

const STATE: Record<string, { label: string; tone: 'green' | 'blue' | 'slate' | 'red' }> = { RUNNING: { label: 'Running', tone: 'green' }, UPCOMING: { label: 'Starts soon', tone: 'blue' }, ENDED: { label: 'Ended', tone: 'slate' }, CANCELLED: { label: 'Cancelled', tone: 'red' } };

/** A highlighted strip of the promos running now (dashboard and New Sale). */
export function PromoBanner({ compact = false }: { compact?: boolean }) {
  const q = useQuery({ queryKey: ['promos-active'], queryFn: () => api.get<PromoRow[]>('/api/promos/active'), refetchInterval: 300_000 });
  if (!q.data?.length) return null;
  return <div className="space-y-2" data-testid="promo-banner">{q.data.map((p) => <Link key={p.id} to="/promos" className="block rounded-2xl border-2 border-amber-400 bg-gradient-to-r from-amber-50 to-rose-50 p-3 shadow-soft">
    <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-rose-600 px-2.5 py-0.5 text-xs font-extrabold uppercase tracking-wide text-white">Promo</span><b className="text-navy">{p.title}</b><span className="text-xs text-slate-600">until {fmtDate(p.endsOn)}{p.daysLeft != null ? ` (${p.daysLeft === 0 ? 'last day' : `${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'} left`})` : ''}</span><Badge tone={p.audience === 'FRANCHISES' ? 'purple' : 'blue'}>{p.audience === 'FRANCHISES' ? 'franchises' : 'all branches'}</Badge></div>
    {!compact && <p className="mt-1 text-sm text-slate-700">{p.details}</p>}
    {p.items.length > 0 && <p className="mt-1 text-xs text-slate-700">{p.items.slice(0, 4).map((i) => `${i.product}: ${peso(i.promoPrice)}${i.regularPrice != null ? ` (was ${peso(i.regularPrice)})` : ''}`).join(' · ')}{p.items.length > 4 ? ` · +${p.items.length - 4} more` : ''}</p>}
  </Link>)}</div>;
}

function Issue({ onDone }: { onDone: () => void }) {
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const [f, setF] = useState({ title: '', details: '', audience: 'BRANCHES', startsOn: today, endsOn: '' }); const [items, setItems] = useState<{ id: string; name: string; price: string }[]>([]); const [text, setText] = useState(''); const [info, setInfo] = useState('');
  const prods = useQuery({ queryKey: ['promo-prod', text], queryFn: () => api.get<{ id: string; sku: string; name: string; tierPrices?: Record<string, string | number> }[]>(`/api/products?search=${encodeURIComponent(text)}&take=8`), enabled: text.trim().length >= 2 });
  const save = useMutation({ mutationFn: () => api.post<{ memoNo: string; notified: number }>('/api/promos', { ...f, items: items.filter((i) => Number(i.price) > 0).map((i) => ({ productId: i.id, promoPrice: Number(i.price) })) }), onSuccess: (r) => { setInfo(`Issued. Memo ${r.memoNo} was sent and ${r.notified} people were notified.`); setF({ ...f, title: '', details: '', endsOn: '' }); setItems([]); onDone(); } });
  return <Card title="Issue a promo">
    <p className="mb-3 text-sm text-slate-600">A promo goes to <b>every branch (franchises are not included)</b> or, as a separate promo, to <b>the franchises</b>. It is sent as a numbered memo and a highlighted notice, and shows on the dashboard and at New Sale while it runs. Items with a promo price get that price at New Sale by themselves (no special-price approval).</p>
    <div className="grid gap-3 md:grid-cols-4">
      <Field label="Issue it to"><Select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}><option value="BRANCHES">All branches (not franchises)</option><option value="FRANCHISES">Franchises only</option></Select></Field>
      <Field label="Promo name" className="md:col-span-1"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Whey week" /></Field>
      <Field label="Starts"><Input type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} /></Field><Field label="Ends"><Input type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} /></Field>
      <Field label="What the customer gets, and any rules" className="md:col-span-4"><Textarea rows={3} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} /></Field>
    </div>
    <div className="mt-3"><div className="mb-1 text-sm font-semibold text-slate-700">Promo prices (optional) <span className="font-normal text-slate-500">: the regular price is filled in; change it to the promo price</span></div>
      <div className="relative max-w-md"><Input placeholder="Search an item to add…" value={text} onChange={(e) => setText(e.target.value)} />{text.trim().length >= 2 && prods.data && prods.data.length > 0 && <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border bg-white text-sm shadow-lg">{prods.data.map((p) => <li key={p.id}><button type="button" className="w-full px-3 py-2 text-left hover:bg-slate-50" onClick={() => { const reg = p.tierPrices?.[f.audience === 'FRANCHISES' ? 'FRANCHISE' : 'RETAIL']; if (!items.some((i) => i.id === p.id)) setItems([...items, { id: p.id, name: `${p.sku} · ${p.name}`, price: reg != null ? String(reg) : '' }]); setText(''); }}>{p.sku} · {p.name}</button></li>)}</ul>}</div>
      {items.map((i) => <div key={i.id} className="mt-2 flex items-center gap-2 text-sm"><span className="flex-1">{i.name}</span><Input className="w-32" type="number" min={1} placeholder="Promo price (edit it)" value={i.price} onChange={(e) => setItems(items.map((x) => (x.id === i.id ? { ...x, price: e.target.value } : x)))} /><button className="text-red-600" onClick={() => setItems(items.filter((x) => x.id !== i.id))}>✕</button></div>)}
    </div>
    <ErrorBox error={save.error} />{info && <p className="mt-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{info}</p>}
    <div className="mt-3"><Button disabled={f.title.trim().length < 3 || !f.details.trim() || !f.endsOn || save.isPending} onClick={() => { setInfo(''); if (confirm(`Issue "${f.title}" to ${f.audience === 'BRANCHES' ? 'ALL BRANCHES (not franchises)' : 'the FRANCHISES'}? A memo and a notice go out to everyone concerned.`)) save.mutate(); }}>Issue promo and send memo</Button></div>
  </Card>;
}

/** Promos: the Owner and the Head Auditor issue them; everybody sees the ones meant for them. */
export function PromosPage() {
  const { can } = useAuth(); const qc = useQueryClient(); const issuer = can('promo.issue');
  const q = useQuery({ queryKey: ['promos'], queryFn: () => api.get<PromoRow[]>('/api/promos') });
  const cancel = useMutation({ mutationFn: (x: { id: string; reason: string }) => api.post(`/api/promos/${x.id}/cancel`, { reason: x.reason }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['promos'] }); void qc.invalidateQueries({ queryKey: ['promos-active'] }); } });
  return <div className="space-y-4">
    <h1 className="text-2xl font-bold tracking-tight text-navy">Promos</h1>
    {issuer && <Issue onDone={() => { void qc.invalidateQueries({ queryKey: ['promos'] }); void qc.invalidateQueries({ queryKey: ['promos-active'] }); }} />}
    <ErrorBox error={q.error ?? cancel.error} />
    {q.data?.length ? <div className="grid gap-3 md:grid-cols-2">{q.data.map((p) => <Card key={p.id} title={<span>{p.title} <Badge tone={STATE[p.state]?.tone ?? 'slate'}>{STATE[p.state]?.label ?? p.state}</Badge> <Badge tone={p.audience === 'FRANCHISES' ? 'purple' : 'blue'}>{p.audience === 'FRANCHISES' ? 'franchises' : 'all branches'}</Badge></span>}>
      <p className="text-sm">{p.details}</p><p className="mt-1 text-xs text-slate-500">{fmtDate(p.startsOn)} to {fmtDate(p.endsOn)} · issued by {p.createdByName}{p.cancelReason ? ` · cancelled: ${p.cancelReason}` : ''}</p>
      {p.items.length > 0 && <table className="mt-2 w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Item</th>{p.items.some((i) => i.regularPrice != null) && <th className="num">Regular</th>}<th className="num">Promo price</th></tr></thead><tbody>{p.items.map((i) => <tr key={i.productId} className="border-t"><td className="py-1">{i.sku} {i.product}</td>{p.items.some((x) => x.regularPrice != null) && <td className="num text-slate-500">{i.regularPrice != null ? peso(i.regularPrice) : ''}</td>}<td className="num font-semibold text-rose-600">{peso(i.promoPrice)}</td></tr>)}</tbody></table>}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">{p.memoId && <Link className="text-brand underline" to={`/memos?id=${p.memoId}`}>Open the memo</Link>}{issuer && p.status === 'ACTIVE' && p.state !== 'ENDED' && <Button size="sm" variant="outline" onClick={() => { const reason = prompt('Why is this promo cancelled? Everyone concerned is told.'); if (reason && reason.trim().length >= 3) cancel.mutate({ id: p.id, reason }); }}>Cancel promo</Button>}</div>
    </Card>)}</div> : <Card><Empty>No promos right now.</Empty></Card>}
  </div>;
}
