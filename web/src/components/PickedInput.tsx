import type { ReactNode } from 'react';
import { Input } from '@/components/ui/primitives';

/**
 * A search box for choosing ONE item (product, customer…). Once something is chosen its name is shown inside the box itself
 * (with ✕ to change it), never beside the label. `fallback` is what applies while nothing is chosen (shown as the grey text in the box).
 * Put the list of matches in `children`; it is shown under the box while the person is typing.
 */
export function PickedInput({ picked, onClear, search, onSearch, placeholder, fallback, children, autoFocus }: { picked: string | null; onClear: () => void; search: string; onSearch: (v: string) => void; placeholder?: string; fallback?: string; children?: ReactNode; autoFocus?: boolean }) {
  return <div className="relative">
    {picked
      ? <div className="flex min-h-11 items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm shadow-soft"><span className="min-w-0 flex-1 truncate font-semibold text-emerald-900" title={picked}>{picked}</span><button type="button" className="shrink-0 text-xs font-semibold text-red-600 hover:underline" onClick={onClear} aria-label="Change the choice">✕ change</button></div>
      : <Input autoFocus={autoFocus} value={search} onChange={(e) => onSearch(e.target.value)} placeholder={fallback ? `${fallback} — or type to search another…` : placeholder} autoComplete="off" />}
    {!picked && children}
  </div>;
}
