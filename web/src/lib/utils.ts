import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export const cn = (...i: ClassValue[]) => twMerge(clsx(i));

/** A location's name for option lists: franchises (and consignees) are marked beside the name (owner request 2026-09-29). */
export const locLabel = (l: { name: string; type?: string | null }) =>
  l.name + (l.type === 'FRANCHISE' ? ' (franchise)' : l.type === 'CONSIGNEE' ? ' (consignee)' : '');

/** A person as HR sees them everywhere: the name with the position ("Ana Cruz · Cashier"). */
export function personLabel(p: { fullName?: string; name?: string; position?: string | null }): string {
  const n = p.fullName ?? p.name ?? ''; return p.position ? `${n} · ${p.position}` : n;
}
