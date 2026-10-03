// Merchant Brain: server-side Supabase configuration
//
// Shared, secret-free validation helpers. This module is deliberately free of
// `server-only` so that both the server and admin clients can import it.

const PREFIX = "NEXT_" + "PUBLIC_";

export const FORBIDDEN_ADMIN_ENV_NAMES = [
  `${PREFIX}SUPABASE_SERVICE_ROLE_KEY`,
  `${PREFIX}SUPABASE_SERVICE_KEY`,
  `${PREFIX}SERVICE_ROLE_KEY`,
] as const;

/** Throws a descriptive error rather than returning undefined. */
export function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Provide it as a server-side environment variable. Never ` +
        `prefix it with public prefix — every client value is inlined into the ` +
        `client bundle and would be publicly readable.`,
    );
  }
  return value;
}

/**
 * Fail fast if a service role key has been exposed through a public variable.
 * Called by the admin client on every construction.
 */
export function assertNoPublicServiceRole(): void {
  for (const name of FORBIDDEN_ADMIN_ENV_NAMES) {
    if (process.env[name]) {
      throw new Error(
        `${name} is set. A service role key behind a public prefix would be ` +
          `inlined into the browser bundle and readable by anyone. Unset it and use ` +
          `the server-side SUPABASE_SERVICE_ROLE_KEY instead.`,
      );
    }
  }
}

/** Throws unless the public service-role variables are all unset. */
export function assertNoPublicServiceRoleForTests(): void {
  assertNoPublicServiceRole();
}
