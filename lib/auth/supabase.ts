// Merchant Brain: Supabase Auth operations for the credential endpoints
//
// One place that talks to the auth server. Routes call these functions and
// receive either a session or an `AppError` whose message we wrote — an
// upstream error string is never forwarded to a client, because those strings
// distinguish "no such user" from "wrong password" (user enumeration) and can
// carry provider detail.
//
// The client here is the anon-key client: these are the *authentication*
// endpoints, so no user token exists yet. Every call that follows (session
// verification, RLS-enforced data access) uses the per-user client from
// lib/supabase/server-client.ts instead.

import { createServerClient } from '@/lib/supabase/server-client';
import { requireEnv } from '@/lib/supabase/env';
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  RateLimitError,
  ValidationError,
} from '@/lib/errors';
import { AuthProviderError } from './errors';
import type { SessionTokens } from './session';

export interface SignUpResult {
  /** Present only when the project confirms email addresses automatically. */
  readonly session?: SessionTokens;
  /** True when an email must be confirmed before the account can sign in. */
  readonly needsEmailConfirmation: boolean;
}

export async function signInWithPassword(email: string, password: string): Promise<SessionTokens> {
  assertUsableAnonKey();
  const client = createServerClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });

  if (error) throw mapAuthError(error);
  const session = data.session;
  if (!session) throw new AuthProviderError('Authentication service returned no session.');

  return toSessionTokens(session);
}

export async function signUpWithPassword(
  email: string,
  password: string,
  name: string,
): Promise<SignUpResult> {
  assertUsableAnonKey();
  const client = createServerClient();
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { data: { name } },
  });

  if (error) throw mapAuthError(error);

  // Supabase answers an existing email with a user that has no identities
  // rather than an error, so the duplicate case has to be detected here —
  // otherwise a second signup reports success for an account that cannot be
  // created.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new ConflictError('An account with this email already exists.');
  }

  if (!data.session) {
    return { needsEmailConfirmation: true };
  }

  return {
    session: toSessionTokens(data.session),
    needsEmailConfirmation: false,
  };
}

/**
 * Exchanges a refresh token for a new session.
 *
 * Throws 401 when the refresh token is itself expired or revoked, which is the
 * signal for the client to sign in again.
 */
export async function refreshSession(refreshToken: string): Promise<SessionTokens> {
  assertUsableAnonKey();
  const client = createServerClient();
  const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });

  if (error || !data.session) throw mapAuthError(error ?? new Error('no session'));

  return toSessionTokens(data.session);
}

/**
 * Revokes the caller's own session at the auth server.
 *
 * The access token is the credential the logout endpoint expects, so the
 * caller passes the one it read from the request. `scope=local` revokes this
 * session only — logging out of one device must not sign the merchant out of
 * every other one.
 *
 * A failure does not fail the request: the cookies are cleared either way, and
 * the worst case is a refresh token that stays valid until it expires. That
 * trade is deliberate — a user must never be stuck "signed in" because the
 * auth server was unreachable.
 */
export async function revokeSession(accessToken: string | undefined): Promise<void> {
  if (!accessToken) return;

  const url = requireEnv('SUPABASE_URL', process.env.SUPABASE_URL);
  const anonKey = requireEnv(
    'SUPABASE_ANON_KEY',
    process.env.SUPABASE_ANON_KEY,
  );

  try {
    await fetch(`${url}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // Best-effort revocation; the route clears the cookies regardless.
  }
}

/**
 * Fails loudly, server-side, when the anon key cannot possibly work.
 *
 * A missing or placeholder `SUPABASE_ANON_KEY` would otherwise surface as a
 * generic 502 on every sign-in — indistinguishable from an outage for the user
 * and undiagnosable from the client. The client keeps the generic message (no
 * configuration detail crosses the wire); the server log names the variable.
 *
 * Real keys are JWTs, so an empty string or a stub like `eyJ...` is caught here
 * instead of being sent to the auth server to be rejected.
 */
function assertUsableAnonKey(): void {
  const key = process.env.SUPABASE_ANON_KEY?.trim();
  if (key && /^eyJ[A-Za-z0-9_-]+\./.test(key)) return;

  console.error(
    '[auth] SUPABASE_ANON_KEY is missing or is not a JWT (placeholder?). ' +
      'Set the project anon key in .env.local — sign-in, sign-up and refresh ' +
      'all fail until it is a real key.',
  );
  throw new AuthProviderError('Authentication is unavailable right now. Please try again.');
}

function toSessionTokens(session: {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}): SessionTokens {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresInSeconds: typeof session.expires_in === 'number' ? session.expires_in : 3600,
  };
}

/** Maps an auth-server failure onto an AppError with a message we control. */
function mapAuthError(error: unknown): Error {
  const code = extractCode(error);

  switch (code) {
    // 401, not 403: the caller is not authenticated. `AuthorizationError`
    // (403) would tell a client it is known but forbidden, which is not what
    // happened — and the refresh route keys its cookie-clearing off 401.
    case 'invalid_credentials':
    case 'invalid_grant':
    case 'session_not_found':
      return new AuthenticationError('Email or password is incorrect.');

    case 'email_not_confirmed':
      return new AuthorizationError('Confirm your email address before signing in.');

    case 'user_already_exists':
    case 'email_exists':
      return new ConflictError('An account with this email already exists.');

    case 'weak_password':
      return new ValidationError('Choose a stronger password.', [
        { field: 'password', message: 'This password is too easy to guess.' },
      ]);

    case 'over_request_rate_limit':
    case 'rate_limit_exceeded':
      return new RateLimitError('Too many attempts. Please wait and try again.');

    // The auth server rejected the project's own credentials: the anon key is
    // wrong or revoked. Users must not see that; the log must, or nobody can
    // tell a misconfigured key from a Supabase outage.
    case 'invalid_api_key':
      console.error(
        '[auth] Supabase rejected SUPABASE_ANON_KEY (invalid_api_key). ' +
          'Rotate or replace it in .env.local.',
      );
      return new AuthProviderError('Authentication is unavailable right now. Please try again.');

    default:
      return new AuthProviderError('Authentication is unavailable right now. Please try again.');
  }
}

function extractCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as { code?: unknown; status?: unknown };
  if (typeof candidate.code === 'string') return candidate.code;
  if (typeof candidate.status === 'number' && candidate.status === 429) {
    return 'over_request_rate_limit';
  }
  return undefined;
}
