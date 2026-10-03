// POST /api/auth/forgot-password — triggers password reset instructions.
//
// Rate-limited by IP and email to protect from email-flooding and enumeration.
// Always returns a generic success response so account existence is not leaked.

import { withAuthApi } from '@/lib/auth/http';
import { parseJsonBody } from '@/lib/http/params';
import { forgotPasswordSchema } from '@/lib/auth/schemas';
import { resetPasswordForEmail } from '@/lib/auth/supabase';
import { clientIp, enforceRateLimit, type RateLimitPolicy } from '@/lib/auth/rate-limit';

const IP_POLICY: RateLimitPolicy = { limit: 10, windowMs: 60_000 };
const EMAIL_POLICY: RateLimitPolicy = { limit: 3, windowMs: 60_000 };

export const POST = withAuthApi(async (request: Request) => {
  const ip = clientIp(request);
  enforceRateLimit(`forgot-password:ip:${ip}`, IP_POLICY);

  const body = await parseJsonBody(request, forgotPasswordSchema);
  enforceRateLimit(`forgot-password:email:${ip}:${body.email}`, EMAIL_POLICY);

  try {
    await resetPasswordForEmail(body.email);
  } catch {
    // Intentionally swallow errors (e.g. unknown user) to prevent account enumeration.
  }

  return { data: { sent: true } };
});
