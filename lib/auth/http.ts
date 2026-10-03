// Merchant Brain: route wrapper for authentication endpoints
//
// Same response shape as `withApi` (lib/http/handler.ts), plus the two things
// a credential endpoint needs that a normal route does not:
//
//   1. an origin check — a cross-site POST carrying the victim's cookies is
//      the classic CSRF shape, and SameSite=Lax is the belt to this suspenders;
//   2. session cookies on the way out — login/refresh rotate tokens, logout
//      clears them, and a handler should not have to build a Response itself.
//
// Error mapping is delegated to `toErrorResponse`, so an auth route cannot
// invent a response body that leaks an upstream error string.

import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/http/errors';
import { AuthenticationError } from '@/lib/errors';
import { applySession, clearSession, type SessionTokens } from './session';

export interface AuthApiResult<T> {
  readonly data: T;
  readonly status?: number;
  /** Attach a freshly issued/rotated session. */
  readonly session?: SessionTokens;
  /** Drop the session cookies (logout, or a refresh that can no longer succeed). */
  readonly clearSession?: boolean;
}

export type AuthApiHandler<T> = (request: Request) => Promise<AuthApiResult<T>>;

export function withAuthApi<T>(handler: AuthApiHandler<T>) {
  return async (request: Request): Promise<Response> => {
    try {
      assertTrustedOrigin(request);
      const result = await handler(request);
      const response = NextResponse.json(
        { data: result.data },
        { status: result.status ?? 200 },
      );
      if (result.session) {
        applySession(response, result.session);
      } else if (result.clearSession) {
        clearSession(response);
      }
      return response;
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

/**
 * Rejects a state-changing request that was not made from this origin.
 *
 * Browsers attach cookies to cross-site POSTs under some configurations and to
 * every same-site one, so cookie-authenticated endpoints must not trust the
 * cookie alone. A missing `Origin` is allowed: non-browser clients (curl, tests,
 * server-side callers) have no ambient cookie jar, so they are not a CSRF
 * vector. `Sec-Fetch-Site`, when a browser sends it, is authoritative and is
 * checked on its own.
 */
export function assertTrustedOrigin(request: Request): void {
  if (!isStateChanging(request.method)) return;

  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new AuthenticationError('Cross-site request rejected.');
  }

  const origin = request.headers.get('origin');
  if (!origin) return;

  const expected = expectedOrigin(request);
  if (origin !== expected) {
    throw new AuthenticationError('Cross-site request rejected.');
  }
}

function isStateChanging(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

/**
 * The origin this request should have come from: the configured app URL when
 * set, otherwise the request's own host (which is what a browser will report
 * for a same-origin fetch).
 */
function expectedOrigin(request: Request): string {
  const configured = (process.env.APP_URL ?? process.env.BASE_URL)?.trim().replace(/\/+$/, '');
  if (configured) return configured;

  const url = new URL(request.url);
  return url.origin;
}
