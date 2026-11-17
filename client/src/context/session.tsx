import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { readableOn } from '../lib/format';
import { disconnectSocket } from '../lib/socket';
import type { Brand, Session } from '../lib/types';

interface Ctx {
  session: Session | null;
  loading: boolean;
  setSession: (s: Session | null) => void;
  logout: () => Promise<void>;
}

const SessionCtx = createContext<Ctx | null>(null);

/** Applies an organisation's brand color to the whole UI via CSS variables. */
export function applyBrand(brand: Pick<Brand, 'brandColor' | 'name'> | null) {
  const color = brand?.brandColor ?? '#4f46e5';
  document.documentElement.style.setProperty('--brand', color);
  document.documentElement.style.setProperty('--brand-fg', readableOn(color));
  if (brand?.name) document.title = `${brand.name} · Client Portal`;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['session'],
    queryFn: () => api.get<Session | null>('/auth/session'),
    staleTime: 5 * 60_000,
    retry: (count, e) => !(e instanceof ApiError && e.status < 500) && count < 2,
  });

  useEffect(() => {
    if (data) applyBrand(data.org);
  }, [data]);

  const setSession = (s: Session | null) => qc.setQueryData(['session'], s);
  const logout = async () => {
    await api.post('/auth/logout').catch(() => {});
    disconnectSocket();
    qc.clear();
    qc.setQueryData(['session'], null);
    applyBrand(null);
  };

  return (
    <SessionCtx.Provider value={{ session: data ?? null, loading: isLoading, setSession, logout }}>{children}</SessionCtx.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionCtx);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}

/** For pages rendered inside the authenticated layout. */
export function useMe() {
  const { session } = useSession();
  if (!session) throw new Error('Not authenticated');
  const role = session.user.role;
  return {
    ...session,
    isStaff: role !== 'CLIENT',
    isAdmin: role === 'OWNER' || role === 'ADMIN',
    isClient: role === 'CLIENT',
  };
}
