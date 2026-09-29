import { useMutation, useQuery } from '@tanstack/react-query';
import { Fragment, ReactNode, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Input } from '@/components/ui/primitives';

interface Section { id: string; title: string; body: string }
interface HelpData { intro: string; aiEnabled: boolean; role: string; sections: Section[]; roleGuide?: Section[]; everyone?: Section[]; topics?: Section[]; allRoleGuides?: Section[] }
interface AskResult { mode: 'ai' | 'guide'; answer: string | null; note?: string; sections: Section[] }
interface Turn { question: string; result: AskResult }

/** Inline text: **bold** and `code`. Built as React elements (no raw HTML). */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((p, i) =>
    p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p.startsWith('`') ? <code key={i} className="rounded bg-slate-100 px-1 text-[0.9em]">{p.slice(1, -1)}</code> : <Fragment key={i}>{p}</Fragment>);
}

/** Small Markdown subset used by the guide and the assistant: paragraphs, "-" and "1." lists (one level of nesting). */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []; const lines = text.replace(/\r/g, '').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const item = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
    if (item.test(line)) {
      const ordered = /^\s*\d+\./.test(line); const items: { text: string; sub: string[] }[] = [];
      while (i < lines.length && item.test(lines[i])) {
        const [, indent, , body] = lines[i].match(item)!;
        if (indent.length >= 2 && items.length) items[items.length - 1].sub.push(body); else items.push({ text: body, sub: [] });
        i++;
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(<List key={blocks.length} className={`my-2 space-y-1 pl-5 ${ordered ? 'list-decimal' : 'list-disc'}`}>{items.map((it, k) => <li key={k}>{inline(it.text)}{it.sub.length > 0 && <ul className="mt-1 list-[circle] space-y-1 pl-5">{it.sub.map((s, j) => <li key={j}>{inline(s)}</li>)}</ul>}</li>)}</List>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !item.test(lines[i])) { para.push(lines[i].replace(/^#+\s*/, '')); i++; }
    blocks.push(<p key={blocks.length} className="my-2">{inline(para.join(' '))}</p>);
  }
  return <div className="text-sm leading-relaxed text-slate-800">{blocks}</div>;
}

/** Help & Guide: the user guide for the person's role, a search box, and the Ask box (AI when switched on, guide search otherwise). */
export function HelpPage() {
  const { me } = useAuth();
  const q = useQuery({ queryKey: ['help'], queryFn: () => api.get<HelpData>('/api/help') });
  const [filter, setFilter] = useState(''); const [question, setQuestion] = useState(''); const [turns, setTurns] = useState<Turn[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const ask = useMutation({
    mutationFn: (text: string) => api.post<AskResult>('/api/help/ask', { question: text, history: turns.slice(-3).flatMap((t) => (t.result.answer ? [{ role: 'user', content: t.question }, { role: 'assistant', content: t.result.answer }] : [])) }),
    onSuccess: (result, text) => { setTurns((t) => [...t, { question: text, result }]); setQuestion(''); },
  });
  // My guide = the step-by-step guide for the person's role; Guide for everyone = processes everyone uses; More topics = other screens they can open
  const [tab, setTab] = useState<'mine' | 'everyone' | 'topics' | 'roles'>('mine');
  const tabSections = (t: typeof tab) => (t === 'mine' ? q.data?.roleGuide : t === 'everyone' ? q.data?.everyone : t === 'topics' ? q.data?.topics : q.data?.allRoleGuides) ?? [];
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return tabSections(tab).filter((s) => !f || s.title.toLowerCase().includes(f) || s.body.toLowerCase().includes(f));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, filter, tab]);
  const openSection = (id: string) => { setOpen((o) => new Set(o).add(id)); setTimeout(() => document.getElementById(`help-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };
  const d = q.data;
  return <div className="mx-auto max-w-4xl space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Help & Guide</h1><a className="inline-flex min-h-9 items-center rounded-lg border border-brand/40 bg-brand-soft px-3 text-sm font-semibold text-brand" href="/picture-guide/index.html" target="_blank" rel="noreferrer">Picture guide (screenshots) ↗</a>{d && <span className="text-sm text-slate-500">Showing the guide for: <b>{d.role}</b></span>}</div>
    <Card title={<>Ask a question {d && (d.aiEnabled ? <Badge tone="green">AI assistant on</Badge> : <Badge>answers from the guide</Badge>)}</>}>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (question.trim().length >= 3) ask.mutate(question.trim()); }}>
        <Input className="min-w-0 flex-1" placeholder="e.g. How do I record a delivery sale? / Paano mag-request ng stock?" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={1000} />
        <Button disabled={question.trim().length < 3 || ask.isPending}>{ask.isPending ? 'Thinking…' : 'Ask'}</Button>
      </form>
      <ErrorBox error={ask.error} />
      {d && !d.aiEnabled && <p className="mt-2 text-xs text-slate-500">The AI assistant is switched off, so the matching guide sections are shown.{me?.roleKey === 'ADMIN' ? ' To switch it on, put an Anthropic API key in api/.env as ANTHROPIC_API_KEY=… and restart the app (see README → Help assistant).' : ''}</p>}
      <div className="mt-3 space-y-4">{[...turns].reverse().map((t, k) => <div key={turns.length - k} className="rounded-md border border-slate-200 p-3">
        <p className="text-sm font-medium">Q: {t.question}</p>
        {t.result.answer && <div className="mt-1"><Markdown text={t.result.answer} /></div>}
        {t.result.note && <p className="mt-1 text-sm text-amber-700">{t.result.note}</p>}
        {!t.result.answer && t.result.sections.map((s) => <div key={s.id} className="mt-2 rounded bg-slate-50 p-2"><div className="text-sm font-semibold">{s.title}</div><Markdown text={s.body} /></div>)}
        {t.result.answer && t.result.sections.length > 0 && <p className="mt-2 text-xs text-slate-500">Read more: {t.result.sections.map((s, i) => <Fragment key={s.id}>{i > 0 && ' · '}<button className="text-brand underline" onClick={() => openSection(s.id)}>{s.title}</button></Fragment>)}</p>}
      </div>)}</div>
      {turns.length > 0 && <button className="mt-2 text-xs text-slate-500 underline" onClick={() => setTurns([])}>Clear conversation</button>}
    </Card>
    <Card title="User guide" actions={<div className="flex gap-2"><Input className="w-56" placeholder="Filter sections…" value={filter} onChange={(e) => setFilter(e.target.value)} /><Button size="sm" variant="outline" onClick={() => setOpen(new Set(shown.map((s) => s.id)))}>Open all</Button><Button size="sm" variant="outline" onClick={() => { setOpen(new Set(shown.map((s) => s.id))); setTimeout(() => window.print(), 100); }}>Print</Button></div>}>
      {d && <div className="mb-3 inline-flex flex-wrap rounded-xl bg-slate-50 p-1 ring-1 ring-slate-200">{([['mine', `My guide (${d.role})`], ['everyone', 'Guide for everyone'], ['topics', 'More topics for my role'], ...(d.allRoleGuides ? [['roles', 'Every role (for training)']] : [])] as [typeof tab, string][]).map(([k, l]) => <button key={k} onClick={() => { setTab(k); setOpen(new Set()); }} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === k ? 'bg-navy text-white shadow' : 'text-slate-600 hover:text-navy'}`}>{l}</button>)}</div>}
      {d && tab === 'everyone' && <div className="mb-2 text-sm text-slate-600"><Markdown text={d.intro.split('\n\n')[0]} /></div>}
      {d && tab === 'mine' && shown.map((s) => <div key={s.id} className="rounded-xl border border-slate-200 p-4"><h3 className="mb-1 text-base font-semibold text-navy">{s.title}</h3><Markdown text={s.body} /></div>)}
      {q.isLoading && <p className="text-sm text-slate-500">Loading…</p>}<ErrorBox error={q.error} />
      {d && !shown.length && <Empty>No section matches “{filter}”.</Empty>}
      <div className="divide-y">{(tab === 'mine' ? [] : shown).map((s) => <div key={s.id} id={`help-${s.id}`} className="scroll-mt-4 py-1">
        <button className="flex w-full items-center justify-between py-2 text-left text-sm font-semibold hover:text-brand" aria-expanded={open.has(s.id)} onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })}>{s.title}<span className="text-slate-400">{open.has(s.id) ? '−' : '+'}</span></button>
        {open.has(s.id) && <div className="pb-3"><Markdown text={s.body} /></div>}
      </div>)}</div>
    </Card>
  </div>;
}
