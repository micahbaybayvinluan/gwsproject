import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export const cn = (...i: ClassValue[]) => twMerge(clsx(i));

/** A location's name for option lists: franchises (and consignees) are marked beside the name (owner request 2026-09-29). */
export const locLabel = (l: { name: string; type?: string | null }) =>
  l.name + (l.type === 'FRANCHISE' ? ' (franchise)' : l.type === 'CONSIGNEE' ? ' (consignee)' : '');
