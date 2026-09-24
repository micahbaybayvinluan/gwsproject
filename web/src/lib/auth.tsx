import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setToken } from './api';

export interface Me { id: string; username: string; fullName: string; roleKey: string; permissions: string[]; locations: { id: string; code: string; name: string; type: string; isSelling: boolean }[]; locationScoped: boolean; totpVerified: boolean }
interface Ctx { me: Me | null; loading: boolean; refresh: () => Promise<void>; logout: () => Promise<void>; can: (...keys: string[]) => boolean; canAny: (...keys: string[]) => boolean }
const AuthCtx = createContext<Ctx>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null); const [loading, setLoading] = useState(true);
  const refresh = async () => { try { setMe(await api.get<Me>('/api/auth/me')); } catch { setMe(null); } finally { setLoading(false); } };
  useEffect(() => { void refresh(); }, []);
  const logout = async () => { await api.post('/api/auth/logout').catch(() => undefined); setToken(null); setMe(null); window.location.href = '/login'; };
  const can = (...keys: string[]) => !!me && keys.every((k) => me.permissions.includes(k));
  const canAny = (...keys: string[]) => !!me && keys.some((k) => me.permissions.includes(k));
  return <AuthCtx.Provider value={{ me, loading, refresh, logout, can, canAny }}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);
