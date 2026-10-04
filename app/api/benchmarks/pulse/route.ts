// Merchant Brain: PhonePe Pulse benchmark endpoint.
//
// GET /api/benchmarks/pulse
//
// Query parameters:
//   - year: optional number (e.g. 2026)
//   - quarter: optional number (1..4)
//
// Returns national aggregate transaction counts, quarterly growth trends,
// user registrations, top state rankings, and category breakdowns from
// public PhonePe Pulse metrics.
//
// SECURITY & ISOLATION INVARIANTS:
//   - Session authenticated via `requireRequestContext(request)`.
//   - Data is public national benchmark data, never mixed into a merchant's private ledger.
//   - Deterministic calculations only (no model arithmetic).

import { withApi } from '@/lib/http/handler';
import { requireRequestContext } from '@/lib/http/auth-context';
import { wireBenchmarks } from '@/lib/http/wiring';
import { ValidationError } from '@/lib/errors';
import { isValidPeriod, type PulsePeriod } from '@/modules/analytics';

export const GET = withApi(async (request: Request) => {
  // Ensure the caller is an authenticated user
  await requireRequestContext(request);

  const url = new URL(request.url);
  const yearParam = url.searchParams.get('year');
  const quarterParam = url.searchParams.get('quarter');

  let targetPeriod: PulsePeriod | undefined;

  if (yearParam !== null || quarterParam !== null) {
    const year = Number(yearParam);
    const quarter = Number(quarterParam);

    if (!Number.isInteger(year) || !Number.isInteger(quarter)) {
      throw new ValidationError('Parameters "year" and "quarter" must be integers.');
    }

    targetPeriod = { year, quarter };

    if (!isValidPeriod(targetPeriod)) {
      throw new ValidationError(
        'Invalid period: year must be between 2000 and 2100, and quarter must be between 1 and 4.',
      );
    }
  }

  const { pulse } = wireBenchmarks();
  const summary = await pulse.getBenchmarkSummary(targetPeriod);

  return { data: summary };
});
