// POST /api/auth/signup — creates an account.
//
// Two outcomes, both explicit:
//   - the project confirms email addresses automatically → session issued,
//     200, the caller is signed in;
//   - confirmation is required → 202 with `needsEmailConfirmation`, and no
//     session, because there is nothing to sign in with yet.

import { withAuthApi } from '@/lib/auth/http';
import { parseJsonBody } from '@/lib/http/params';
import { signupSchema } from '@/lib/auth/schemas';
import { signUpWithPassword } from '@/lib/auth/supabase';
import { clientIp, enforceRateLimit, type RateLimitPolicy } from '@/lib/auth/rate-limit';

const IP_POLICY: RateLimitPolicy = { limit: 5, windowMs: 60_000 };

export const POST = withAuthApi(async (request: Request) => {
  const ip = clientIp(request);
  enforceRateLimit(`signup:ip:${ip}`, IP_POLICY);

  const body = await parseJsonBody(request, signupSchema);
  const result = await signUpWithPassword(body.email, body.password, body.name);

  if (!result.session) {
    return {
      data: { authenticated: false, needsEmailConfirmation: true },
      status: 202,
    };
  }

  return {
    data: { authenticated: true, needsEmailConfirmation: false },
    session: result.session,
  };
});
