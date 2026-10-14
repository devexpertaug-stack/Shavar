import type { AuthUser, LoginResponse } from '@estateflow/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const BASE = `${API_URL}/api/v1`;

/** In-memory access token. Refresh token lives in an httpOnly cookie. */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function getAccessToken(): string | null {
  return accessToken;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  // Transparent refresh on a single 401 (expired access token).
  if (res.status === 401 && retry && path !== '/auth/refresh' && path !== '/auth/login') {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, init, false);
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = (body.message as string) ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (!res.ok) return false;
    const data = (await res.json()) as LoginResponse;
    setAccessToken(data.accessToken);
    return true;
  } catch {
    return false;
  }
}

export const api = {
  login: (tenantSlug: string, email: string, password: string) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ tenantSlug, email, password }),
    }),
  refresh: tryRefresh,
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: () => request<AuthUser>('/users/me'),
  users: () => request<AuthUser[]>('/users'),
};
