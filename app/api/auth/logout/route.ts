// POST /api/auth/logout — revokes the session server-side and clears cookies.
//
// Always succeeds. Signing out is idempotent, and a user must not be left with
// a stale session because the auth server was slow: the cookies are cleared
// even when revocation fails.

import { withAuthApi } from '@/lib/auth/http';
import { readSessionCookies } from '@/lib/auth/session';
import { revokeSession } from '@/lib/auth/supabase';

export const POST = withAuthApi(async (request: Request) => {
  const cookies = readSessionCookies(request);
  await revokeSession(cookies.accessToken);

  return { data: { signedOut: true }, clearSession: true };
});
