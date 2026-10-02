import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, fmtDate } from '@/lib/api';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, Select, Stat, Textarea } from '@/components/ui/primitives';
import { Segmented } from '@/components/ui/widgets';
import { DataTable } from '@/components/ui/table';

interface Cfg { emailConfigured: boolean; from: string | null; smsConfigured: boolean; smsSender: string | null; segments: { key: string; label: string }[] }
interface Camp { id: string; channel: 'EMAIL' | 'SMS'; name: string; subject: string | null; body: string; status: string; total: number; sent: number; failed: number; skipped: number; createdAt: string; sentAt: string | null }
interface Detail extends Camp { recipients: { id: string; name: string; toAddr: string; status: string; error: string | null }[] }
const TONE: Record<string, 'green' | 'red' | 'amber' | 'slate' | 'blue'> = { SENT: 'green', DONE: 'green', FAILED: 'red', NOT_CONFIGURED: 'red', SKIPPED: 'slate', PENDING: 'amber', SENDING: 'blue', DRAFT: 'amber' };

/** Email and SMS campaigns to the members and the customers in our database. */
export function CampaignsPage() {
  const qc = useQueryClient(); const [sp] = useSearchParams();
  const cfg = useQuery({ queryKey: ['campaign-config'], queryFn: () => api.get<Cfg>('/api/campaigns/config') });
  const list = useQuery({ queryKey: ['campaigns'], queryFn: () => api.get<Camp[]>('/api/campaigns'), refetchInterval: (q) => ((q.state.data as Camp[] | undefined)?.some((c) => c.status === 'SENDING') ? 2000 : false) });
  const [channel, setChannel] = useState<'EMAIL' | 'SMS'>('EMAIL'); const [source, setSource] = useState<'MEMBERS' | 'ALL_CONTACTS'>('MEMBERS'); const [segment, setSegment] = useState('');
  const [productId, setProductId] = useState(sp.get('productId') ?? ''); const [productName, setProductName] = useState(sp.get('name') ?? '');
  const [name, setName] = useState(''); const [subject, setSubject] = useState(''); const [body, setBody] = useState(''); const [testTo, setTestTo] = useState(''); const [info, setInfo] = useState(''); const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState('');
  const prods = useQuery({ queryKey: ['camp-prod', text], queryFn: () => api.get<{ id: string; sku: string; name: string }[]>(`/api/products?search=${encodeURIComponent(text)}&take=10`), enabled: text.trim().length >= 2 && !productId });
  const audience = { source, segment: segment || undefined, productId: productId || undefined };
  const prev = useMutation({ mutationFn: () => api.post<{ count: number; excluded: { noContact: number; optedOut: number }; sample: { name: string; to: string }[]; truncated: boolean }>('/api/campaigns/preview', { channel, audience }) });
  useEffect(() => { prev.reset(); }, [channel, source, segment, productId]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = useMutation({ mutationFn: () => api.post<Camp>('/api/campaigns', { channel, name, subject: channel === 'EMAIL' ? subject : undefined, body, audience }), onSuccess: (c) => { setInfo(`Prepared for ${c.total} people. Review it below and press Send.`); setBody(''); setSubject(''); setName(''); void qc.invalidateQueries({ queryKey: ['campaigns'] }); setOpen(c.id); } });
  const test = useMutation({ mutationFn: () => api.post<{ status: string; error?: string }>('/api/campaigns/test', { channel, to: testTo, subject, body }), onSuccess: (r) => setInfo(r.status === 'SENT' ? 'Test sent.' : `Test not sent: ${r.error ?? r.status}`) });
  const ready = channel === 'EMAIL' ? cfg.data?.emailConfigured : cfg.data?.smsConfigured;
  const smsParts = Math.max(1, Math.ceil(body.length / 160));
  return <div className="space-y-4">
    <div className="flex items-center gap-3"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Email & SMS Campaigns</h1><Link className="text-sm text-brand underline" to="/members">Wheysted Members</Link></div>
    {cfg.data && <div className="grid gap-3 md:grid-cols-2">
      <div className={`rounded-2xl p-3 text-sm ${cfg.data.emailConfigured ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}><b>Email:</b> {cfg.data.emailConfigured ? `ready, sends from the company email ${cfg.data.from ?? ''}` : 'not set up yet. In api/.env set SMTP_URL (your mail server) and MAIL_FROM (the one company email), then restart.'}</div>
      <div className={`rounded-2xl p-3 text-sm ${cfg.data.smsConfigured ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}><b>SMS:</b> {cfg.data.smsConfigured ? `ready (Semaphore${cfg.data.smsSender ? `, sender ${cfg.data.smsSender}` : ''})` : 'not set up yet. In api/.env set SEMAPHORE_API_KEY (and SEMAPHORE_SENDER), then restart.'}</div></div>}
    <Card title="New campaign">
      <Segmented value={channel} onChange={setChannel} options={[['EMAIL', 'Email blast'], ['SMS', 'SMS blast']]} />
      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <Field label="Send to"><Select value={source} onChange={(e) => { setSource(e.target.value as 'MEMBERS' | 'ALL_CONTACTS'); if (e.target.value === 'ALL_CONTACTS') setSegment(''); }}><option value="MEMBERS">Wheysted members</option><option value="ALL_CONTACTS">Everyone in our database</option></Select></Field>
        <Field label="Only members who are"><Select value={segment} disabled={source === 'ALL_CONTACTS'} onChange={(e) => setSegment(e.target.value)}><option value="">All</option>{cfg.data?.segments.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</Select></Field>
        <Field label="Who bought this item (optional)" className="md:col-span-2"><div className="relative">{productId ? <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm">{productName || productId}<button className="ml-auto text-red-600" onClick={() => { setProductId(''); setProductName(''); setText(''); }}>✕</button></div> : <><Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search an item…" />{(prods.data?.length ?? 0) > 0 && <ul className="absolute z-20 mt-1 max-h-56 w-full divide-y overflow-auto rounded-xl border bg-white text-sm shadow-lg">{prods.data!.map((p) => <li key={p.id}><button type="button" className="w-full px-3 py-2 text-left hover:bg-slate-50" onClick={() => { setProductId(p.id); setProductName(`${p.sku} · ${p.name}`); }}>{p.sku} · {p.name}</button></li>)}</ul>}</>}</div></Field>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3"><Button variant="outline" size="sm" disabled={prev.isPending} onClick={() => prev.mutate()}>Count who will receive it</Button>
        {prev.data && <span className="text-sm"><b>{prev.data.count}</b> will receive it{prev.data.excluded.noContact || prev.data.excluded.optedOut ? <span className="text-slate-500"> · left out: {prev.data.excluded.optedOut} opted out, {prev.data.excluded.noContact} without a valid {channel === 'EMAIL' ? 'email' : 'mobile number'}</span> : null}{prev.data.truncated ? ' · the first 20,000 only' : ''}</span>}</div>
      {prev.data && prev.data.sample.length > 0 && <p className="mt-1 text-xs text-slate-500">For example: {prev.data.sample.map((s) => `${s.name} (${s.to})`).join(', ')}</p>}
      <ErrorBox error={prev.error} />
      <div className="mt-3 grid gap-3 md:grid-cols-2"><Field label="Campaign name (for your list)"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. October whey promo" /></Field>{channel === 'EMAIL' && <Field label="Email subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. {firstName}, 20% off Prothin this week" /></Field>}</div>
      <Field label={channel === 'EMAIL' ? 'Email message' : `SMS message (${body.length} characters · ${smsParts} SMS)`} hint="You can use {name}, {firstName} and {memberNo}. Every email gets an unsubscribe link; SMS has none, so keep it occasional." className="mt-3"><Textarea rows={channel === 'EMAIL' ? 7 : 4} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <ErrorBox error={create.error} />{info && <p className="mt-2 text-sm text-emerald-700">{info}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2"><Button disabled={!body.trim() || (channel === 'EMAIL' && !subject.trim()) || create.isPending} onClick={() => { setInfo(''); create.mutate(); }}>Prepare campaign</Button>
        <Input className="max-w-56" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={channel === 'EMAIL' ? 'my email, for a test' : 'my mobile, for a test'} /><Button variant="outline" size="sm" disabled={!testTo || !body.trim() || test.isPending} onClick={() => { setInfo(''); test.mutate(); }}>Send me a test</Button>
        {!ready && <span className="text-xs text-amber-700">{channel === 'EMAIL' ? 'Email' : 'SMS'} is not set up, so nothing will actually be sent yet.</span>}</div>
      <ErrorBox error={test.error} />
    </Card>
    <Card title="Campaigns">{list.data?.length ? <DataTable columnSearch data={list.data} onRowClick={(c) => setOpen(c.id)} columns={[{ header: 'Date', accessorFn: (r) => fmtDate(r.createdAt) }, { header: 'Name', accessorKey: 'name' }, { header: 'Channel', accessorKey: 'channel' }, { header: 'Status', accessorKey: 'status', cell: (c) => <Badge tone={TONE[String(c.getValue())] ?? 'slate'}>{String(c.getValue()) === 'DRAFT' ? 'Not sent yet' : String(c.getValue()).toLowerCase()}</Badge> }, { header: 'To', accessorKey: 'total' }, { header: 'Sent', accessorKey: 'sent' }, { header: 'Failed', accessorKey: 'failed' }, { header: 'Left out', accessorKey: 'skipped' }]} /> : <Empty>No campaigns yet.</Empty>}</Card>
    {open && <CampaignModal id={open} ready={!!ready} onClose={() => setOpen(null)} />}
  </div>;
}

function CampaignModal({ id, ready, onClose }: { id: string; ready: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['campaign', id], queryFn: () => api.get<Detail>(`/api/campaigns/${id}`), refetchInterval: (s) => ((s.state.data as Detail | undefined)?.status === 'SENDING' ? 1500 : false) });
  const send = useMutation({ mutationFn: () => api.post(`/api/campaigns/${id}/send`), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['campaign', id] }); void qc.invalidateQueries({ queryKey: ['campaigns'] }); } });
  const c = q.data;
  return <Modal title={c ? `${c.name} · ${c.channel === 'EMAIL' ? 'Email' : 'SMS'}` : 'Campaign'} onClose={onClose} wide>
    {c && <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Status" value={c.status === 'DRAFT' ? 'Not sent yet' : c.status.toLowerCase()} /><Stat label="To" value={c.total} /><Stat label="Sent" value={c.sent} tone={c.sent ? 'green' : undefined} /><Stat label="Failed / left out" value={`${c.failed} / ${c.skipped}`} tone={c.failed ? 'red' : undefined} /></div>
      {c.subject && <p className="text-sm"><b>Subject:</b> {c.subject}</p>}<pre className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm">{c.body}</pre>
      {c.status !== 'DONE' && c.status !== 'SENDING' && <div className="flex flex-wrap items-center gap-2"><Button disabled={send.isPending} onClick={() => { if (confirm(`Send to ${c.total} people now? This cannot be undone.${ready ? '' : '\n\nThe channel is not set up, so nothing will go out.'}`)) send.mutate(); }}>Send to {c.total} people now</Button>{c.status === 'FAILED' && <span className="text-xs text-slate-500">Failed items can be retried after fixing the setup: they stay listed below.</span>}</div>}
      <ErrorBox error={send.error} />
      <DataTable columnSearch data={c.recipients} columns={[{ header: 'Name', accessorKey: 'name' }, { header: c.channel === 'EMAIL' ? 'Email' : 'Mobile', accessorKey: 'toAddr' }, { header: 'Result', accessorKey: 'status', cell: (x) => <Badge tone={TONE[String(x.getValue())] ?? 'slate'}>{String(x.getValue()).toLowerCase().replace('_', ' ')}</Badge> }, { header: 'Note', accessorFn: (r) => r.error ?? '' }]} />
    </div>}
  </Modal>;
}
