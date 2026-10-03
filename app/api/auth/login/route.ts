// POST /api/auth/login — exchanges credentials for a session.
//
// Limited twice: a per-IP budget (stops request floods) and a per-IP-plus-email
// budget (stops credential stuffing against one account from many addresses
// being shared as one counter). Both are consumed before the password reaches
// the auth server.

import { withAuthApi } from '@/lib/auth/http';
import { parseJsonBody } from '@/lib/http/params';
import { loginSchema } from '@/lib/auth/schemas';
import { signInWithPassword } from '@/lib/auth/supabase';
import { clientIp, enforceRateLimit, type RateLimitPolicy } from '@/lib/auth/rate-limit';

const IP_POLICY: RateLimitPolicy = { limit: 20, windowMs: 60_000 };
const CREDENTIAL_POLICY: RateLimitPolicy = { limit: 5, windowMs: 60_000 };

export const POST = withAuthApi(async (request: Request) => {
  const ip = clientIp(request);
  enforceRateLimit(`login:ip:${ip}`, IP_POLICY);

  const body = await parseJsonBody(request, loginSchema);
  enforceRateLimit(`login:credential:${ip}:${body.email}`, CREDENTIAL_POLICY);

  const session = await signInWithPassword(body.email, body.password);

  return { data: { authenticated: true }, session };
});
