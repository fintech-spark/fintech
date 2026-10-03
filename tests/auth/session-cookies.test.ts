// Merchant Brain: session cookie behaviour.
//
// The properties worth asserting are the ones a regression would silently
// remove: httpOnly, SameSite, the exact cookie names the rest of the backend
// reads, and a refresh window that does not outlive Supabase's own.

import { describe, expect, it } from 'vitest';
import { NextResponse } from 'next/server';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  applySession,
  clearSession,
  readSessionCookies,
} from '@/lib/auth/session';

const TOKENS = {
  accessToken: 'access-token-value',
  refreshToken: 'refresh-token-value',
  expiresInSeconds: 3_600,
};

describe('applySession', () => {
  it('sets both cookies as httpOnly with the names the API reads', () => {
    const response = NextResponse.json({ data: {} });
    applySession(response, TOKENS);

    const header = response.headers.get('set-cookie') ?? '';
    expect(header).toContain(`${ACCESS_TOKEN_COOKIE}=access-token-value`);
    expect(header).toContain(`${REFRESH_TOKEN_COOKIE}=refresh-token-value`);
    expect(header).toContain('HttpOnly');
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toContain('Path=/');
  });

  it('bounds the access cookie to the token lifetime', () => {
    const response = NextResponse.json({ data: {} });
    applySession(response, TOKENS);
    const header = response.headers.get('set-cookie') ?? '';
    expect(header).toMatch(/Max-Age=3600/i);
  });

  it('never marks a cookie Secure outside production', () => {
    const response = NextResponse.json({ data: {} });
    applySession(response, TOKENS);
    const header = response.headers.get('set-cookie') ?? '';
    expect(header.includes('Secure')).toBe(process.env.NODE_ENV === 'production');
  });
});

describe('clearSession', () => {
  it('expires both cookies', () => {
    const response = NextResponse.json({ data: {} });
    clearSession(response);
    const header = response.headers.get('set-cookie') ?? '';
    expect(header).toContain(`${ACCESS_TOKEN_COOKIE}=;`);
    expect(header).toContain(`${REFRESH_TOKEN_COOKIE}=;`);
    expect(header).toMatch(/Max-Age=0/i);
  });
});

describe('readSessionCookies', () => {
  it('reads both tokens and ignores unrelated cookies', () => {
    const request = new Request('https://x.test', {
      headers: {
        cookie: `${ACCESS_TOKEN_COOKIE}=a1; other=1; ${REFRESH_TOKEN_COOKIE}=r1`,
      },
    });
    expect(readSessionCookies(request)).toEqual({ accessToken: 'a1', refreshToken: 'r1' });
  });

  it('returns no tokens when the cookies are absent', () => {
    expect(readSessionCookies(new Request('https://x.test'))).toEqual({});
  });

  it('does not treat a cookie whose name merely starts with ours as a session', () => {
    const request = new Request('https://x.test', {
      headers: { cookie: `${ACCESS_TOKEN_COOKIE}_extra=evil; ${ACCESS_TOKEN_COOKIE}=real` },
    });
    expect(readSessionCookies(request).accessToken).toBe('real');
  });
});
