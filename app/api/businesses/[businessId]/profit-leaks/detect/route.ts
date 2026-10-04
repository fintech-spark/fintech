import { withApi } from "@/lib/http/handler";
import { assertPermission, resolveTenantContext } from "@/lib/http/auth-context";
import { wireIntelligence } from "@/lib/http/wiring";
import { ValidationError } from "@/lib/errors";

/**
 * POST /api/businesses/[businessId]/profit-leaks/detect
 */
export const POST = withApi(async (request: Request, route) => {
  const { ctx } = await resolveTenantContext(request, route.params.businessId);
  assertPermission(ctx, 'analytics:read');
  const { profitLeaks } = wireIntelligence(ctx.businessId);

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

  const report = await profitLeaks.analyze(ctx, { from, to });
  return { status: 200, data: report };
});
