import { withApi } from "@/lib/http/handler";
import { assertPermission, resolveTenantContext } from "@/lib/http/auth-context";
import { parseJsonBody } from "@/lib/http/params";
import { wireIntelligence } from "@/lib/http/wiring";
import { generateForecastSchema } from "@/lib/validation/api-schemas";
import type { DateRange } from "@/lib/types";

/**
 * GET /api/businesses/[businessId]/cash-flow/forecast
 */
export const GET = withApi(async (request: Request, route) => {
  const { ctx } = await resolveTenantContext(request, route.params.businessId);
  assertPermission(ctx, 'analytics:read');
  const { cashFlow } = wireIntelligence(ctx.businessId);
  const forecast = await cashFlow.getLatestForecast(ctx);
  return { data: forecast };
});

/**
 * POST /api/businesses/[businessId]/cash-flow/forecast
 */
export const POST = withApi(async (request: Request, route) => {
  const { ctx } = await resolveTenantContext(request, route.params.businessId);
  assertPermission(ctx, 'analytics:read');
  const { cashFlow } = wireIntelligence(ctx.businessId);
  const body = await parseJsonBody(request, generateForecastSchema);
  const now = new Date();
  const horizonDays = body.horizonDays ?? 30;
  const to = new Date(now.getTime() + horizonDays * 86400000);
  const period: DateRange = { from: now, to };
  const forecast = await cashFlow.forecast(ctx, period);
  return { status: 201, data: forecast };
});
