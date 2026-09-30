import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const button = cva('inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold tracking-tight transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-1 min-h-10 px-4 active:scale-[.98]', {
  variants: { variant: { default: 'bg-brand text-white shadow-sm shadow-brand/20 hover:bg-brand-dark hover:shadow-md hover:shadow-brand/25', outline: 'border border-slate-200 bg-white text-navy shadow-xs hover:border-slate-300 hover:bg-slate-50', ghost: 'text-navy hover:bg-slate-100', danger: 'bg-white text-red-700 border border-red-200 hover:bg-red-50', subtle: 'bg-silver text-navy hover:bg-slate-200' }, size: { sm: 'min-h-8 px-3 text-xs', md: '', lg: 'min-h-12 px-6 text-base' } },
  defaultVariants: { variant: 'default', size: 'md' },
});
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>>(({ className, variant, size, ...p }, ref) => <button ref={ref} className={cn(button({ variant, size }), className)} {...p} />);
Button.displayName = 'Button';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cn('w-full rounded-lg border border-slate-200 bg-white px-3 min-h-10 text-sm shadow-xs transition placeholder:text-slate-400 focus:border-brand/50 focus:outline-none focus:ring-4 focus:ring-brand/10', className)} {...p} />);
Input.displayName = 'Input';
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => <select ref={ref} className={cn('w-full rounded-lg border border-slate-200 bg-white px-3 min-h-10 text-sm shadow-xs transition focus:border-brand/50 focus:outline-none focus:ring-4 focus:ring-brand/10', className)} {...p} />);
Select.displayName = 'Select';
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cn('w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-xs transition placeholder:text-slate-400 focus:border-brand/50 focus:outline-none focus:ring-4 focus:ring-brand/10', className)} {...p} />);
Textarea.displayName = 'Textarea';
export function Field({ label, children, hint, error, className }: { label: string; children: ReactNode; hint?: string; error?: string; className?: string }) {
  return <label className={cn('block text-sm', className)}><span className="mb-1.5 block text-[13px] font-medium text-slate-600">{label}</span>{children}{hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}{error && <span className="mt-1 block text-xs text-red-600">{error}</span>}</label>;
}
export function Card({ title, children, actions, className }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return <section className={cn('rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(11,31,58,.04),0_4px_16px_-8px_rgba(11,31,58,.08)]', className)}>{(title || actions) && <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5"><h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-navy">{title}</h2><div className="flex flex-wrap gap-2">{actions}</div></header>}<div className="p-5">{children}</div></section>;
}
export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'purple' }) {
  const t = { slate: 'bg-slate-100 text-slate-700 ring-slate-200', green: 'bg-emerald-50 text-emerald-700 ring-emerald-200', amber: 'bg-amber-50 text-amber-800 ring-amber-200', red: 'bg-brand-soft text-brand-dark ring-red-200', blue: 'bg-sky-50 text-sky-700 ring-sky-200', purple: 'bg-violet-50 text-violet-700 ring-violet-200' }[tone];
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', t)}>{children}</span>;
}
export const statusTone = (s: string): 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'purple' => (/POSTED|APPROVED|RECEIVED|RESOLVED|CLOSED|FINALIZED|AUTO/.test(s) ? 'green' : /SUBMITTED|PENDING|OPEN|DISCREPANCY/.test(s) ? 'amber' : /REJECTED|VOIDED/.test(s) ? 'red' : /DRAFT/.test(s) ? 'slate' : 'blue');
export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'red' | 'amber' | 'green' }) {
  return <div className={cn('relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(11,31,58,.04),0_4px_16px_-8px_rgba(11,31,58,.08)] transition hover:shadow-[0_2px_4px_rgba(11,31,58,.05),0_8px_24px_-10px_rgba(11,31,58,.14)]', tone === 'red' && 'border-red-200 bg-gradient-to-br from-white to-brand-soft', tone === 'amber' && 'border-amber-200 bg-gradient-to-br from-white to-amber-50', tone === 'green' && 'border-emerald-200 bg-gradient-to-br from-white to-emerald-50')}><span className={cn('absolute inset-y-0 left-0 w-1', tone === 'red' ? 'bg-brand' : tone === 'amber' ? 'bg-amber-400' : tone === 'green' ? 'bg-emerald-500' : 'bg-navy/80')} /><div className="text-[11px] font-semibold uppercase tracking-[.08em] text-slate-500">{label}</div><div className="mt-1.5 text-2xl font-bold tracking-tight text-navy">{value}</div>{sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}</div>;
}
export function Empty({ children = 'Nothing here yet.' }: { children?: ReactNode }) { return <div className="py-8 text-center text-sm text-slate-500">{children}</div>; }
export function ErrorBox({ error }: { error: unknown }) { if (!error) return null; const e = error as { message?: string; body?: { issues?: { path: string[]; message: string }[] } }; return <div role="alert" className="mt-2 rounded-xl border border-red-200 bg-brand-soft p-3 text-sm text-brand-dark">{e.message}{e.body?.issues && <ul className="mt-1 list-disc pl-5 text-xs">{e.body.issues.map((i, k) => <li key={k}>{i.path.join('.')}: {i.message}</li>)}</ul>}</div>; }

/** Centered dialog over a dimmed page; closes on Escape or the backdrop. */
export function Modal({ title, children, onClose, wide }: { title: ReactNode; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4" role="dialog" aria-modal="true" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }} onClick={onClose}>
    <div className={cn('w-full rounded-2xl bg-white shadow-2xl', wide ? 'max-w-3xl' : 'max-w-lg')} onClick={(e) => e.stopPropagation()}>
      <header className="border-b border-slate-100 px-5 py-4"><h2 className="text-lg font-semibold tracking-tight text-navy">{title}</h2></header>
      <div className="p-5">{children}</div>
    </div>
  </div>;
}
