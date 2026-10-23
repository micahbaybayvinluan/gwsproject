import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { navFor } from '@/components/Layout';
import { PAGES } from '@/lib/pages';

/** Everyday words people type for a screen, besides its menu name and purpose line. */
const WORDS: Record<string, string> = {
  '/cash-fund': 'petty cash fund warehouse franchise office imprest', '/expenses': 'expense pay cash fund receipt payee', '/sales': 'dr si delivery receipt sale invoice', '/sales/new': 'new sale dr walk-in credit card',
  '/stock': 'stock on hand inventory flavor expiry batch', '/payroll': 'payslip salary employee pay run sss philhealth pag-ibig', '/hr-notices': 'nte notice to explain late deposit discrepancy', '/charge-forms': 'charge deduction shortage hr',
  '/card-remittances': 'credit card bank remittance mdr fee net', '/ecom-waybills': 'waybill srp fees order income tiktok shopee lazada', '/ecommerce': 'tiktok shopee lazada payout orders online', '/franchise-ar': 'franchise receivable shipping payment penalty interest',
  '/approvals': 'approve request pending owner', '/transfers': 'transfer pull-out pullout stock send', '/ar': 'receivable collections credit customer pdc cheque', '/closing': 'daily close deposit cash count', '/reports': 'daily sales report dsr',
};
const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ');

/** Search box on the Dashboard: type part of a screen name or what it does; lists only the screens this person may open. Enter opens the first one. */
export function DashboardSearch() {
  const { canAny, me } = useAuth(); const nav = useNavigate(); const [q, setQ] = useState(''); const [pos, setPos] = useState(0); const box = useRef<HTMLInputElement>(null);
  const pages = useMemo(() => navFor(canAny, me?.roleKey).flatMap((g) => g.items.map((i) => ({ to: i.to, label: i.label, group: g.group, summary: PAGES[i.to]?.summary ?? '', hay: norm(`${i.label} ${g.group} ${PAGES[i.to]?.summary ?? ''} ${WORDS[i.to] ?? ''}`) }))), [canAny, me?.roleKey]);
  const terms = norm(q).split(' ').filter(Boolean);
  const hits = terms.length ? pages.map((p) => ({ p, score: terms.every((t) => p.hay.includes(t)) ? terms.reduce((n, t) => n + (norm(p.label).includes(t) ? 3 : 1), 0) : 0 })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 8).map((x) => x.p) : [];
  const go = (to: string) => { setQ(''); nav(to); };
  return <div className="relative" data-testid="dash-search">
    <label className="flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 shadow-card ring-1 ring-slate-200 focus-within:ring-2 focus-within:ring-brand">
      <Search size={18} className="text-slate-400" />
      <input ref={box} value={q} onChange={(e) => { setQ(e.target.value); setPos(0); }} placeholder="Search the menu: cash fund, expense, DR, payroll, stock…" aria-label="Search the menu" className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setPos((x) => Math.min(x + 1, hits.length - 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setPos((x) => Math.max(x - 1, 0)); } else if (e.key === 'Enter' && hits[pos]) go(hits[pos].to); else if (e.key === 'Escape') setQ(''); }} />
    </label>
    {terms.length > 0 && <ul className="absolute z-20 mt-1 max-h-96 w-full overflow-auto rounded-2xl bg-white p-1 shadow-2xl ring-1 ring-slate-200" role="listbox">
      {hits.length ? hits.map((h, i) => <li key={h.to} role="option" aria-selected={i === pos}><Link to={h.to} onClick={() => setQ('')} className={`block rounded-xl px-3 py-2 ${i === pos ? 'bg-amber-50' : 'hover:bg-slate-50'}`}><span className="text-sm font-semibold text-navy">{h.label}</span><span className="ml-2 text-[11px] uppercase tracking-wide text-slate-400">{h.group}</span><span className="block text-xs text-slate-500">{h.summary}</span></Link></li>) : <li className="px-3 py-3 text-sm text-slate-500">No screen matches “{q}” for your account.</li>}
    </ul>}
  </div>;
}
