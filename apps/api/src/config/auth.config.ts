/** Centralized auth/token configuration read from env. */
export interface AuthConfig {
  jwtSecret: string;
  jwtRefreshSecret: string;
  accessTtl: string; // e.g. '15m'
  refreshTtl: string; // e.g. '30d'
  refreshCookieName: string;
  cookieSecure: boolean;
  cookieDomain?: string;
  inviteTtlHours: number;
  appUrl: string;
}

export function loadAuthConfig(): AuthConfig {
  const jwtSecret = process.env.JWT_SECRET;
  const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
  if (!jwtSecret || !jwtRefreshSecret) {
    throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be set');
  }
  return {
    jwtSecret,
    jwtRefreshSecret,
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
    refreshCookieName: process.env.REFRESH_COOKIE_NAME ?? 'ef_refresh',
    cookieSecure: process.env.NODE_ENV === 'production',
    cookieDomain: process.env.COOKIE_DOMAIN,
    inviteTtlHours: Number(process.env.INVITE_TTL_HOURS ?? 72),
    appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  };
}

export const AUTH_CONFIG = 'AUTH_CONFIG';
