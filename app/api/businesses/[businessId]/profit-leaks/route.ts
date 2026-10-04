import { withApi } from "@/lib/http/handler";
import { assertPermission, resolveTenantContext } from "@/lib/http/auth-context";
import { wireIntelligence } from "@/lib/http/wiring";

/**
 * GET /api/businesses/[businessId]/profit-leaks
 */
export const GET = withApi(async (request: Request, route) => {
  const { ctx } = await resolveTenantContext(request, route.params.businessId);
  assertPermission(ctx, 'analytics:read');
  const { profitLeaks } = wireIntelligence(ctx.businessId);
  const sp = new URL(request.url).searchParams;
  const status = sp.get("status") as never;
  const severity = sp.get("severity") as never;
  const category = sp.get("category") as never;

  const leaks = await profitLeaks.list(ctx, {
    ...(status ? { status } : {}),
    ...(severity ? { severity } : {}),
    ...(category ? { category } : {}),
  });

  return { data: leaks };
});
