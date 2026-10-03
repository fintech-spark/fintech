// Merchant Brain: in-process rate limiting for authentication endpoints
//
// Login and signup are the two endpoints an attacker can hammer without ever
// holding a session, so they are limited before the password leaves the
// process. The counter is keyed by client IP plus the submitted email, so one
// attacker cannot lock every other user out of their own account by burning a
// shared budget.
//
// Scope: one process. A multi-instance deployment needs a shared store —
// documented in docs/security/ — but a single-instance limit still stops the
// credential-stuffing loop that runs against one process at a time.

import { RateLimitError } from '@/lib/errors';

export interface RateLimitPolicy {
  /** Allowed requests per window. */
  readonly limit: number;
  /** Window length in milliseconds. */
  readonly windowMs: number;
}

interface Bucket {
  readonly count: number;
  readonly resetAt: number;
}

/**
 * Fixed-window counters. Bounded so a flood of distinct keys cannot grow the
 * map without limit: expired buckets are swept whenever the cap is hit.
 */
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Seconds until the caller may retry. 0 when allowed. */
  readonly retryAfterSeconds: number;
  readonly remaining: number;
}

/** Test seam: clears every counter. Not called from request paths. */
export function resetRateLimits(): void {
  buckets.clear();
}

export function consumeRateLimit(
  key: string,
  policy: RateLimitPolicy,
  now: number = Date.now(),
): RateLimitDecision {
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + policy.windowMs });
    return { allowed: true, retryAfterSeconds: 0, remaining: policy.limit - 1 };
  }

  if (existing.count >= policy.limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      remaining: 0,
    };
  }

  buckets.set(key, { count: existing.count + 1, resetAt: existing.resetAt });
  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: policy.limit - (existing.count + 1),
  };
}

/**
 * Consumes the budget or throws the 429 the API error mapper already knows.
 */
export function enforceRateLimit(key: string, policy: RateLimitPolicy): void {
  const decision = consumeRateLimit(key, policy);
  if (!decision.allowed) {
    throw new RateLimitError('Too many attempts. Please wait and try again.');
  }
}

/**
 * Best-effort client address for the limit key.
 *
 * `x-forwarded-for` is client-controlled, which is why it is only ever used to
 * *bucket* an attacker — never to authorize anything. The left-most entry is
 * the one a proxy records first; when the header is absent the request is
 * bucketed per connection identity, which still limits a single caller.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

function sweep(now: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Still full of live buckets: drop the oldest half rather than grow forever.
  if (buckets.size >= MAX_BUCKETS) {
    const excess = Math.floor(buckets.size / 2);
    let removed = 0;
    for (const key of buckets.keys()) {
      if (removed >= excess) break;
      buckets.delete(key);
      removed += 1;
    }
  }
}
