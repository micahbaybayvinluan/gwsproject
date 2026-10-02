import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';

/** Rows needed before the search box appears (short tables do not need one). */
export const SEARCH_MIN_ROWS = 6;
const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * Search box for any table (owner request 2026-10-02): wrap a `<table>` and the typed words (all must appear, any order) hide the rows
 * that do not match. It looks at everything shown in the row. The box appears once the table has {SEARCH_MIN_ROWS} or more rows.
 */
export function Searchable({ children, placeholder = 'Search this list…' }: { children: ReactNode; placeholder?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState(''); const [count, setCount] = useState(0); const [shown, setShown] = useState<number | null>(null);
  // runs after every render so rows added later are filtered too
  useEffect(() => {
    const rows = Array.from(box.current?.querySelectorAll<HTMLTableRowElement>('tbody > tr') ?? []);
    const ws = words(q);
    let visible = 0;
    for (const r of rows) {
      const hit = !ws.length || ws.every((w) => `${r.textContent ?? ''} ${Array.from(r.querySelectorAll('input,select')).map((i) => (i as HTMLInputElement).value).join(' ')}`.toLowerCase().includes(w));
      r.style.display = hit ? '' : 'none'; if (hit) visible++;
    }
    setCount((c) => (c === rows.length ? c : rows.length)); setShown((s) => { const n = ws.length ? visible : null; return s === n ? s : n; });
  });
  return <div ref={box}>
    {count >= SEARCH_MIN_ROWS && <div className="mb-2 flex flex-wrap items-center gap-2"><label className="relative block w-full max-w-sm"><Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Search this list" className="w-full rounded-xl border-0 bg-white py-2 pl-9 pr-3 text-sm shadow-soft outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-brand/50" /></label>{shown != null && <span className="text-xs text-slate-500">{shown} of {count} rows</span>}</div>}
    {children}
  </div>;
}
