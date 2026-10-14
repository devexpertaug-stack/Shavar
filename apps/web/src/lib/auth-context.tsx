'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { AuthUser } from '@estateflow/shared';
import { api, setAccessToken } from './api';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (tenantSlug: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // On mount, try to restore a session via the refresh cookie.
  useEffect(() => {
    let active = true;
    (async () => {
      const ok = await api.refresh();
      if (ok && active) {
        try {
          setUser(await api.me());
        } catch {
          /* not logged in */
        }
      }
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function login(tenantSlug: string, email: string, password: string): Promise<void> {
    const res = await api.login(tenantSlug, email, password);
    setAccessToken(res.accessToken);
    setUser(res.user);
    router.push('/app');
  }

  async function logout(): Promise<void> {
    await api.logout().catch(() => undefined);
    setAccessToken(null);
    setUser(null);
    router.push('/login');
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
