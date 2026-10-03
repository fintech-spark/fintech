// Merchant Brain: browser Supabase client
//
// Anon-key client for Client Components. Every statement executes as the
// `anon`/`authenticated` role, so the RLS policies in migration 0004 decide
// what is visible. There is intentionally no way to construct this client with
// a service role key.
//
// NOTE: no `server-only` import here — this module is the one Supabase client
// that is meant to be reachable from a browser bundle.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireEnv } from './env';

export function createBrowserClient(): SupabaseClient {
  const url = requireEnv('SUPABASE_URL', process.env.SUPABASE_URL);
  const anonKey = requireEnv(
    'SUPABASE_ANON_KEY',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY,
  );

  return createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
}