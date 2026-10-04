import { withApi } from "@/lib/http/handler";
import { assertPermission, resolveTenantContext } from "@/lib/http/auth-context";
import { parseJsonBody } from "@/lib/http/params";
import { wireIntelligence } from "@/lib/http/wiring";
import { runScenarioSchema } from "@/lib/validation/api-schemas";

/**
 * GET /api/businesses/[businessId]/simulator/scenarios
 */
export const GET = withApi(async (request: Request, route) => {
  const { ctx } = await resolveTenantContext(request, route.params.businessId);
  assertPermission(ctx, 'analytics:read');
  const { simulator } = wireIntelligence(ctx.businessId);
  const scenarios = await simulator.list(ctx, {});
  return { data: scenarios };
});

/**
 * POST /api/businesses/[businessId]/simulator/scenarios
 */
export const POST = withApi(async (request: Request, route) => {
  const { ctx } = await resolveTenantContext(request, route.params.businessId);
  assertPermission(ctx, 'analytics:read');
  const { simulator } = wireIntelligence(ctx.businessId);
  const body = await parseJsonBody(request, runScenarioSchema);
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86400000);
  const period = { from, to: now };
  const scenario = await simulator.runScenario(ctx, period, {
    name: body.name,
    description: body.description,
    parameters: body.parameters.map((p) => ({
      type: p.type as never,
      targetId: p.targetProductId ?? p.targetId,
      targetName: p.targetCategory ?? p.targetName ?? p.name,
      currentValue: p.currentValue ?? 0,
      newValue: p.newValue ?? p.value ?? 0,
      unit: (p.unit === 'minor_units' ? 'amount' : p.unit === 'basis_points' ? 'percentage' : p.unit) as never,
    })),
  });
  return { status: 201, data: scenario };
});
