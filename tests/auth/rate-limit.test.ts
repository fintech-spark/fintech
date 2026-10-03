// Merchant Brain: rate limiter behaviour.
//
// The properties that matter for an auth endpoint: the budget resets when the
// window ends, the counter is per key (one attacker cannot exhaust another
// user's allowance), and the map cannot grow without bound.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  clientIp,
  consumeRateLimit,
  enforceRateLimit,
  resetRateLimits,
} from '@/lib/auth/rate-limit';
import { RateLimitError } from '@/lib/errors';

const POLICY = { limit: 3, windowMs: 1_000 };

beforeEach(() => resetRateLimits());

describe('consumeRateLimit', () => {
  it('allows up to the limit, then refuses', () => {
    const now = 1_000;
    expect(consumeRateLimit('k', POLICY, now).allowed).toBe(true);
    expect(consumeRateLimit('k', POLICY, now).allowed).toBe(true);
    const third = consumeRateLimit('k', POLICY, now);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    const fourth = consumeRateLimit('k', POLICY, now);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('keeps keys independent', () => {
    const now = 1_000;
    for (let i = 0; i < POLICY.limit; i += 1) consumeRateLimit('a', POLICY, now);
    expect(consumeRateLimit('a', POLICY, now).allowed).toBe(false);
    expect(consumeRateLimit('b', POLICY, now).allowed).toBe(true);
  });

  it('refills after the window elapses', () => {
    const start = 1_000;
    for (let i = 0; i < POLICY.limit; i += 1) consumeRateLimit('k', POLICY, start);
    expect(consumeRateLimit('k', POLICY, start).allowed).toBe(false);
    expect(consumeRateLimit('k', POLICY, start + POLICY.windowMs + 1).allowed).toBe(true);
  });
});

describe('enforceRateLimit', () => {
  it('throws the 429 the error mapper already understands', () => {
    for (let i = 0; i < POLICY.limit; i += 1) enforceRateLimit('k', POLICY);
    expect(() => enforceRateLimit('k', POLICY)).toThrow(RateLimitError);
  });

  it('reports itself as 429 / RATE_LIMITED', () => {
    const error = new RateLimitError();
    expect(error.statusCode).toBe(429);
    expect(error.code).toBe('RATE_LIMITED');
  });
});

describe('clientIp', () => {
  it('uses the first forwarded hop', () => {
    const request = new Request('https://x.test', {
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
    });
    expect(clientIp(request)).toBe('203.0.113.9');
  });

  it('falls back to a stable bucket when no header is present', () => {
    expect(clientIp(new Request('https://x.test'))).toBe('unknown');
  });
});
