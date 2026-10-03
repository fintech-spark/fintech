// Merchant Brain: privileged Supabase client (service role) — SERVER ONLY
//
// RED TEAM FINDING M3-004 (Model 3)
// ----------------------------------
// Before this file existed the repository had no Supabase client at all, while
// `lib/database/postgres-client.ts` connected using `process.env.DATABASE_URL`,
// which on Supabase Cloud resolves to a role with `rolbypassrls = true`. That
// combination was reproduced live: as that role, cross-tenant SELECT, UPDATE,
// INSERT, child-table INSERT and DELETE all succeeded, because every RLS
// policy in migration 0004 was inert.
//
// This module is the only sanctioned way to hold a privileged database client,
// and it is deliberately awkward to use:
//
//   1. `import 'server-only'` makes the build FAIL if this module is ever
//      pulled into a Client Component, so the key cannot reach a browser bundle.
//   2. The service role key is read only from the server-side
//      SUPABASE_SERVICE_ROLE_KEY. It is never read from a NEXT_PUBLIC_* name.
//   3. Construction requires an explicit `bypassRowLevelSecurity: true`, so
//      every privileged call site is greppable and deliberate.
//   4. Construction asserts that no NEXT_PUBLIC_* service-role variable is set.
//
// Intended uses: background jobs, webhook handlers that must resolve a tenant
// before a user session exists, and migrations.
// NOT for: anything serving a user request. Use createServerClient() instead.

import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertNoPublicServiceRole, requireEnv } from './env';

export interface AdminClientOptions {
  /**
   * Must be literally `true`. The service role has `rolbypassrls = true` and
   * ignores every tenant isolation policy, so each call site must state that
   * it intends to bypass isolation.
   */
  bypassRowLevelSecurity: true;
}

/**
 * Privileged client that bypasses RLS and can read/write every tenant.
 *
 * @throws if the acknowledgement flag is missing, if SUPABASE_SERVICE_ROLE_KEY
 *         is unset, or if a NEXT_PUBLIC_* service-role variable is present.
 */
export function createAdminClient(options: AdminClientOptions): SupabaseClient {
  if (options?.bypassRowLevelSecurity !== true) {
    throw new Error(
      'createAdminClient requires { bypassRowLevelSecurity: true }. The service role ' +
        'ignores every RLS policy, so each call site must state that it intends to ' +
        'bypass tenant isolation.',
    );
  }

  assertNoPublicServiceRole();

  const url = requireEnv('SUPABASE_URL', process.env.SUPABASE_URL);
  const serviceRoleKey = requireEnv(
    'SUPABASE_SERVICE_ROLE_KEY',
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}