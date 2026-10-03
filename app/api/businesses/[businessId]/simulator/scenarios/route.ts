import { withApi } from "@/lib/http/handler";
import { resolveTenantContext } from "@/lib/http/auth-context";
import { parseJsonBody } from "@/lib/http/params";
import { wireIntelligence } from "@/lib/http/wiring";
import { runScenarioSchema } from "@/lib/validation/api-schemas";

/**
 * GET /api/businesses/[businessId]/simulator/scenarios
 */
export const GET = withApi(async (request: Request, route) => {
  const { ctx } = await resolveTenantContext(request, route.params.businessId);
  const { simulator } = wireIntelligence(ctx.businessId);
  const scenarios = await simulator.list(ctx, {});
  return { data: scenarios };
});

/**
 * POST /api/businesses/[businessId]/simulator/scenarios
 */
export const POST = withApi(async (request: Request, route) => {
  const { ctx } = await resolveTenantContext(request, route.params.businessId);
  const { simulator } = wireIntelligence(ctx.businessId);
  const body = await parseJsonBody(request, runScenarioSchema);
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86400000);
  const period = { from, to: now };
  const scenario = await simulator.runScenario(ctx, period, {
    name: body.name,
    description: body.description,
    parameters: body.parameters as never,
  });
  return { status: 201, data: scenario };
});
