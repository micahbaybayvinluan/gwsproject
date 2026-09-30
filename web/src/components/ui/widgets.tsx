import { useState, type ReactNode } from 'react';
import type * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Soft, eye-friendly building blocks in the orange-to-crimson style (owner request 2026-09-30). */

/** A rounded white tile with a gradient icon, like the icon row of the design. */
export function IconTile({ children, className, size = 'md' }: { children: ReactNode; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={cn('grid shrink-0 place-items-center rounded-2xl bg-white text-brand shadow-soft', size === 'sm' ? 'size-9 [&_svg]:size-4' : size === 'lg' ? 'size-14 [&_svg]:size-7' : 'size-11 [&_svg]:size-5', className)}>{children}</span>;
}

/** A clear on / off switch (instead of a small tick box) for settings. */
export function Toggle({ checked, onChange, label, disabled, onLabel = 'ON', offLabel = 'OFF' }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean; onLabel?: string; offLabel?: string }) {
  return <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className="group inline-flex items-center gap-3 rounded-full text-sm font-semibold text-navy disabled:opacity-50">
    <span className={cn('relative inline-flex h-9 w-[5.5rem] items-center rounded-full px-1 shadow-inset transition-colors', checked ? 'bg-white' : 'bg-slate-200')}>
      <span className={cn('absolute size-7 rounded-full shadow-md transition-all duration-200', checked ? 'left-1 bg-gradient-to-br from-[#ff8a2b] to-[#e0123f]' : 'left-[3.4rem] bg-white')} />
      <span className={cn('absolute text-[11px] font-bold tracking-wide', checked ? 'right-3 text-navy' : 'left-3 text-slate-500')}>{checked ? onLabel : offLabel}</span>
    </span>
    {label && <span className="font-medium">{label}</span>}
  </button>;
}

/** Daily | Monthly | Yearly style switch. */
export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return <div className="inline-flex rounded-xl bg-slate-200/80 p-1 shadow-inset" role="tablist">{options.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)} className={cn('rounded-lg px-3.5 py-1.5 text-sm font-semibold transition', value === k ? 'grad-brand text-white shadow-md' : 'text-slate-600 hover:text-navy')}>{l}</button>)}</div>;
}

/** Circular progress (80%): the ring fills with the gradient, the value sits in the middle. */
export function RingGauge({ pct, label, sub, size = 132, tone = 'brand' }: { pct: number; label?: ReactNode; sub?: ReactNode; size?: number; tone?: 'brand' | 'green' }) {
  const v = Math.max(0, Math.min(100, pct)); const r = 46; const c = 2 * Math.PI * r; const id = `g${tone}${size}`;
  return <div className="relative grid place-items-center rounded-full bg-white shadow-soft" style={{ width: size, height: size }}>
    <svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90" aria-hidden>
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1">{tone === 'green' ? <><stop offset="0" stopColor="#34d399" /><stop offset="1" stopColor="#059669" /></> : <><stop offset="0" stopColor="#ff8a2b" /><stop offset="1" stopColor="#e0123f" /></>}</linearGradient></defs>
      <circle cx="60" cy="60" r={r} fill="none" stroke="#e5e7eb" strokeWidth="11" />
      <circle cx="60" cy="60" r={r} fill="none" stroke={`url(#${id})`} strokeWidth="11" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} />
    </svg>
    <div className="relative text-center leading-tight"><div className="text-2xl font-bold text-navy">{label ?? `${Math.round(v)}%`}</div>{sub && <div className="mx-auto max-w-[6.5rem] text-[11px] text-slate-500">{sub}</div>}</div>
  </div>;
}

/** Rounded vertical bars on a grey track, filled with the gradient: one per period. Amounts are shown in full, never rounded. */
export function CapsuleBars({ data, format, height = 190 }: { data: { label: string; value: number }[]; format: (v: number) => string; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value)); const [hover, setHover] = useState<number | null>(null);
  return <div className="relative">
    <div className="flex items-end gap-1.5 sm:gap-2.5" style={{ height }}>{data.map((d, i) => <div key={d.label} className="group flex h-full flex-1 flex-col items-center justify-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
      <div className="relative flex w-full max-w-[26px] flex-1 items-end overflow-hidden rounded-full bg-slate-200"><div className="grad-brand-v w-full rounded-full transition-all duration-500" style={{ height: `${Math.max(d.value > 0 ? 4 : 0, (d.value / max) * 100)}%` }} /></div>
    </div>)}</div>
    <div className="mt-2 flex gap-1.5 sm:gap-2.5">{data.map((d) => <div key={d.label} className="flex-1 text-center text-[10.5px] font-medium text-slate-500">{d.label}</div>)}</div>
    {hover != null && <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-xl bg-navy px-3 py-1.5 text-xs font-semibold text-white shadow-lg">{data[hover].label}: {format(data[hover].value)}</div>}
  </div>;
}

/** A month calendar card. Selected day is a gradient tile; `marks` colour days that need attention; every day is one click. */
export function CalendarCard({ value, onSelect, marks, title, max }: { value: string; onSelect: (d: string) => void; marks?: Record<string, { tone: 'red' | 'amber' | 'green'; hint?: string }>; title?: ReactNode; max?: string }) {
  const [view, setView] = useState(() => { const d = new Date(`${value}T00:00:00Z`); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; });
  const first = new Date(Date.UTC(view.y, view.m, 1)); const days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate(); const lead = first.getUTCDay();
  const name = first.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }).toUpperCase();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${view.y}-${String(view.m + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)];
  const move = (n: number) => setView(({ y, m }) => { const t = new Date(Date.UTC(y, m + n, 1)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() }; });
  return <div className="rounded-[28px] bg-white p-5 shadow-card">
    <div className="flex items-center justify-between"><div className="text-3xl font-extrabold tracking-wide text-navy">{view.y}</div>{title}</div>
    <div className="mt-2 flex items-center justify-between"><button type="button" onClick={() => move(-1)} className="grid size-8 place-items-center rounded-lg bg-navy text-white shadow-md" aria-label="Previous month"><ChevronLeft size={16} /></button><div className="text-sm font-bold tracking-[.2em] text-navy">{name}</div><button type="button" onClick={() => move(1)} className="grid size-8 place-items-center rounded-lg bg-navy text-white shadow-md" aria-label="Next month"><ChevronRight size={16} /></button></div>
    <div className="mt-3 grid grid-cols-7 gap-y-1 text-center text-[11px] font-bold text-navy">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} className="py-1">{d}</div>)}
      {cells.map((d, i) => { if (!d) return <div key={`b${i}`} />; const mk = marks?.[d]; const sel = d === value; const off = !!max && d > max;
        return <button key={d} type="button" disabled={off} onClick={() => onSelect(d)} title={mk?.hint} className={cn('relative mx-auto grid size-9 place-items-center rounded-xl text-sm font-medium transition', sel ? 'grad-brand text-white shadow-md shadow-brand/40' : mk?.tone === 'red' ? 'bg-brand-soft font-bold text-brand-dark ring-1 ring-red-200 hover:ring-brand' : mk?.tone === 'amber' ? 'bg-amber-50 font-bold text-amber-800 ring-1 ring-amber-200 hover:ring-amber-400' : mk?.tone === 'green' ? 'bg-emerald-50 text-emerald-800 hover:ring-1 hover:ring-emerald-300' : 'text-slate-700 hover:bg-slate-100', off && 'opacity-30')}>{Number(d.slice(8))}{mk && !sel && <span className={cn('absolute -right-0.5 -top-0.5 size-2 rounded-full', mk.tone === 'red' ? 'bg-brand' : mk.tone === 'amber' ? 'bg-amber-500' : 'bg-emerald-500')} />}</button>; })}
    </div>
    {marks && Object.keys(marks).length > 0 && <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500"><span className="flex items-center gap-1"><span className="size-2 rounded-full bg-brand" /> overdue</span><span className="flex items-center gap-1"><span className="size-2 rounded-full bg-amber-500" /> still to deposit</span></div>}
  </div>;
}

/** A pill field with a round gradient icon on the left (username, password, e-mail, phone…). */
export function IconInput({ icon, className, ...p }: { icon: ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <span className={cn('flex items-center gap-3 rounded-full bg-white p-1.5 pr-5 shadow-soft ring-1 ring-inset ring-slate-200/70 focus-within:ring-2 focus-within:ring-brand/60', className)}>
    <span className="grid size-10 shrink-0 place-items-center rounded-full grad-brand text-white shadow-md shadow-brand/30 [&_svg]:size-[18px]">{icon}</span>
    <input className="min-h-10 w-full bg-transparent text-[15px] outline-none placeholder:text-slate-400" {...p} />
  </span>;
}
