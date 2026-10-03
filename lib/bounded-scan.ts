// Merchant Brain: bounded-scan guard for whole-set aggregates
//
// WHY THIS EXISTS
// ---------------
// Six endpoints read a tenant's entire table and reduce it in JavaScript:
// inventory valuation, receivable totals, payable totals, the low-stock list,
// the membership roster, and supplier price list. None of them had a row limit,
// so one request could pull an unbounded result set into the Node process.
//
// THE THREE HONEST OPTIONS
// ------------------------
//   1. Cap the scan and throw when it is exceeded.  <- this module
//   2. Cap the scan and return a partial total.     <- rejected: silently wrong
//   3. Push the aggregation into SQL.               <- correct, but needs a
//                                                     database view or function
//
// Option 2 is the one this project must never take. A merchant shown a
// valuation that silently excluded half their stock has no way to tell it is
// wrong, which is the same failure mode as a hardcoded zero. Option 1 bounds
// memory and time and reports loudly instead.
//
// Option 3 is the real fix and is recorded as follow-up work in
// `docs/engineering/API_RULES.md`; it belongs with whoever owns the schema.
// Until then, throwing is the correct behaviour.
//
// WHY EVERY LIMIT IS BELOW 1000  (read this before raising one)
// -----------------------------------------------------------
// PostgREST clamps every response to `max-rows`. `supabase/config.toml` sets
// `max_rows = 1000`, and hosted Supabase defaults to the same. A limit ABOVE
// 1000 would therefore be unenforceable: the driver asks for 50,000 rows, the
// server returns 1,000, and the overflow check below sees 1,000 <= 50,000 and
// passes — returning a total computed from a silently truncated result set.
//
// That is not hypothetical. It is exactly what an earlier version of this file
// did, and it is why every limit here is under the server cap: with
// `MAX_PRODUCT_SCAN = 900`, the query requests 901 rows, PostgREST can serve
// all 901 (901 <= 1000), and an overflow of `received > 900` is a real signal
// rather than an unfalsifiable claim.
//
// If you raise a limit above 1000 you must ALSO raise `max_rows` in
// `supabase/config.toml` AND the hosted project's API settings, and the test
// in `tests/api/hardening.test.ts` that pins the ceiling will fail.

import { BusinessRuleError } from '@/lib/errors';

/**
 * The server-side response cap these limits must stay under.
 *
 * Declared as a constant rather than repeated so the relationship between the
 * two is checkable, and asserted in the test suite.
 */
export const POSTGREST_MAX_ROWS = 1000;

/** Every whole-set scan ceiling. All must be < POSTGREST_MAX_ROWS. */
export const MAX_PRODUCT_SCAN = 900;
export const MAX_LEDGER_SCAN = 900;
export const MAX_LOW_STOCK_SCAN = 900;
export const MAX_PRICING_SCAN = 900;
export const MAX_MEMBERSHIP_SCAN = 500;

/**
 * Fails when a bounded scan overflowed its limit.
 *
 * `received` must be the row count of a query built with `.range(0, limit)`,
 * which requests `limit + 1` rows. One extra row is proof of overflow.
 *
 * Overflow throws rather than returning what was read: a partial total is
 * indistinguishable from a correct one, and a merchant cannot audit a number
 * they were never shown the inputs for.
 */
export function assertScanWithinLimit(
  received: number,
  limit: number,
  subject: string,
): void {
  if (received <= limit) return;
  throw new BusinessRuleError(
    `${subject} exceeds the ${limit.toLocaleString('en-US')} row limit this endpoint can evaluate. ` +
      `Reduce the scope, or the aggregate needs to move into the database.`,
    { subject, limit, truncated: true },
  );
}
