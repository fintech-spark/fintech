// Merchant Brain: authentication route handlers, called directly.
//
// These tests exercise the real handlers — wrapper, origin check, rate limit,
// body validation, cookie writing and error mapping — with the Supabase client
// mocked. No network, no credentials, no database.
//
// They exist because a green suite that never imports a route handler proves
// nothing about what the route returns (see .phase3/COORDINATION.md, R1).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError, ConflictError } from '@/lib/errors';
import { AuthProviderError } from '@/lib/auth/errors';
import { resetRateLimits } from '@/lib/auth/rate-limit';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '@/lib/auth/session';

const supabase = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUpWithPassword: vi.fn(),
  refreshSession: vi.fn(),
  revokeSession: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}));

vi.mock('@/lib/auth/supabase', () => supabase);

import { POST as login } from '@/app/api/auth/login/route';
import { POST as signup } from '@/app/api/auth/signup/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { POST as refresh } from '@/app/api/auth/refresh/route';
import { POST as forgotPassword } from '@/app/api/auth/forgot-password/route';

const TOKENS = {
  accessToken: 'issued-access',
  refreshToken: 'issued-refresh',
  expiresInSeconds: 3600,
};

const VALID_LOGIN = { email: 'ravi@example.com', password: 'a-perfectly-adequate-passphrase' };

function loginRequest(
  body: unknown = VALID_LOGIN,
  headers: Record<string, string> = {},
): Request {
  return new Request('https://merchant.test/api/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://merchant.test',
      'x-forwarded-for': '203.0.113.5',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  resetRateLimits();
  vi.clearAllMocks();
});

describe('POST /api/auth/login', () => {
  it('issues both session cookies on success', async () => {
    supabase.signInWithPassword.mockResolvedValue(TOKENS);

    const response = await login(loginRequest());
    const header = response.headers.get('set-cookie') ?? '';

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { authenticated: true } });
    expect(header).toContain(`${ACCESS_TOKEN_COOKIE}=issued-access`);
    expect(header).toContain(`${REFRESH_TOKEN_COOKIE}=issued-refresh`);
    expect(header).toContain('HttpOnly');
  });

  it('answers bad credentials with 401 and a message that names no user', async () => {
    supabase.signInWithPassword.mockRejectedValue(
      new AuthenticationError('Email or password is incorrect.'),
    );

    const response = await login(loginRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.message).toBe('Email or password is incorrect.');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('rejects a cross-origin attempt before reading the body', async () => {
    const response = await login(loginRequest(undefined, { origin: 'https://evil.test' }));

    expect(response.status).toBe(401);
    expect(supabase.signInWithPassword).not.toHaveBeenCalled();
  });

  it('rejects a malformed body with 400', async () => {
    const response = await login(loginRequest({ email: 'ravi@example.com' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(supabase.signInWithPassword).not.toHaveBeenCalled();
  });

  it('rate-limits repeated attempts against the same account', async () => {
    supabase.signInWithPassword.mockResolvedValue(TOKENS);

    let last: Response | undefined;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      last = await login(loginRequest());
    }

    expect(last?.status).toBe(429);
    const body = await last?.json();
    expect(body.error.code).toBe('RATE_LIMITED');
  });
});

describe('POST /api/auth/signup', () => {
  const VALID_SIGNUP = {
    name: 'Ravi Kumar',
    email: 'ravi@example.com',
    password: 'a-perfectly-adequate-passphrase',
  };

  function signupRequest(body: unknown = VALID_SIGNUP): Request {
    return new Request('https://merchant.test/api/auth/signup', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://merchant.test',
        'x-forwarded-for': '203.0.113.6',
      },
      body: JSON.stringify(body),
    });
  }

  it('signs the caller in when the project confirms email automatically', async () => {
    supabase.signUpWithPassword.mockResolvedValue({
      session: TOKENS,
      needsEmailConfirmation: false,
    });

    const response = await signup(signupRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { authenticated: true, needsEmailConfirmation: false },
    });
    expect(response.headers.get('set-cookie')).toContain('sb-access-token=issued-access');
  });

  it('returns 202 with no session when confirmation is pending', async () => {
    supabase.signUpWithPassword.mockResolvedValue({ needsEmailConfirmation: true });

    const response = await signup(signupRequest());
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.data).toEqual({ authenticated: false, needsEmailConfirmation: true });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('reports a duplicate account as 409', async () => {
    supabase.signUpWithPassword.mockRejectedValue(
      new ConflictError('An account with this email already exists.'),
    );

    const response = await signup(signupRequest());
    expect(response.status).toBe(409);
  });

  it('rejects a short password before contacting the auth server', async () => {
    const response = await signup(signupRequest({ ...VALID_SIGNUP, password: 'short' }));

    expect(response.status).toBe(400);
    expect(supabase.signUpWithPassword).not.toHaveBeenCalled();
  });

  it('rejects unknown fields in the payload', async () => {
    const response = await signup(signupRequest({ ...VALID_SIGNUP, role: 'owner' }));

    expect(response.status).toBe(400);
    expect(supabase.signUpWithPassword).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the session and clears both cookies', async () => {
    supabase.revokeSession.mockResolvedValue(undefined);

    const response = await logout(
      new Request('https://merchant.test/api/auth/logout', {
        method: 'POST',
        headers: {
          origin: 'https://merchant.test',
          cookie: `${ACCESS_TOKEN_COOKIE}=stale; ${REFRESH_TOKEN_COOKIE}=stale-r`,
        },
      }),
    );
    const header = response.headers.get('set-cookie') ?? '';

    expect(response.status).toBe(200);
    expect(supabase.revokeSession).toHaveBeenCalledWith('stale');
    expect(header).toContain(`${ACCESS_TOKEN_COOKIE}=;`);
    expect(header).toContain(`${REFRESH_TOKEN_COOKIE}=;`);
  });
});

describe('POST /api/auth/refresh', () => {
  function refreshRequest(headers: Record<string, string> = {}): Request {
    return new Request('https://merchant.test/api/auth/refresh', {
      method: 'POST',
      headers: { origin: 'https://merchant.test', ...headers },
    });
  }

  it('rotates the session when a refresh token is present', async () => {
    supabase.refreshSession.mockResolvedValue(TOKENS);

    const response = await refresh(
      refreshRequest({ cookie: `${REFRESH_TOKEN_COOKIE}=still-good` }),
    );

    expect(response.status).toBe(200);
    expect(supabase.refreshSession).toHaveBeenCalledWith('still-good');
    expect(response.headers.get('set-cookie')).toContain('sb-access-token=issued-access');
  });

  it('answers 401 and clears the cookies when no refresh token exists', async () => {
    const response = await refresh(refreshRequest());
    const header = response.headers.get('set-cookie') ?? '';

    expect(response.status).toBe(401);
    expect(header).toMatch(/Max-Age=0/i);
    expect(supabase.refreshSession).not.toHaveBeenCalled();
  });

  it('clears the cookies when the auth server rejects the refresh token', async () => {
    supabase.refreshSession.mockRejectedValue(
      new AuthenticationError('Email or password is incorrect.'),
    );

    const response = await refresh(
      refreshRequest({ cookie: `${REFRESH_TOKEN_COOKIE}=revoked` }),
    );
    const header = response.headers.get('set-cookie') ?? '';

    expect(response.status).toBe(401);
    expect(header).toMatch(/Max-Age=0/i);
  });

  it('surfaces a non-auth failure as a 502, not a 401', async () => {
    supabase.refreshSession.mockRejectedValue(new AuthProviderError('Authentication is unavailable right now. Please try again.'));

    const response = await refresh(
      refreshRequest({ cookie: `${REFRESH_TOKEN_COOKIE}=good` }),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});

describe('POST /api/auth/forgot-password', () => {
  function forgotRequest(body: unknown = { email: 'ravi@example.com' }): Request {
    return new Request('https://merchant.test/api/auth/forgot-password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://merchant.test',
        'x-forwarded-for': '203.0.113.19',
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  it('answers 200 with generic success and invokes resetPasswordForEmail', async () => {
    supabase.resetPasswordForEmail.mockResolvedValue(undefined);

    const response = await forgotPassword(forgotRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ sent: true });
    expect(supabase.resetPasswordForEmail).toHaveBeenCalledWith('ravi@example.com');
  });

  it('rejects invalid email addresses with 400', async () => {
    const response = await forgotPassword(forgotRequest({ email: 'not-an-email' }));
    expect(response.status).toBe(400);
    expect(supabase.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('still answers 200 even if the provider throws to avoid enumeration', async () => {
    supabase.resetPasswordForEmail.mockRejectedValue(new Error('User not found'));

    const response = await forgotPassword(forgotRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { sent: true } });
  });
});
