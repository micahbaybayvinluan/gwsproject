import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, Select, Textarea } from '@/components/ui/primitives';

interface Signer { name: string; title: string; userId?: string | null }
interface MemoTable { headers: string[]; rows: string[][] }
interface Memo { id: string; memoNo: string; subject: string; addressedTo: string; fromText: string; memoDate: string; body: string; table: MemoTable | null; signers: Signer[]; status: string; createdBy: string; voidReason: string | null; recipientCount: number; acknowledgedCount: number; mine: { acknowledgedAt: string | null } | null; recipients?: { userId: string; name: string; role: string; acknowledgedAt: string | null }[] }
interface Options { roles: { key: string; name: string }[]; locations: { id: string; name: string; type: string }[]; users: { id: string; name: string; roleKey: string; role: string }[]; ownerSigners: Signer[] }
interface Audience { all?: boolean; franchiseOwners?: boolean; franchiseAssociates?: boolean; roles?: string[]; locationIds?: string[]; userIds?: string[] }

const longDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
const isNum = (s: string) => /^[\d,.\s₱%()-]+$/.test(s) && /\d/.test(s);

/** Memorandums (owner request 2026-09-30): numbered 2026-Q3-045, addressed to the people chosen, signed by the people named; everyone addressed is notified and confirms they read it. */
export function MemosPage() {
  const { can, me } = useAuth(); const qc = useQueryClient(); const [sp, setSp] = useSearchParams();
  const [composing, setComposing] = useState(sp.get('compose') != null);
  const list = useQuery({ queryKey: ['memos'], queryFn: () => api.get<Memo[]>('/api/memos') });
  const openId = sp.get('id');
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['memos'] }); void qc.invalidateQueries({ queryKey: ['memo'] }); };
  const rows = list.data ?? [];
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Memorandums</h1>{can('memo.create') && <Button onClick={() => setComposing(true)}>Write a memo</Button>}</div>
    <Card>{list.isLoading ? <Empty>Loading…</Empty> : rows.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1 pr-3">Memo no.</th><th className="pr-3">Date</th><th className="pr-3">Re</th><th className="pr-3">To</th><th className="pr-3">From</th><th className="pr-3">Read</th><th /></tr></thead>
      <tbody>{rows.map((m) => <tr key={m.id} className={`border-t align-top ${openId === m.id ? 'bg-amber-50' : ''}`}>
        <td className="py-2 pr-3 font-medium">{m.memoNo}{m.status === 'VOIDED' && <div><Badge tone="red">cancelled</Badge></div>}</td><td className="pr-3">{m.memoDate}</td><td className="pr-3">{m.subject}</td><td className="pr-3 text-xs text-slate-600">{m.addressedTo.length > 70 ? `${m.addressedTo.slice(0, 70)}…` : m.addressedTo}</td><td className="pr-3 text-xs">{m.createdBy}</td>
        <td className="pr-3">{m.mine ? (m.mine.acknowledgedAt ? <Badge tone="green">I read it</Badge> : <Badge tone="amber">please read</Badge>) : <span className="text-xs text-slate-500">{m.acknowledgedCount}/{m.recipientCount}</span>}</td>
        <td className="text-right"><Button size="sm" variant="outline" onClick={() => setSp({ id: m.id })}>Open</Button></td></tr>)}</tbody></table></div> : <Empty>No memos yet.</Empty>}</Card>
    {openId && <MemoView id={openId} onClose={() => setSp({})} onChanged={refresh} canVoid={(m) => me?.roleKey === 'ADMIN' || m.createdBy === me?.fullName} />}
    {composing && <Compose onClose={() => { setComposing(false); if (sp.get('compose') != null) setSp({}); }} onCreated={(m) => { setComposing(false); refresh(); setSp({ id: m.id }); }} prefill={{ compose: sp.get('compose'), franchise: sp.get('franchise'), days: sp.get('days') }} />}
  </div>;
}

export function MemoPaper({ m }: { m: Pick<Memo, 'memoNo' | 'subject' | 'addressedTo' | 'fromText' | 'memoDate' | 'body' | 'table' | 'signers'> }) {
  const lh = useQuery({ queryKey: ['letterhead'], queryFn: () => api.get<{ address: string; contact: string; logoDataUrl: string | null }>('/api/letterhead'), staleTime: 5 * 60_000, retry: false });
  return <div className="mx-auto max-w-3xl rounded border bg-white p-6 text-[13px] leading-relaxed shadow-sm">
    <div className="border-b-2 border-slate-800 pb-3 text-center">{lh.data?.logoDataUrl ? <img src={lh.data.logoDataUrl} alt="" className="mx-auto h-20 w-auto object-contain" /> : <div className="text-2xl font-black text-navy">GET <span className="text-brand">WHEYSTED</span><div className="text-[10px] font-normal tracking-[.4em]">SUPPLEMENTS</div></div>}<div className="mt-2 text-xs">{lh.data?.address}</div><div className="text-xs text-blue-700">{lh.data?.contact}</div></div>
    <div className="mt-4 flex justify-between font-bold"><div><div>TO: {m.addressedTo}</div><div>FROM: {m.fromText}</div><div>RE: {m.subject}</div><div>DATE: {longDate(m.memoDate)}</div></div><div>{m.memoNo}</div></div>
    <div className="mt-4 space-y-3">{m.body.split(/\n{2,}/).map((p, i) => <p key={i} className="whitespace-pre-line">{p}</p>)}</div>
    {m.table?.headers.length ? <table className="mx-auto my-4 w-full border-collapse"><thead><tr>{m.table.headers.map((h, i) => <th key={i} className="border border-slate-800 bg-yellow-300 px-2 py-1 uppercase">{h}</th>)}</tr></thead><tbody>{m.table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={`border border-slate-800 px-2 py-0.5 ${isNum(c) ? 'text-right' : ''}`}>{c}</td>)}</tr>)}</tbody></table> : null}
    <div className="mt-10 grid grid-cols-2 gap-x-10 gap-y-10">{m.signers.map((s, i) => <div key={i}><div className="h-10 border-b border-slate-700" style={{ width: '85%' }} /><div className="-mt-0.5 font-bold underline">{s.name}</div><div className="text-xs italic">{s.title}</div></div>)}</div>
  </div>;
}

function MemoView({ id, onClose, onChanged, canVoid }: { id: string; onClose: () => void; onChanged: () => void; canVoid: (m: Memo) => boolean }) {
  const q = useQuery({ queryKey: ['memo', id], queryFn: () => api.get<Memo>(`/api/memos/${id}`) });
  const ack = useMutation({ mutationFn: () => api.post(`/api/memos/${id}/ack`, {}), onSuccess: () => { void q.refetch(); onChanged(); } });
  const [voiding, setVoiding] = useState(false); const [reason, setReason] = useState('');
  const voidM = useMutation({ mutationFn: () => api.post(`/api/memos/${id}/void`, { reason }), onSuccess: () => { setVoiding(false); void q.refetch(); onChanged(); } });
  const m = q.data;
  return <Modal title={m ? `Memo ${m.memoNo}` : 'Memo'} onClose={onClose} wide>
    {!m ? <p className="text-sm text-slate-500">Loading…</p> : <div className="space-y-3">
      {m.status === 'VOIDED' && <p className="rounded border border-red-200 bg-brand-soft p-2 text-sm text-brand-dark">Cancelled: {m.voidReason}</p>}
      <div className="max-h-[60vh] overflow-auto"><MemoPaper m={m} /></div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => api.download(`/api/memos/${id}/pdf`, `Memo-${m.memoNo}.pdf`)}>Print / download PDF</Button>
        {m.mine && !m.mine.acknowledgedAt && m.status === 'ISSUED' && <Button disabled={ack.isPending} onClick={() => ack.mutate()}>I have read this memo</Button>}
        {m.mine?.acknowledgedAt && <Badge tone="green">You confirmed reading it</Badge>}
        {m.status === 'ISSUED' && canVoid(m) && <Button variant="outline" onClick={() => setVoiding(true)}>Cancel this memo</Button>}
        <span className="ml-auto text-xs text-slate-500">Written by {m.createdBy} · {m.acknowledgedCount}/{m.recipientCount} have read it</span>
      </div>
      {m.recipients && <details className="text-sm"><summary className="cursor-pointer font-medium">Who was addressed ({m.recipients.length})</summary><ul className="mt-1 grid gap-x-6 sm:grid-cols-2">{m.recipients.map((r) => <li key={r.userId} className="flex justify-between border-b py-0.5"><span>{r.name} <span className="text-xs text-slate-500">{r.role}</span></span>{r.acknowledgedAt ? <Badge tone="green">read</Badge> : <Badge tone="amber">not yet</Badge>}</li>)}</ul></details>}
      <ErrorBox error={ack.error ?? voidM.error} />
      {voiding && <div className="flex gap-2"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for cancelling (everyone addressed is told)" /><Button disabled={reason.trim().length < 3 || voidM.isPending} onClick={() => voidM.mutate()}>Cancel memo</Button></div>}
    </div>}
  </Modal>;
}

const NOTICE = (name: string, demand: boolean) => demand
  ? `Good day!\n\nOur records show that the account of ${name} remains unpaid two months after its due date. In line with the Memorandum on Payment Terms, Penalty, and Interest on Overdue Accounts dated July 31, 2026, this is a formal demand to settle the full unpaid balance, including the 2% penalty and the 0.1% daily interest, within seven (7) days from the date of this memo.\n\nFailing this, the Franchisor may suspend or revoke credit privileges, require Cash-Before-Delivery on all succeeding orders, and take such other action as the Memorandum allows.`
  : `Good day!\n\nThis is to remind ${name} that the account below is past due. Under the Memorandum on Payment Terms, Penalty, and Interest on Overdue Accounts dated July 31, 2026, a one-time 2% penalty and 0.1% interest per day on the unpaid balance apply from the first day after the due date until the account is fully settled.\n\nPlease settle the account, or request an extension in GWS-ERP (Franchise AR), as soon as possible.`;

function Compose({ onClose, onCreated, prefill }: { onClose: () => void; onCreated: (m: Memo) => void; prefill: { compose: string | null; franchise: string | null; days: string | null } }) {
  const { me } = useAuth();
  const opts = useQuery({ queryKey: ['memo-options'], queryFn: () => api.get<Options>('/api/memos/options') });
  const [aud, setAud] = useState<Audience>({}); const [toText, setToText] = useState(''); const [toTouched, setToTouched] = useState(false);
  const [subject, setSubject] = useState(''); const [date, setDate] = useState(today()); const [from, setFrom] = useState('Get Wheysted Supplements Corporation');
  const [body, setBody] = useState('Good day!\n\n'); const [withTable, setWithTable] = useState(false);
  const [table, setTable] = useState<MemoTable>({ headers: ['Products', 'Price'], rows: [['', '']] });
  const [signers, setSigners] = useState<Signer[]>([]); const [find, setFind] = useState(''); const [person, setPerson] = useState('');
  const admin = me?.roleKey === 'ADMIN';
  // a notice / demand to an overdue franchise, written from Franchise AR
  useEffect(() => {
    if (prefill.compose !== 'overdue' || !prefill.franchise || !opts.data) return;
    const loc = opts.data.locations.find((l) => l.id === prefill.franchise); if (!loc) return;
    const demand = prefill.days === 'demand';
    setAud({ locationIds: [loc.id], userIds: [] }); setSubject(demand ? 'DEMAND TO PAY OVERDUE ACCOUNT' : 'NOTICE OF OVERDUE ACCOUNT'); setBody(NOTICE(loc.name, demand));
    const coord = opts.data.users.filter((u) => ['FRANCHISE_COORDINATOR', 'ASST_FRANCHISE_COORDINATOR'].includes(u.roleKey)).map((u) => ({ name: u.name.toUpperCase(), title: u.role, userId: u.id }));
    setSigners(coord);
  }, [prefill.compose, prefill.franchise, prefill.days, opts.data]);
  const preview = useQuery({ queryKey: ['memo-preview', aud], queryFn: () => api.post<{ count: number; people: { id: string; fullName: string }[] }>('/api/memos/preview', aud), enabled: !!(aud.all || aud.franchiseOwners || aud.franchiseAssociates || aud.roles?.length || aud.locationIds?.length || aud.userIds?.length) });
  const auto = useMemo(() => {
    const parts: string[] = [];
    if (aud.all) parts.push('ALL STAFF AND FRANCHISE PARTNERS');
    if (aud.franchiseOwners) parts.push('FRANCHISE PARTNERS');
    if (aud.franchiseAssociates) parts.push('FRANCHISE ASSOCIATES');
    for (const r of aud.roles ?? []) parts.push((opts.data?.roles.find((x) => x.key === r)?.name ?? r).toUpperCase());
    for (const l of aud.locationIds ?? []) parts.push((opts.data?.locations.find((x) => x.id === l)?.name ?? '').toUpperCase());
    for (const u of aud.userIds ?? []) parts.push((opts.data?.users.find((x) => x.id === u)?.name ?? '').toUpperCase());
    return parts.join(', ');
  }, [aud, opts.data]);
  useEffect(() => { if (!toTouched) setToText(auto); }, [auto, toTouched]);
  const toggle = <K extends 'roles' | 'locationIds' | 'userIds'>(k: K, v: string) => setAud((a) => { const cur = new Set(a[k] ?? []); if (cur.has(v)) cur.delete(v); else cur.add(v); return { ...a, [k]: [...cur] }; });
  const save = useMutation({ mutationFn: () => api.post<Memo>('/api/memos', { subject, addressedTo: toText, fromText: from, memoDate: date, body, table: withTable ? { headers: table.headers, rows: table.rows } : null, signers, audience: aud }), onSuccess: onCreated });
  const fixed: Signer[] = admin ? opts.data?.ownerSigners ?? [] : [{ name: (me?.fullName ?? '').toUpperCase(), title: me?.roleName ?? '' }];
  const matches = (opts.data?.users ?? []).filter((u) => find.length >= 2 && u.name.toLowerCase().includes(find.toLowerCase())).slice(0, 8);
  return <Modal title="Write a memo" onClose={onClose} wide>
    <div className="space-y-4 text-sm">
      <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Who is it for?</div>
        <div className="flex flex-wrap gap-x-5 gap-y-1"><label className="flex items-center gap-1"><input type="checkbox" checked={!!aud.all} onChange={(e) => setAud({ ...aud, all: e.target.checked })} /> Everyone (all staff and franchises)</label><label className="flex items-center gap-1"><input type="checkbox" checked={!!aud.franchiseOwners} onChange={(e) => setAud({ ...aud, franchiseOwners: e.target.checked })} /> All franchise owners</label><label className="flex items-center gap-1"><input type="checkbox" checked={!!aud.franchiseAssociates} onChange={(e) => setAud({ ...aud, franchiseAssociates: e.target.checked })} /> All franchise associates</label></div>
        <details className="mt-1"><summary className="cursor-pointer">Choose by role</summary><div className="mt-1 grid gap-x-4 sm:grid-cols-3">{opts.data?.roles.map((r) => <label key={r.key} className="flex items-center gap-1"><input type="checkbox" checked={!!aud.roles?.includes(r.key)} onChange={() => toggle('roles', r.key)} /> {r.name}</label>)}</div></details>
        <details className="mt-1" open={!!aud.locationIds?.length}><summary className="cursor-pointer">Choose by branch / franchise (staff and owner there)</summary><div className="mt-1 grid gap-x-4 sm:grid-cols-3">{opts.data?.locations.map((l) => <label key={l.id} className="flex items-center gap-1"><input type="checkbox" checked={!!aud.locationIds?.includes(l.id)} onChange={() => toggle('locationIds', l.id)} /> {l.name}{l.type === 'FRANCHISE' ? ' (franchise)' : ''}</label>)}</div></details>
        <div className="mt-2"><Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Or find a person by name" />{matches.length > 0 && <ul className="mt-1 rounded border bg-white">{matches.map((u) => <li key={u.id}><button className="w-full px-2 py-1 text-left hover:bg-slate-50" onClick={() => { toggle('userIds', u.id); setFind(''); }}>{u.name} <span className="text-xs text-slate-500">{u.role}</span></button></li>)}</ul>}
          <div className="mt-1 flex flex-wrap gap-1">{(aud.userIds ?? []).map((id) => <span key={id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs">{opts.data?.users.find((u) => u.id === id)?.name}<button onClick={() => toggle('userIds', id)} aria-label="remove">×</button></span>)}</div></div>
        <p className="mt-1 text-xs text-slate-500">{preview.data ? `${preview.data.count} people will be notified.` : 'Choose at least one.'}</p></div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="TO (printed on the memo)"><Input value={toText} onChange={(e) => { setToTouched(true); setToText(e.target.value); }} placeholder="e.g. FRANCHISE PARTNERS AND GETWHEYSTED STAFF" /></Field>
        <Field label="FROM"><Input value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="RE (subject)"><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. PRICE ADJUSTMENT" /></Field>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <Field label="The memo"><Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <label className="flex items-center gap-2"><input type="checkbox" checked={withTable} onChange={(e) => setWithTable(e.target.checked)} /> Add a table (prices, schedule…)</label>
      {withTable && <div className="space-y-2 rounded border p-2"><div className="flex flex-wrap gap-2">{table.headers.map((h, i) => <Input key={i} className="w-36 font-semibold" value={h} onChange={(e) => setTable({ ...table, headers: table.headers.map((x, k) => (k === i ? e.target.value : x)) })} />)}
        {table.headers.length < 8 && <Button size="sm" variant="outline" onClick={() => setTable({ headers: [...table.headers, 'Column'], rows: table.rows.map((r) => [...r, '']) })}>+ column</Button>}</div>
        {table.rows.map((r, ri) => <div key={ri} className="flex flex-wrap gap-2">{table.headers.map((_, ci) => <Input key={ci} className="w-36" value={r[ci] ?? ''} onChange={(e) => setTable({ ...table, rows: table.rows.map((x, k) => (k === ri ? table.headers.map((__, c) => (c === ci ? e.target.value : x[c] ?? '')) : x)) })} />)}</div>)}
        <Button size="sm" variant="outline" onClick={() => setTable({ ...table, rows: [...table.rows, table.headers.map(() => '')] })}>+ row</Button></div>}
      <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Signatures</div>
        <div className="flex flex-wrap gap-2">{fixed.map((s) => <span key={s.name} className="rounded-full bg-navy px-3 py-1 text-xs text-white" title={admin ? 'Always on the Owner\'s memos' : 'You sign as the writer'}>{s.name} · {s.title}</span>)}
          {signers.map((s, i) => <span key={i} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs">{s.name} · {s.title}<button onClick={() => setSigners(signers.filter((_, k) => k !== i))} aria-label="remove">×</button></span>)}</div>
        <div className="mt-2 flex flex-wrap gap-2"><Select value={person} onChange={(e) => setPerson(e.target.value)}><option value="">Add a signer…</option>{opts.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}</Select>
          <Button size="sm" variant="outline" disabled={!person} onClick={() => { const u = opts.data!.users.find((x) => x.id === person)!; if (!signers.some((s) => s.userId === u.id)) setSigners([...signers, { name: u.name.toUpperCase(), title: u.role, userId: u.id }]); setPerson(''); }}>Add</Button>
          <Button size="sm" variant="outline" onClick={() => { const name = window.prompt('Name of the signer'); const title = name ? window.prompt('Title (e.g. Audit Staff)') : null; if (name && title) setSigners([...signers, { name: name.toUpperCase(), title }]); }}>Add by typing</Button></div>
        <p className="mt-1 text-xs text-slate-500">{admin ? 'On the Owner\'s memos AL MARVIN VINLUAN (President) and MICAH VINLUAN (Manager) always sign.' : 'You sign as the writer. Add the others who must sign (for example the Franchise Coordinator, the Head Auditor).'} Every signer and every person addressed is notified.</p></div>
      <ErrorBox error={save.error} />
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.isPending || !subject.trim() || body.trim().length < 3 || !preview.data?.count} onClick={() => save.mutate()}>Issue the memo</Button></div>
    </div></Modal>;
}
