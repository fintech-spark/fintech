// Merchant Brain: shared Zod building blocks for AI tools
//
// Every value a model can influence passes through one of these schemas, and
// every tool output is validated against a schema before it can reach the
// context compiler. Two rules are enforced structurally here rather than by
// convention:
//
//   1. NO TENANT KEY IN ANY INPUT. `assertNoTenantKey` rejects businessId,
//      business_id, tenantId, tenant_id and org/orgId even when the tool's own
//      schema would not have accepted them. This is defence in depth against
//      an IDOR attempt smuggled through a permissive schema.
//   2. BOUNDED RANGES. Date windows, row counts, and free text are capped by
//      ToolLimits at parse time, so an oversized request is rejected before it
//      reaches a query.

import { z } from 'zod';
import type { ToolLimits } from './types';

/** Keys that must never appear in model-supplied input, at any nesting depth. */
export const FORBIDDEN_TENANT_KEYS: readonly string[] = [
  'businessId',
  'business_id',
  'tenantId',
  'tenant_id',
  'orgId',
  'org_id',
  'organisationId',
  'organizationId',
];

/**
 * Throws when a model-supplied payload mentions a tenant identifier anywhere.
 *
 * Tool scoping comes from `ToolContext.tenant.businessId`. A model that tries
 * to name a tenant is either confused or hostile; both are refused.
 */
export function assertNoTenantKey(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoTenantKey(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_TENANT_KEYS.includes(key)) {
      throw new Error(`tenant key "${key}" is not accepted at ${path}`);
    }
    assertNoTenantKey(child, `${path}.${key}`);
  }
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Integer minor units. Never a float, never currency-less. */
export const minorUnitsSchema = z.number().int();

export const currencySchema = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, 'expected an upper-case ISO-4217 code');

export const isoDateSchema = z
  .string()
  .datetime({ offset: true })
  .describe('ISO-8601 timestamp with an explicit UTC offset');

/** A reporting window. Always explicit so a number is never ambiguous. */
export const reportingPeriodSchema = z
  .object({
    start: isoDateSchema,
    end: isoDateSchema,
  })
  .strict();

export type ReportingPeriod = z.infer<typeof reportingPeriodSchema>;

/**
 * A numeric measurement handed to the model.
 *
 * `valueMinorUnits` is the integer count of minor units. It is never a decimal
 * amount, and `currency` is mandatory because this codebase performs no FX
 * conversion — a bare number would be ambiguous the moment a tenant holds two
 * currencies.
 */
export const deterministicMetricSchema = z
  .object({
    metric: z.string().min(1),
    valueMinorUnits: minorUnitsSchema,
    currency: currencySchema,
    periodStart: isoDateSchema,
    periodEnd: isoDateSchema,
    source: z.enum(['database', 'analytics', 'domain_service']),
  })
  .strict();

export type DeterministicMetric = z.infer<typeof deterministicMetricSchema>;

// ---------------------------------------------------------------------------
// Input builders
// ---------------------------------------------------------------------------

/** Pagination that cannot exceed the configured row ceiling. */
export function boundedLimitSchema(limits: ToolLimits) {
  return z
    .number()
    .int()
    .min(1)
    .max(limits.maxRows)
    .default(Math.min(20, limits.maxRows));
}

/**
 * A reporting window bounded by `maxDateWindowDays`.
 *
 * The refinement rejects an over-wide window at parse time, which is what
 * stops an unbounded "all history" scan. The window is also required to be
 * well formed (end after start), so a reversed range cannot silently return
 * nothing and read as "no data".
 */
export function boundedDateRangeSchema(limits: ToolLimits) {
  const dayMs = 24 * 60 * 60 * 1000;
  return z
    .object({
      periodStart: isoDateSchema,
      periodEnd: isoDateSchema,
    })
    .strict()
    .superRefine((value, ctx) => {
      const start = Date.parse(value.periodStart);
      const end = Date.parse(value.periodEnd);
      if (Number.isNaN(start) || Number.isNaN(end)) {
        ctx.addIssue({ code: 'custom', message: 'period bounds must be parseable' });
        return;
      }
      if (end <= start) {
        ctx.addIssue({ code: 'custom', message: 'periodEnd must be after periodStart' });
        return;
      }
      const days = (end - start) / dayMs;
      if (days > limits.maxDateWindowDays) {
        ctx.addIssue({
          code: 'custom',
          message: `reporting window of ${Math.ceil(days)} days exceeds the ${limits.maxDateWindowDays} day limit`,
        });
      }
    });
}

export type BoundedDateRangeInput = z.infer<ReturnType<typeof boundedDateRangeSchema>>;

/** Free text supplied by a model, capped so a prompt cannot smuggle a corpus. */
export function boundedTextSchema(limits: ToolLimits, description?: string) {
  return z
    .string()
    .trim()
    .min(1)
    .max(limits.maxTextChars)
    .refine((value) => !containsUnsafeCharacters(value), {
      message: 'contains characters that are not permitted in a tool argument',
    })
    .describe(description ?? 'free text argument');
}

function containsUnsafeCharacters(value: string): boolean {
  // NUL and C0/C1 control characters have no place in a filter argument and
  // are a common vector for log and terminal injection. Built from a string so
  // the pattern carries no literal control bytes in source.
  return CONTROL_CHARACTERS.test(value);
}

const CONTROL_CHARACTERS = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]',
);

/**
 * A search term. Kept separate from `boundedTextSchema` so a term can be
 * slightly stricter than a description: it must not look like SQL.
 */
export function searchTermSchema(limits: ToolLimits, description?: string) {
  return boundedTextSchema(limits, description)
    .refine((value) => !/(--|\bunion\b|\bselect\b|\bfrom\b|\bwhere\b|;)/i.test(value), {
      message: 'search terms must be plain text, not query syntax',
    })
    .describe(description ?? 'plain-text search term');
}
