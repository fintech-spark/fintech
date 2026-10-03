// Merchant Brain: Supabase client boundary
//
// Three clients, three privilege levels. Import from the specific
// module rather than this barrel where possible, so that a Client
// Component cannot accidentally pull in a server-only client through
// a single import.
//
//   createBrowserClient()  anon key, RLS-enforced, browser-safe
//   createServerClient()   user JWT, RLS-enforced, server-only
//   createAdminClient()    service role, BYPASSES RLS, server-only

export {
  createBrowserClient,
} from './browser-client';
export {
  createServerClient,
  type ServerClientOptions,
} from './server-client';
export {
  createAdminClient,
  type AdminClientOptions,
} from './admin-client';
export {
  assertNoPublicServiceRole,
  requireEnv,
  FORBIDDEN_ADMIN_ENV_NAMES,
} from './env';