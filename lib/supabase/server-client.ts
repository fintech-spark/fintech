// Merchant Brain: per-user Supabase client (server-side)
//
// Runs as the given user via their access token. PostgREST then sets
// `request.jwt.claims`, which is what `auth.uid()` reads inside the RLS
// policies from migration 0004. This client therefore sees only that user's
// tenants.

import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireEnv } from './env';

export interface ServerClientOptions {
  /**
   * The user's access token from the **verified server session**.
   *
   * Never accept this from a request body, query parameter or hidden form
   * field: that would let a caller present someone else's token. It must be
   * obtained server-side from the auth session cookie.
   */
  accessToken?: string;
}

/**
 * Server-side, RLS-enforced client.
 *
 * Omitting `accessToken` produces an anonymous client, which is still subject
 * to RLS and cannot read tenant data.
 */
export function createServerClient(options: ServerClientOptions = {}): SupabaseClient {
  const url = requireEnv('SUPABASE_URL', process.env.SUPABASE_URL);
  const anonKey = requireEnv(
    'SUPABASE_ANON_KEY',
    process.env.SUPABASE_ANON_KEY,
  );

  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: options.accessToken
      ? { headers: { Authorization: `Bearer ${options.accessToken}` } }
      : undefined,
  });
}