import { withApi } from "@/lib/http/handler";
import { resolveTenantContext } from "@/lib/http/auth-context";
import { wireIntelligence } from "@/lib/http/wiring";
import { ValidationError } from "@/lib/errors";
import type { DateRange } from "@/lib/types";

/**
 * GET /api/businesses/[businessId]/analytics/snapshot
 *
 * Query params: from, to (ISO strings).
 * Defaults to the past 30 days.
 */
export const GET = withApi(async (request: Request, route) => {
  const { ctx } = await resolveTenantContext(request, route.params.businessId);
  const { analytics } = wireIntelligence(ctx.businessId);

  const sp = new URL(request.url).searchParams;
  const fromStr = sp.get("from");
  const toStr = sp.get("to");

  const now = new Date();
  const from = fromStr ? new Date(fromStr) : new Date(now.getTime() - 30 * 86400000);
  const to = toStr ? new Date(toStr) : now;

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new ValidationError("Invalid date parameter format.");
  }
  if (from >= to) {
    throw new ValidationError("Period \"from\" must be strictly before \"to\".");
  }

  const period: DateRange = { from, to };
  const snapshot = await analytics.getSnapshot(ctx, period);
  return { data: snapshot };
});
