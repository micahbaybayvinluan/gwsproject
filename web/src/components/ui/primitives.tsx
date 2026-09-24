import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const button = cva('inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition disabled:opacity-50 disabled:pointer-events-none focus:outline-none focus:ring-2 focus:ring-brand/40 min-h-10 px-4', {
  variants: { variant: { default: 'bg-brand text-white hover:bg-brand-dark', outline: 'border border-slate-300 bg-white hover:bg-slate-50', ghost: 'hover:bg-slate-100', danger: 'bg-red-600 text-white hover:bg-red-700', subtle: 'bg-slate-100 text-slate-800 hover:bg-slate-200' }, size: { sm: 'min-h-8 px-3 text-xs', md: '', lg: 'min-h-12 px-6 text-base' } },
  defaultVariants: { variant: 'default', size: 'md' },
});
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>>(({ className, variant, size, ...p }, ref) => <button ref={ref} className={cn(button({ variant, size }), className)} {...p} />);
Button.displayName = 'Button';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cn('w-full rounded-md border border-slate-300 bg-white px-3 min-h-10 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand/40', className)} {...p} />);
Input.displayName = 'Input';
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => <select ref={ref} className={cn('w-full rounded-md border border-slate-300 bg-white px-3 min-h-10 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand/40', className)} {...p} />);
Select.displayName = 'Select';
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cn('w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand/40', className)} {...p} />);
Textarea.displayName = 'Textarea';
export function Field({ label, children, hint, error, className }: { label: string; children: ReactNode; hint?: string; error?: string; className?: string }) {
  return <label className={cn('block text-sm', className)}><span className="mb-1 block font-medium text-slate-700">{label}</span>{children}{hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}{error && <span className="mt-1 block text-xs text-red-600">{error}</span>}</label>;
}
export function Card({ title, children, actions, className }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return <section className={cn('rounded-lg border border-slate-200 bg-white shadow-sm', className)}>{(title || actions) && <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3"><h2 className="font-semibold">{title}</h2><div className="flex flex-wrap gap-2">{actions}</div></header>}<div className="p-4">{children}</div></section>;
}
export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'purple' }) {
  const t = { slate: 'bg-slate-100 text-slate-700', green: 'bg-emerald-100 text-emerald-800', amber: 'bg-amber-100 text-amber-800', red: 'bg-red-100 text-red-800', blue: 'bg-blue-100 text-blue-800', purple: 'bg-purple-100 text-purple-800' }[tone];
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', t)}>{children}</span>;
}
export const statusTone = (s: string): 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'purple' => (/POSTED|APPROVED|RECEIVED|RESOLVED|CLOSED|FINALIZED|AUTO/.test(s) ? 'green' : /SUBMITTED|PENDING|OPEN|DISCREPANCY/.test(s) ? 'amber' : /REJECTED|VOIDED/.test(s) ? 'red' : /DRAFT/.test(s) ? 'slate' : 'blue');
export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'red' | 'amber' | 'green' }) {
  return <div className={cn('rounded-lg border bg-white p-4 shadow-sm', tone === 'red' && 'border-red-200 bg-red-50', tone === 'amber' && 'border-amber-200 bg-amber-50', tone === 'green' && 'border-emerald-200 bg-emerald-50')}><div className="text-xs uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div>{sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}</div>;
}
export function Empty({ children = 'Nothing here yet.' }: { children?: ReactNode }) { return <div className="py-8 text-center text-sm text-slate-500">{children}</div>; }
export function ErrorBox({ error }: { error: unknown }) { if (!error) return null; const e = error as { message?: string; body?: { issues?: { path: string[]; message: string }[] } }; return <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{e.message}{e.body?.issues && <ul className="mt-1 list-disc pl-5 text-xs">{e.body.issues.map((i, k) => <li key={k}>{i.path.join('.')}: {i.message}</li>)}</ul>}</div>; }
