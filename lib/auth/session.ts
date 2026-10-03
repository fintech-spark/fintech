// Merchant Brain: session cookies
//
// The session is two httpOnly cookies. Nothing in the browser can read them,
// so an XSS bug cannot exfiltrate a token, and every server route that already
// calls `extractAccessToken()` (lib/http/auth-context.ts) reads the access
// token from exactly this cookie name.
//
//   sb-access-token   short-lived JWT, verified against the auth server
//   sb-refresh-token  long-lived token, only ever sent to /api/auth/refresh
//
// SameSite=Lax keeps the cookie off cross-site POSTs (the first CSRF layer;
// `assertTrustedOrigin` in lib/auth/http.ts is the second).

import type { NextResponse } from 'next/server';

export const ACCESS_TOKEN_COOKIE = 'sb-access-token';
export const REFRESH_TOKEN_COOKIE = 'sb-refresh-token';

/** Refresh tokens are valid for 30 days in Supabase; match that, do not exceed it. */
const REFRESH_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface SessionTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Seconds until the access token expires. */
  readonly expiresInSeconds: number;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function cookieBase(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

/** Attaches a freshly issued session to a response. */
export function applySession(response: NextResponse, tokens: SessionTokens): void {
  const accessMaxAge = Math.max(60, Math.floor(tokens.expiresInSeconds));
  response.cookies.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, cookieBase(accessMaxAge));
  response.cookies.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, cookieBase(REFRESH_TOKEN_MAX_AGE_SECONDS));
}

/** Removes both cookies. Safe to call when no session exists. */
export function clearSession(response: NextResponse): void {
  response.cookies.set(ACCESS_TOKEN_COOKIE, '', { ...cookieBase(0), maxAge: 0 });
  response.cookies.set(REFRESH_TOKEN_COOKIE, '', { ...cookieBase(0), maxAge: 0 });
}

/** Reads the two cookies from a request header. Absent cookies yield undefined. */
export function readSessionCookies(request: Request): {
  accessToken?: string;
  refreshToken?: string;
} {
  const header = request.headers.get('cookie');
  if (!header) return {};

  const jar = new Map<string, string>();
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    if (name !== ACCESS_TOKEN_COOKIE && name !== REFRESH_TOKEN_COOKIE) continue;
    jar.set(name, part.slice(index + 1).trim());
  }

  return {
    ...(jar.get(ACCESS_TOKEN_COOKIE) ? { accessToken: jar.get(ACCESS_TOKEN_COOKIE) as string } : {}),
    ...(jar.get(REFRESH_TOKEN_COOKIE) ? { refreshToken: jar.get(REFRESH_TOKEN_COOKIE) as string } : {}),
  };
}
