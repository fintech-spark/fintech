/**
 * AI Output Guards
 *
 * Validates and sanitizes AI-generated outputs before they reach
 * the application layer. Prevents hallucinated or malformed data
 * from becoming authoritative.
 */

import type { z } from 'zod';

/** Guard result */
export type GuardResult<T> =
  | { readonly passed: true; readonly data: T }
  | { readonly passed: false; readonly reason: string; readonly raw: unknown };

/** Validates AI output against a Zod schema */
export function guardOutput<T>(schema: z.ZodType<T>, output: unknown): GuardResult<T> {
  const result = schema.safeParse(output);
  if (result.success) return { passed: true, data: result.data };
  return {
    passed: false,
    reason: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    raw: output,
  };
}

/** Validates that AI-generated JSON is parseable */
export function guardJSON(text: string): GuardResult<unknown> {
  try {
    const data = JSON.parse(text);
    return { passed: true, data };
  } catch {
    return { passed: false, reason: 'Invalid JSON', raw: text };
  }
}
