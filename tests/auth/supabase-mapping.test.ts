// Merchant Brain: auth-server error mapping.
//
// The mapping is the line between "the auth server said something" and "the
// client is told something". Two properties are asserted for every case:
//
//   1. the status is the right one for the situation (401 for a bad password,
//      409 for a duplicate, 429 for a limit — never a blanket 401, which would
//      make a rate limit look like a wrong password);
//   2. the upstream message never reaches the caller, because those messages
//      distinguish "no such user" from "wrong password" (user enumeration) and
//      name provider internals.
//
// The Supabase client itself is mocked; the mapper under test is real.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  RateLimitError,
  ValidationError,
} from '@/lib/errors';
import { AuthProviderError } from '@/lib/auth/errors';

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  refreshSession: vi.fn(),
}));

vi.mock('@/lib/supabase/server-client', () => ({
  createServerClient: () => ({ auth }),
}));

import { signInWithPassword, signUpWithPassword, refreshSession } from '@/lib/auth/supabase';

const EMAIL = 'ravi@example.com';
const PASSWORD = 'a-perfectly-adequate-passphrase';
const UPSTREAM_SECRET = 'Invalid login credentials: no user found for ravi@example.com';

const originalAnonKey = process.env.SUPABASE_ANON_KEY;

beforeEach(() => {
  vi.clearAllMocks();
  // The client is mocked, so give the key guard a well-formed key to pass on
  // every test unless it deliberately overrides one.
  process.env.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig';
});

afterAll(() => {
  if (originalAnonKey === undefined) delete process.env.SUPABASE_ANON_KEY;
  else process.env.SUPABASE_ANON_KEY = originalAnonKey;
});

async function expectMapped(
  run: () => Promise<unknown>,
  errorClass: abstract new (...args: never[]) => Error,
  statusCode: number,
): Promise<Error> {
  const failure = await run().then(
    () => null,
    (error: unknown) => error,
  );
  expect(failure, 'expected the call to fail').toBeInstanceOf(errorClass);
  const error = failure as Error & { statusCode?: number };
  expect(error.statusCode).toBe(statusCode);
  expect(error.message).not.toContain('ravi@example.com');
  expect(error.message).not.toContain(UPSTREAM_SECRET);
  return error;
}

describe('signInWithPassword mapping', () => {
  it('maps bad credentials to 401 without echoing the upstream text', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: null,
      error: { code: 'invalid_credentials', message: UPSTREAM_SECRET },
    });

    await expectMapped(
      () => signInWithPassword(EMAIL, PASSWORD),
      AuthenticationError,
      401,
    );
  });

  it('maps an unconfirmed email to 403', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: null,
      error: { code: 'email_not_confirmed', message: 'Email not confirmed' },
    });

    await expectMapped(() => signInWithPassword(EMAIL, PASSWORD), AuthorizationError, 403);
  });

  it('maps a provider outage to 502, not to "wrong password"', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: null,
      error: { code: 'unexpected_failure', message: 'internal server error' },
    });

    await expectMapped(() => signInWithPassword(EMAIL, PASSWORD), AuthProviderError, 502);
  });

  it('maps an upstream throttle to 429', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: null,
      error: { code: 'over_request_rate_limit', message: 'rate limit' },
    });

    await expectMapped(() => signInWithPassword(EMAIL, PASSWORD), RateLimitError, 429);
  });

  it('reports a rejected project key to the log, not to the user', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: null,
      error: { code: 'invalid_api_key', message: 'Invalid API key' },
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expectMapped(() => signInWithPassword(EMAIL, PASSWORD), AuthProviderError, 502);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('SUPABASE_ANON_KEY'));
    log.mockRestore();
  });

  it('returns the session when the credentials are good', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: {
        session: { access_token: 'a', refresh_token: 'r', expires_in: 3600 },
      },
      error: null,
    });

    await expect(signInWithPassword(EMAIL, PASSWORD)).resolves.toEqual({
      accessToken: 'a',
      refreshToken: 'r',
      expiresInSeconds: 3600,
    });
  });
});

describe('signUpWithPassword mapping', () => {
  it('detects an existing account from the empty-identities answer', async () => {
    auth.signUp.mockResolvedValue({
      data: { user: { identities: [] }, session: null },
      error: null,
    });

    await expectMapped(
      () => signUpWithPassword(EMAIL, PASSWORD, 'Ravi'),
      ConflictError,
      409,
    );
  });

  it('reports pending email confirmation without issuing a session', async () => {
    auth.signUp.mockResolvedValue({
      data: { user: { identities: [{ provider: 'email' }] }, session: null },
      error: null,
    });

    await expect(signUpWithPassword(EMAIL, PASSWORD, 'Ravi')).resolves.toEqual({
      needsEmailConfirmation: true,
    });
  });

  it('maps a weak-password rejection to a field-level 400', async () => {
    auth.signUp.mockResolvedValue({
      data: null,
      error: { code: 'weak_password', message: 'Password is too short' },
    });

    await expectMapped(
      () => signUpWithPassword(EMAIL, PASSWORD, 'Ravi'),
      ValidationError,
      400,
    );
  });
});

describe('refreshSession mapping', () => {
  it('maps a rejected refresh token to 401 so the route clears the cookies', async () => {
    auth.refreshSession.mockResolvedValue({
      data: { session: null },
      error: { code: 'invalid_grant', message: 'Invalid Refresh Token: Refresh Token Not Found' },
    });

    await expectMapped(() => refreshSession('dead'), AuthenticationError, 401);
  });
});

describe('anon key guard', () => {
  const original = process.env.SUPABASE_ANON_KEY;

  afterEach(() => {
    if (original === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = original;
  });

  it('refuses to call the auth server with a placeholder key', async () => {
    process.env.SUPABASE_ANON_KEY = 'eyJ...';
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(signInWithPassword(EMAIL, PASSWORD)).rejects.toBeInstanceOf(AuthProviderError);
    expect(auth.signInWithPassword, 'the auth server must not be called').not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('SUPABASE_ANON_KEY'));
    log.mockRestore();
  });

  it('sends a well-formed key through to the auth server', async () => {
    process.env.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig';
    auth.signInWithPassword.mockResolvedValue({
      data: { session: { access_token: 'a', refresh_token: 'r', expires_in: 3600 } },
      error: null,
    });

    await expect(signInWithPassword(EMAIL, PASSWORD)).resolves.toMatchObject({
      accessToken: 'a',
    });
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(1);
  });
});
