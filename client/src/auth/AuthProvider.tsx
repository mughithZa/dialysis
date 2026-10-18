import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeDto } from '@dialysis/shared';
import { ApiError, apiGet, apiPost } from '../api';

const CENTRE_KEY = 'centreId';
const ME_KEY = ['me'] as const;

export function readStoredCentre(): string | null {
  try {
    return localStorage.getItem(CENTRE_KEY);
  } catch {
    return null;
  }
}

function storeCentre(id: string) {
  try {
    localStorage.setItem(CENTRE_KEY, id);
  } catch {
    /* storage unavailable: choice just isn't remembered */
  }
}

/** The remembered centre if the user still has it, otherwise their first centre. */
export function resolveCentreId(me: MeDto | null, stored: string | null): string | null {
  if (!me) return null;
  if (stored && me.centres.some((c) => c.id === stored)) return stored;
  return me.centres[0]?.id ?? null;
}

/**
 * Stops reminders to this device before logging out, so the next person to use it does not get them.
 * Best effort: failures are ignored. getRegistration (not `ready`) so this never hangs without a service worker.
 */
async function dropPushSubscription(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await apiPost('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  } catch {
    /* ignore: logging out matters more */
  }
}

interface AuthValue {
  me: MeDto | null;
  /** True until the initial session check finishes. */
  loading: boolean;
  login(username: string, password: string): Promise<MeDto>;
  logout(): Promise<void>;
}

interface CentreValue {
  centreId: string | null;
  setCentreId(id: string): void;
}

const AuthContext = createContext<AuthValue | null>(null);
const CentreContext = createContext<CentreValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [stored, setStored] = useState<string | null>(readStoredCentre);

  const query = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await apiGet<MeDto>('/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: Infinity,
  });
  const me = query.data ?? null;

  const login = useCallback(
    async (username: string, password: string) => {
      const { user } = await apiPost<{ user: MeDto }>('/auth/login', { username, password });
      qc.setQueryData(ME_KEY, user);
      return user;
    },
    [qc],
  );

  const logout = useCallback(async () => {
    await dropPushSubscription();
    await apiPost('/auth/logout');
    // Not qc.clear(): that detaches the mounted `me` observer from its query, so the UI would keep the old user.
    qc.setQueryData(ME_KEY, null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] });
  }, [qc]);

  const setCentreId = useCallback((id: string) => {
    storeCentre(id);
    setStored(id);
  }, []);

  const auth = useMemo<AuthValue>(
    () => ({ me, loading: query.isPending, login, logout }),
    [me, query.isPending, login, logout],
  );
  const centreId = resolveCentreId(me, stored);
  const centre = useMemo<CentreValue>(() => ({ centreId, setCentreId }), [centreId, setCentreId]);

  return (
    <AuthContext.Provider value={auth}>
      <CentreContext.Provider value={centre}>{children}</CentreContext.Provider>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function useCentre(): CentreValue {
  const ctx = useContext(CentreContext);
  if (!ctx) throw new Error('useCentre must be used inside AuthProvider');
  return ctx;
}
