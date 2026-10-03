// POST /api/auth/refresh — rotates an expired access token.
//
// The client calls this when /api/auth/session answers 401. A refresh token
// that the auth server rejects (expired, revoked, or unknown) clears both
// cookies in the same response, so a client cannot loop on a session that will
// never come back.

import { AppError } from '@/lib/errors';
import { withAuthApi } from '@/lib/auth/http';
import { readSessionCookies } from '@/lib/auth/session';
import { refreshSession } from '@/lib/auth/supabase';
import { clientIp, enforceRateLimit, type RateLimitPolicy } from '@/lib/auth/rate-limit';

const IP_POLICY: RateLimitPolicy = { limit: 60, windowMs: 60_000 };

export const POST = withAuthApi(async (request: Request) => {
  enforceRateLimit(`refresh:ip:${clientIp(request)}`, IP_POLICY);

  const { refreshToken } = readSessionCookies(request);
  if (!refreshToken) {
    return { data: { authenticated: false }, status: 401, clearSession: true };
  }

  try {
    const session = await refreshSession(refreshToken);
    return { data: { authenticated: true }, session };
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 401) {
      return { data: { authenticated: false }, status: 401, clearSession: true };
    }
    throw error;
  }
});
