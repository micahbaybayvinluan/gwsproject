import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** The last 10 digits of a mobile number (09171234567, +63 917 123 4567 and 917 123 4567 are the same person), or null. */
export function phoneKeyOf(raw?: string | null): string | null {
  const d = (raw ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
}
export const emailKeyOf = (raw?: string | null) => { const e = (raw ?? '').trim().toLowerCase(); return /^\S+@\S+\.\S+$/.test(e) ? e : null; };
export const newQrToken = () => randomBytes(12).toString('hex');
/** What the QR code says. */
export const qrValue = (token: string) => `WHY:${token}`;
export const memberNoOf = (n: number) => `WHY-${String(n).padStart(6, '0')}`;

const secret = () => process.env.SESSION_SECRET || 'dev-secret';
const b64 = (s: string) => Buffer.from(s).toString('base64url');
/** A signed, expiring token (members' portal sessions, unsubscribe links). */
export function signToken(payload: Record<string, unknown>, days: number): string {
  const body = b64(JSON.stringify({ ...payload, e: Date.now() + days * 86400000 }));
  return `${body}.${createHmac('sha256', secret()).update(body).digest('base64url')}`;
}
export function verifyToken<T extends Record<string, unknown>>(token: string | undefined | null): (T & { e: number }) | null {
  if (!token) return null; const [body, sig] = token.split('.'); if (!body || !sig) return null;
  const want = createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(want); if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { e: number }; return p.e > Date.now() ? p : null; } catch { return null; }
}

/** Philippine mobile number in the 09XXXXXXXXX form, or null. */
export function phMobile(raw?: string | null): string | null {
  const d = (raw ?? '').replace(/\D/g, '');
  const n = d.startsWith('63') ? `0${d.slice(2)}` : d.startsWith('9') && d.length === 10 ? `0${d}` : d;
  return /^09\d{9}$/.test(n) ? n : null;
}

/** The public web address customers use (the unsubscribe and survey links point to it). */
export const publicUrl = () => (process.env.PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, '');
export const unsubscribeUrl = (channel: 'EMAIL' | 'SMS', key: string) => `${publicUrl()}/api/portal/unsubscribe?t=${encodeURIComponent(signToken({ c: channel, k: key }, 3650))}`;
