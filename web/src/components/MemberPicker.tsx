import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button, ErrorBox, Field, Input, Modal } from '@/components/ui/primitives';

export interface MemberLite { id: string; memberNo: string; fullName: string; phone: string | null; email: string | null; orders: number; lastPurchase: string | null; favorite: string | null }

/** Finds a Wheysted member at the counter: type the number, name or phone, scan the QR card with a scanner (it types into the box) or with the camera, or add a new member. */
export function MemberPicker({ value, onChange }: { value: MemberLite | null; onChange: (m: MemberLite | null) => void }) {
  const [q, setQ] = useState(''); const [results, setResults] = useState<MemberLite[]>([]); const [scan, setScan] = useState(false); const [adding, setAdding] = useState(false); const [err, setErr] = useState('');
  const seq = useRef(0);
  const run = async (text: string, auto = false) => {
    const n = ++seq.current;
    if (text.trim().length < 2) { setResults([]); return; }
    try { const r = await api.get<MemberLite[]>(`/api/members/lookup?q=${encodeURIComponent(text.trim())}`); if (n !== seq.current) return; setResults(r); setErr(''); if (auto && r.length === 1) { onChange(r[0]); setQ(''); setResults([]); } else if (auto && !r.length) setErr('No member found. Check the number, or add a new member.'); }
    catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { const t = setTimeout(() => void run(q), 250); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (m: MemberLite) => { onChange(m); setQ(''); setResults([]); setErr(''); };
  if (value) return <div className="flex flex-wrap items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm"><span className="font-semibold text-emerald-900">{value.memberNo}</span><span>{value.fullName}</span><span className="text-slate-500">{value.phone}</span>{value.favorite && <span className="text-xs text-slate-500">· likes {value.favorite}</span>}<button type="button" className="ml-auto text-red-600" onClick={() => onChange(null)}>✕ remove</button></div>;
  return <div className="relative">
    <div className="flex flex-wrap gap-2">
      <Input className="min-w-56 flex-1" placeholder="Member number, name or phone — or scan the QR card" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void run(q, true); } }} autoComplete="off" />
      <Button type="button" variant="outline" onClick={() => setScan(true)}>📷 Scan</Button><Button type="button" variant="outline" onClick={() => setAdding(true)}>+ New member</Button>
    </div>
    {err && <p className="mt-1 text-xs text-red-700">{err}</p>}
    {results.length > 0 && <ul className="absolute z-20 mt-1 max-h-64 w-full divide-y overflow-auto rounded-xl border bg-white text-sm shadow-lg">{results.map((m) => <li key={m.id}><button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50" onClick={() => pick(m)}><b>{m.memberNo}</b><span>{m.fullName}</span><span className="text-xs text-slate-500">{m.phone ?? m.email}</span><span className="ml-auto text-xs text-slate-500">{m.orders} orders{m.lastPurchase ? ` · last ${m.lastPurchase}` : ''}</span></button></li>)}</ul>}
    {scan && <ScanModal onClose={() => setScan(false)} onCode={(code) => { setScan(false); setQ(code); void run(code, true); }} />}
    {adding && <NewMember onClose={() => setAdding(false)} onCreated={(m) => { setAdding(false); pick(m); }} />}
  </div>;
}

function NewMember({ onClose, onCreated }: { onClose: () => void; onCreated: (m: MemberLite) => void }) {
  const [f, setF] = useState({ fullName: '', phone: '', email: '', birthday: '' });
  const save = useMutation({ mutationFn: () => api.post<{ id: string; memberNo: string; fullName: string; phone: string | null; email: string | null }>('/api/members', { fullName: f.fullName, phone: f.phone || null, email: f.email || null, birthday: f.birthday || null }), onSuccess: (m) => onCreated({ ...m, orders: 0, lastPurchase: null, favorite: null }) });
  return <Modal title="New Wheysted member" onClose={onClose}>
    <div className="grid gap-3">
      <Field label="Full name *"><Input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
      <Field label="Mobile number *"><Input type="tel" inputMode="tel" placeholder="09xx xxx xxxx" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <Field label="Email (optional)"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <Field label="Birthday (optional)"><Input type="date" value={f.birthday} onChange={(e) => setF({ ...f, birthday: e.target.value })} /></Field>
    </div>
    <ErrorBox error={save.error} />
    <p className="mt-2 text-xs text-slate-500">The customer gets a member number and a QR card (they can sign up on the Wheysted page with the number). Past purchases with this mobile number join the account.</p>
    <div className="mt-3 flex gap-2"><Button disabled={f.fullName.trim().length < 2 || f.phone.replace(/\D/g, '').length < 10 || save.isPending} onClick={() => save.mutate()}>Create member</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
  </Modal>;
}

/** Camera scan of the QR card (phones and tablets with a barcode detector); a USB / Bluetooth scanner just types into the box instead. */
function ScanModal({ onClose, onCode }: { onClose: () => void; onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null); const [msg, setMsg] = useState('Point the camera at the QR card.'); const cb = useRef(onCode); cb.current = onCode;
  useEffect(() => {
    let stream: MediaStream | null = null; let live = true; let timer: ReturnType<typeof setTimeout>;
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!BD) { setMsg('This browser cannot read QR codes with the camera. Use a QR scanner (it types the code into the box) or type the member number.'); return; }
    const det = new BD({ formats: ['qr_code'] });
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(async (s) => {
      stream = s; if (!video.current) return; video.current.srcObject = s; await video.current.play();
      const tick = async () => { if (!live || !video.current) return; try { const r = await det.detect(video.current); if (r[0]?.rawValue) { cb.current(r[0].rawValue); return; } } catch { /* keep looking */ } timer = setTimeout(() => void tick(), 300); };
      void tick();
    }).catch(() => setMsg('The camera could not be opened. Allow camera access for this site, or type the member number.'));
    return () => { live = false; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  return <Modal title="Scan the member's QR card" onClose={onClose}><video ref={video} muted playsInline className="mx-auto max-h-80 w-full rounded-xl bg-black" /><p className="mt-2 text-sm text-slate-600">{msg}</p></Modal>;
}
