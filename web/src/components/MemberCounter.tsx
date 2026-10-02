import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, peso } from '@/lib/api';
import { Badge, Button, ErrorBox, Field, Input, Modal } from '@/components/ui/primitives';
import type { MemberLite } from '@/components/MemberPicker';

interface V { id: string; code: string; kind: 'AMOUNT' | 'PERCENT'; value: number; minPurchase: number; expiresOn: string }
const TONE: Record<string, 'slate' | 'blue' | 'amber'> = { BRONZE: 'slate', SILVER: 'blue', GOLD: 'amber' };

/** At the counter, once a member is picked: tier and points, the vouchers they can use on this sale, and what to suggest. */
export function MemberCounter({ member, voucherCode, onVoucher }: { member: MemberLite; voucherCode: string; onVoucher: (code: string) => void }) {
  const st = useQuery({ queryKey: ['member-standing', member.id], queryFn: () => api.get<{ tier: string; points: number; nextTier: string | null; toNextTier: number | null } | null>(`/api/members/${member.id}/standing`) });
  const vs = useQuery({ queryKey: ['member-vouchers-active', member.id], queryFn: () => api.get<V[]>(`/api/members/${member.id}/vouchers?active=1`) });
  const sug = useQuery({ queryKey: ['member-sug', member.id], queryFn: () => api.get<{ usual: { name: string; qty: number }[]; alsoBuy: { name: string; together: number }[]; likes: string | null; dislikes: string | null }>(`/api/members/${member.id}/suggestions`) });
  const s = st.data; const x = sug.data;
  return <div className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm md:col-span-3">
    <div className="flex flex-wrap items-center gap-2">{s && <><Badge tone={TONE[s.tier] ?? 'slate'}>{s.tier}</Badge><span><b>{s.points}</b> points</span>{s.nextTier && <span className="text-xs text-slate-500">{peso(s.toNextTier)} to {s.nextTier}</span>}</>}<span className="text-xs text-slate-500">Member prices apply by themselves to items where you do not type a price.</span></div>
    {vs.data && vs.data.length > 0 && <div><div className="mb-1 text-xs font-semibold uppercase text-slate-500">Vouchers (supplements only, one per sale)</div><div className="flex flex-wrap gap-2">{vs.data.map((v) => <button key={v.id} type="button" className={`rounded-xl border-2 px-3 py-1.5 text-left ${voucherCode === v.code ? 'border-emerald-600 bg-emerald-50' : 'border-dashed border-slate-300 bg-white'}`} onClick={() => onVoucher(voucherCode === v.code ? '' : v.code)}><span className="font-mono font-bold">{v.code}</span> <span className="font-semibold text-rose-600">{v.kind === 'PERCENT' ? `${v.value}% off` : `${peso(v.value)} off`}</span><div className="text-[11px] text-slate-500">{v.minPurchase > 0 ? `min ${peso(v.minPurchase)} · ` : ''}until {v.expiresOn}{voucherCode === v.code ? ' · USED ON THIS SALE' : ''}</div></button>)}</div></div>}
    {x && (x.usual.length > 0 || x.alsoBuy.length > 0) && <div className="text-xs text-slate-600">{x.usual.length > 0 && <div><b>Usually buys:</b> {x.usual.slice(0, 4).map((u) => u.name).join(', ')}</div>}{x.alsoBuy.length > 0 && <div><b>Suggest:</b> {x.alsoBuy.map((a) => a.name).join(', ')}</div>}{(x.likes || x.dislikes) && <div>{x.likes ? `Likes: ${x.likes}. ` : ''}{x.dislikes ? `Avoid: ${x.dislikes}.` : ''}</div>}</div>}
  </div>;
}

/** Log an item the customer asked for and we did not have, in two taps. */
export function LostSaleButton({ locationId, memberId }: { locationId: string; memberId?: string }) {
  const [open, setOpen] = useState(false); const [text, setText] = useState(''); const [pick, setPick] = useState<{ id: string; name: string } | null>(null); const [qty, setQty] = useState('1'); const [done, setDone] = useState('');
  const prods = useQuery({ queryKey: ['lost-prod', text], queryFn: () => api.get<{ id: string; sku: string; name: string }[]>(`/api/products?search=${encodeURIComponent(text)}&take=8`), enabled: open && text.trim().length >= 2 && !pick });
  const save = useMutation({ mutationFn: () => api.post('/api/member-program/lost-sales', { productId: pick?.id ?? null, itemText: pick ? null : text.trim(), qty: Number(qty) || 1, memberId: memberId ?? null, locationId: locationId || undefined }), onSuccess: () => { setDone(`Logged: ${pick?.name ?? text}`); setOpen(false); setText(''); setPick(null); setQty('1'); } });
  return <div className="md:col-span-3"><Button type="button" size="sm" variant="outline" onClick={() => { setDone(''); setOpen(true); }}>Customer asked for an item we didn't have</Button>{done && <span className="ml-3 text-xs text-emerald-700">{done}</span>}
    {open && <Modal title="Item we didn't have" onClose={() => setOpen(false)}>
      <p className="mb-2 text-sm text-slate-600">This helps us stock what customers ask for. Pick the product, or type what they asked for.</p>
      <Field label="Item"><div className="relative">{pick ? <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm">{pick.name}<button type="button" className="ml-auto text-red-600" onClick={() => setPick(null)}>✕</button></div> : <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. chocolate whey 5 lb, pink creatine gummies…" />}{!pick && prods.data && prods.data.length > 0 && <ul className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded-xl border bg-white text-sm shadow-lg">{prods.data.map((p) => <li key={p.id}><button type="button" className="w-full px-3 py-2 text-left hover:bg-slate-50" onClick={() => { setPick({ id: p.id, name: p.name }); setText(''); }}>{p.sku} · {p.name}</button></li>)}</ul>}</div></Field>
      <Field label="How many" className="mt-2"><Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
      <ErrorBox error={save.error} /><div className="mt-3 flex gap-2"><Button disabled={(!pick && text.trim().length < 2) || save.isPending} onClick={() => save.mutate()}>Save</Button><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
    </Modal>}
  </div>;
}
