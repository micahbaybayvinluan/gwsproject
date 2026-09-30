import { DateTime } from 'luxon';

export const ZONE = process.env.APP_TIMEZONE || 'Asia/Manila';

/** Manila calendar date (YYYY-MM-DD) for an instant. */
export function manilaDateStr(d: Date = new Date()): string {
  return DateTime.fromJSDate(d, { zone: 'utc' }).setZone(ZONE).toISODate()!;
}
/** A JS Date at UTC midnight representing the Manila calendar date — how Prisma @db.Date columns are stored. */
export function toDateOnly(d: Date | string = new Date()): Date {
  const iso = typeof d === 'string' ? d.slice(0, 10) : manilaDateStr(d);
  return new Date(`${iso}T00:00:00.000Z`);
}
export function todayManila(): Date { return toDateOnly(new Date()); }
export function addDays(d: Date, n: number): Date { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
export function addMonths(d: Date, n: number): Date { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; }
export function dateStr(d: Date): string { return d.toISOString().slice(0, 10); }
export function yesterdayManila(): Date { return addDays(todayManila(), -1); }
/** Instant of 00:00 Manila for a given calendar date. */
export function manilaMidnight(dateOnly: Date): Date {
  return DateTime.fromISO(dateStr(dateOnly), { zone: ZONE }).startOf('day').toJSDate();
}
export function isPastDate(dateOnly: Date): boolean { return dateStr(dateOnly) < manilaDateStr(); }
export function monthRange(year: number, month: number) {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  return { from, to };
}
export function daysBetween(a: Date, b: Date): number { return Math.floor((toDateOnly(b).getTime() - toDateOnly(a).getTime()) / 86400000); }
