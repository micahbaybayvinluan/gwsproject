/** Thin fetch wrapper. Session cookie is httpOnly; we also keep the bearer token for mobile Safari (cookie fallback). */
const BASE = import.meta.env.VITE_API_URL || '';
let token: string | null = localStorage.getItem('gws_token');
export const setToken = (t: string | null) => { token = t; if (t) localStorage.setItem('gws_token', t); else localStorage.removeItem('gws_token'); };

export class ApiError extends Error { constructor(public status: number, public body: unknown) { super(typeof (body as { message?: unknown })?.message === 'string' ? (body as { message: string }).message : `HTTP ${status}`); } get code() { return (this.body as { code?: string })?.code; } }

async function req<T>(method: string, path: string, body?: unknown, opts: { raw?: boolean; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !opts.form) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method, headers, credentials: 'include', body: opts.form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  if (res.status === 401 && !path.includes('/auth/login')) { const j = await res.json().catch(() => ({})); if (j.code === 'TOTP_REQUIRED') { window.location.href = '/login?totp=1'; } else if (j.code === 'SESSION_REPLACED') { setToken(null); window.location.href = '/login?replaced=1'; } else { setToken(null); if (!window.location.pathname.startsWith('/login') && window.location.pathname !== '/member') window.location.href = '/login'; } throw new ApiError(401, j); }
  if (!res.ok) { const body = await res.json().catch(() => ({ message: res.statusText })); if (res.status === 403 && ['PASSWORD_CHANGE_REQUIRED', 'ACCOUNTABILITY_REQUIRED'].includes((body as { code?: string }).code ?? '') && window.location.pathname !== '/') window.location.href = '/'; throw new ApiError(res.status, body); }
  if (opts.raw) return (await res.blob()) as unknown as T;
  const text = await res.text(); return (text ? JSON.parse(text) : null) as T;
}
export const api = {
  get: <T,>(p: string) => req<T>('GET', p),
  post: <T,>(p: string, b?: unknown) => req<T>('POST', p, b),
  put: <T,>(p: string, b?: unknown) => req<T>('PUT', p, b),
  patch: <T,>(p: string, b?: unknown) => req<T>('PATCH', p, b),
  delete: <T,>(p: string) => req<T>('DELETE', p),
  /** A file (e.g. a proof-of-payment image) as a Blob, sent with the sign-in token. */
  blob: (p: string) => req<Blob>('GET', p, undefined, { raw: true }),
  upload: <T,>(p: string, file: File) => { const f = new FormData(); f.append('file', file); return req<T>('POST', p, undefined, { form: f }); },
  /** Several files under one field name (e.g. waybill PDFs). */
  uploadMany: <T,>(p: string, files: File[], field = 'files') => { const f = new FormData(); files.forEach((x) => f.append(field, x)); return req<T>('POST', p, undefined, { form: f }); },
  download: async (p: string, fileName: string) => { const blob = await req<Blob>('GET', p, undefined, { raw: true }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName; a.click(); URL.revokeObjectURL(a.href); },
  downloadPost: async (p: string, body: unknown, fileName: string) => { const headers: Record<string, string> = { 'Content-Type': 'application/json' }; if (token) headers.Authorization = `Bearer ${token}`; const res = await fetch(`${BASE}${p}`, { method: 'POST', headers, credentials: 'include', body: JSON.stringify(body) }); const blob = await res.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName; a.click(); },
};
export const peso = (v: unknown) => `₱${Number(v ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtDate = (v: unknown) => (v ? String(v).slice(0, 10) : '');
export const today = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); // Manila
