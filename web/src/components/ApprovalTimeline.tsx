import { useQuery } from '@tanstack/react-query';
import { Check, Clock, X, Zap, CircleDashed } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

export interface TimelineStep { who: string; status: 'approved' | 'rejected' | 'waiting' | 'auto' | 'cancelled'; by?: string; at?: string; note?: string | null; people?: string[] }
export interface TimelineItem { id: string; type: string; label: string; status: string; createdAt: string; decidedAt: string | null; requestedBy: string; steps: TimelineStep[]; nextSteps: string[]; controlNo?: string | null; locationName?: string | null; link?: string }

const LABEL: Record<string, string> = { COST_ON_RECEIVING: 'Cost approval', WAREHOUSE_IN: 'In-Charge: goods in', WAREHOUSE_OUT: 'In-Charge: goods out', TRANSFER_INTERNAL: 'Transfer approval', TRANSFER_TO_FRANCHISE: 'Franchise transfer approval', SPECIAL_PRICE: 'Special price', POST_CLOSE_EDIT: 'Post-close edit', AUDIT_REVISION: 'Audit correction', WRITEOFF: 'Write-off', PRICE_CHANGE: 'Price change', COUNT_REVISION: 'Count revision', AR_PAYMENT: 'AR payment', DISCREPANCY_EXPLANATION: 'Explanation', DISCREPANCY_RESOLUTION: 'Discrepancy resolution', WAREHOUSE_EDIT: 'Edit acceptance', MASTER_DATA_NEW: 'Owner approval', REVALUATION: 'Revaluation', PERIOD_LOCK: 'Period lock', CASH_DEPOSIT_EXTENSION: 'Deposit extension', CONSIGNMENT_CHECK_WH: 'In-Charge check', CONSIGNMENT_CHECK_BRANCH: 'Auditor check', CONSIGNMENT_OUT: 'Owner approval', COST_EDIT: 'Cost change', ECOM_PULLOUT: 'In-Charge: e-commerce pull-out', ECOM_SETTLEMENT: 'Accounting: e-commerce payout' };
export const approvalLabel = (t: string) => LABEL[t] ?? t.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const when = (d?: string | null) => (d ? new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

function Dot({ status }: { status: TimelineStep['status'] | 'upcoming' }) {
  const cls = { approved: 'bg-emerald-500 text-white ring-emerald-100', auto: 'bg-emerald-500 text-white ring-emerald-100', rejected: 'bg-brand text-white ring-red-100', waiting: 'bg-amber-400 text-white ring-amber-100 animate-pulse', cancelled: 'bg-slate-300 text-white ring-slate-100', upcoming: 'bg-white text-slate-400 ring-slate-200 border border-dashed border-slate-300' }[status];
  const Icon = status === 'approved' ? Check : status === 'auto' ? Zap : status === 'rejected' ? X : status === 'waiting' ? Clock : CircleDashed;
  return <span className={cn('grid size-7 shrink-0 place-items-center rounded-full ring-4', cls)}><Icon size={14} strokeWidth={3} /></span>;
}

/** Steps as a vertical stepper: who approved (with time), who is still waiting (with names), and what comes next. */
export function StepList({ items }: { items: TimelineItem[] }) {
  const rows: { key: string; title: string; status: TimelineStep['status'] | 'upcoming'; detail: string }[] = [];
  for (const it of items) {
    for (const [k, s] of it.steps.entries()) rows.push({ key: `${it.id}-${k}`, title: `${approvalLabel(it.type)} — ${s.who}`, status: s.status, detail: s.status === 'approved' ? `Approved by ${s.by ?? s.who}${s.at ? ` · ${when(s.at)}` : ''}${s.note ? ` · “${s.note}”` : ''}` : s.status === 'auto' ? `Approved automatically${s.at ? ` · ${when(s.at)}` : ''}` : s.status === 'rejected' ? `Rejected by ${s.by ?? s.who}${s.at ? ` · ${when(s.at)}` : ''}${s.note ? ` · “${s.note}”` : ''}` : s.status === 'cancelled' ? 'Cancelled (document changed)' : `Waiting${s.people?.length ? ` for ${s.people.join(', ')}` : ''}` });
    for (const [k, n] of it.nextSteps.entries()) rows.push({ key: `${it.id}-n${k}`, title: n, status: 'upcoming', detail: 'Next, after the step above' });
  }
  return <ol className="relative space-y-4">
    {rows.map((r, i) => <li key={r.key} className="relative flex gap-3">
      {i < rows.length - 1 && <span className="absolute left-[13px] top-8 h-[calc(100%-4px)] w-0.5 bg-slate-200" />}
      <Dot status={r.status} />
      <div className="min-w-0 pt-0.5"><div className={cn('text-sm font-semibold', r.status === 'upcoming' ? 'text-slate-400' : 'text-navy')}>{r.title}</div><div className={cn('text-xs', r.status === 'waiting' ? 'font-medium text-amber-700' : r.status === 'rejected' ? 'text-brand-dark' : 'text-slate-500')}>{r.detail}</div></div>
    </li>)}
  </ol>;
}

/** Visual approval workflow of one document (owner request 2026-09-26). Hidden while the document has no approvals. */
export function ApprovalTimeline({ documentType, documentId, title = 'Approval workflow' }: { documentType: string; documentId: string; title?: string }) {
  const q = useQuery({ queryKey: ['timeline', documentType, documentId], queryFn: () => api.get<TimelineItem[]>(`/api/approvals/timeline/${documentType}/${documentId}`), refetchInterval: 20000 });
  if (!q.data?.length) return null;
  const waiting = q.data.flatMap((t) => t.steps.filter((s) => s.status === 'waiting'));
  return <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(11,31,58,.04)]" data-testid="approval-timeline">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-[15px] font-semibold text-navy">{title}</h2>{waiting.length ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">Waiting for {waiting.map((w) => w.who).join(', ')}</span> : <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">No approvals pending</span>}</div>
    <StepList items={q.data} />
  </section>;
}

/** One-line progress for lists and the dashboard: ✓ Head Auditor · ⏳ Asst Auditor. */
export function StepChips({ item }: { item: TimelineItem }) {
  return <span className="flex flex-wrap gap-1">{item.steps.map((s, i) => <span key={i} className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', s.status === 'approved' || s.status === 'auto' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : s.status === 'rejected' ? 'bg-brand-soft text-brand-dark ring-red-200' : s.status === 'waiting' ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-slate-50 text-slate-500 ring-slate-200')}>{s.status === 'approved' || s.status === 'auto' ? <Check size={11} /> : s.status === 'rejected' ? <X size={11} /> : <Clock size={11} />}{s.who}</span>)}{item.nextSteps.map((n, i) => <span key={`n${i}`} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-400 ring-1 ring-inset ring-slate-200 ring-dashed"><CircleDashed size={11} />{n}</span>)}</span>;
}
