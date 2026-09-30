import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const button = cva('inline-flex items-center justify-center gap-2 rounded-xl text-sm font-bold tracking-tight transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/25 min-h-11 px-5 active:scale-[.97]', {
  variants: { variant: { default: 'grad-brand text-white shadow-[0_10px_20px_-8px_rgba(224,18,63,.6)] hover:brightness-105 hover:shadow-[0_14px_24px_-8px_rgba(224,18,63,.65)]', outline: 'bg-white text-navy shadow-soft hover:shadow-md hover:text-brand-dark', ghost: 'text-navy hover:bg-white/70', danger: 'bg-white text-brand-dark shadow-soft ring-1 ring-inset ring-red-200 hover:bg-brand-soft', subtle: 'bg-slate-200/80 text-navy shadow-inset hover:bg-slate-200' }, size: { sm: 'min-h-9 px-3.5 text-xs', md: '', lg: 'min-h-13 px-7 text-base' } },
  defaultVariants: { variant: 'default', size: 'md' },
});
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>>(({ className, variant, size, ...p }, ref) => <button ref={ref} className={cn(button({ variant, size }), className)} {...p} />);
Button.displayName = 'Button';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cn('w-full rounded-xl border-0 bg-white px-4 min-h-11 text-[15px] shadow-soft ring-1 ring-inset ring-slate-200/70 transition placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/60', className)} {...p} />);
Input.displayName = 'Input';
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => <select ref={ref} className={cn('w-full rounded-xl border-0 bg-white px-4 min-h-11 text-[15px] shadow-soft ring-1 ring-inset ring-slate-200/70 transition focus:outline-none focus:ring-2 focus:ring-brand/60', className)} {...p} />);
Select.displayName = 'Select';
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cn('w-full rounded-2xl border-0 bg-white px-4 py-3 text-[15px] shadow-soft ring-1 ring-inset ring-slate-200/70 transition placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/60', className)} {...p} />);
Textarea.displayName = 'Textarea';
export function Field({ label, children, hint, error, className }: { label: string; children: ReactNode; hint?: string; error?: string; className?: string }) {
  return <label className={cn('block text-sm', className)}><span className="mb-1.5 block text-[13px] font-semibold text-slate-600">{label}</span>{children}{hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}{error && <span className="mt-1 block text-xs text-red-600">{error}</span>}</label>;
}
export function Card({ title, children, actions, className }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return <section className={cn('rounded-[28px] bg-white shadow-card', className)}>{(title || actions) && <header className="flex flex-wrap items-center justify-between gap-2 px-6 pb-1 pt-5"><h2 className="flex items-center gap-2 text-[17px] font-extrabold tracking-tight text-navy">{title}</h2><div className="flex flex-wrap gap-2">{actions}</div></header>}<div className="p-6 pt-4">{children}</div></section>;
}
export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'purple' }) {
  const t = { slate: 'bg-slate-100 text-slate-700 ring-slate-200', green: 'bg-emerald-50 text-emerald-700 ring-emerald-200', amber: 'bg-amber-50 text-amber-800 ring-amber-200', red: 'bg-brand-soft text-brand-dark ring-red-200', blue: 'bg-sky-50 text-sky-700 ring-sky-200', purple: 'bg-violet-50 text-violet-700 ring-violet-200' }[tone];
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ring-1 ring-inset', t)}>{children}</span>;
}
export const statusTone = (s: string): 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'purple' => (/POSTED|APPROVED|RECEIVED|RESOLVED|CLOSED|FINALIZED|AUTO/.test(s) ? 'green' : /SUBMITTED|PENDING|OPEN|DISCREPANCY/.test(s) ? 'amber' : /REJECTED|VOIDED/.test(s) ? 'red' : /DRAFT/.test(s) ? 'slate' : 'blue');
export function Stat({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'red' | 'amber' | 'green'; icon?: ReactNode }) {
  return <div className={cn('relative h-full overflow-hidden rounded-[24px] bg-white p-5 shadow-card transition hover:-translate-y-0.5 hover:shadow-[0_26px_48px_-22px_rgba(30,41,59,.34)]', tone === 'red' && 'bg-gradient-to-br from-white to-brand-soft', tone === 'amber' && 'bg-gradient-to-br from-white to-amber-50', tone === 'green' && 'bg-gradient-to-br from-white to-emerald-50')}>
    <span className={cn('absolute left-5 top-0 h-1.5 w-10 rounded-b-full', tone === 'green' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-400' : 'grad-brand')} />
    <div className="flex items-start justify-between gap-2"><div className="text-[11px] font-bold uppercase tracking-[.1em] text-slate-500">{label}</div>{icon && <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-brand shadow-soft [&_svg]:size-4">{icon}</span>}</div>
    <div className="mt-2 text-[28px] font-extrabold leading-tight tracking-tight text-navy">{value}</div>{sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}</div>;
}
export function Empty({ children = 'Nothing here yet.' }: { children?: ReactNode }) { return <div className="py-8 text-center text-sm text-slate-500">{children}</div>; }
export function ErrorBox({ error }: { error: unknown }) { if (!error) return null; const e = error as { message?: string; body?: { issues?: { path: string[]; message: string }[] } }; return <div role="alert" className="mt-2 rounded-xl border border-red-200 bg-brand-soft p-3 text-sm text-brand-dark">{e.message}{e.body?.issues && <ul className="mt-1 list-disc pl-5 text-xs">{e.body.issues.map((i, k) => <li key={k}>{i.path.join('.')}: {i.message}</li>)}</ul>}</div>; }

/** Centered dialog over a dimmed page; closes on Escape or the backdrop. */
export function Modal({ title, children, onClose, wide }: { title: ReactNode; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }} onClick={onClose}>
    <div className={cn('max-h-[92vh] w-full overflow-y-auto rounded-[28px] bg-white shadow-2xl', wide ? 'max-w-3xl' : 'max-w-lg')} onClick={(e) => e.stopPropagation()}>
      <header className="px-6 pb-1 pt-5"><h2 className="text-xl font-extrabold tracking-tight text-navy">{title}</h2></header>
      <div className="p-6 pt-3">{children}</div>
    </div>
  </div>;
}
