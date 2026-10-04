import { withApi } from "@/lib/http/handler";
import { assertPermission, resolveTenantContext } from "@/lib/http/auth-context";
import { wireIntelligence } from "@/lib/http/wiring";

/**
 * GET /api/businesses/[businessId]/actions
 */
export const GET = withApi(async (request: Request, route) => {
  const { ctx } = await resolveTenantContext(request, route.params.businessId);
  assertPermission(ctx, 'actions:read');
  const { actions } = wireIntelligence(ctx.businessId);
  const sp = new URL(request.url).searchParams;
  const status = sp.get("status") as never;
  const type = sp.get("type") as never;

  const result = await actions.list(ctx, {
    ...(status ? { status } : {}),
    ...(type ? { type } : {}),
  });

  return {
    data: result.items,
    meta: {
      total: result.total,
      page: result.page,
      limit: result.limit,
      hasMore: result.hasMore,
    },
  };
});
