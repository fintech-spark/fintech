import { withApi } from "@/lib/http/handler";
import { parseEnum, parsePagination } from '@/lib/http/params';
import { ACTION_PARAMETER_SPECS, ACTION_STATUS_TRANSITIONS, type ActionStatus, type ActionType } from '@/modules/actions';
import { resolveActions } from './_http';

/**
 * GET /api/businesses/[businessId]/actions
 */
export const GET = withApi(async (request: Request, route) => {
  const { ctx, actions } = await resolveActions(request, route.params, 'actions:read');
  const sp = new URL(request.url).searchParams;
  const status = parseEnum(sp.get('status'), Object.keys(ACTION_STATUS_TRANSITIONS) as ActionStatus[], 'status');
  const type = parseEnum(sp.get('type'), Object.keys(ACTION_PARAMETER_SPECS) as ActionType[], 'type');
  const source = parseEnum(sp.get('source'), ['manual', 'ai_recommendation', 'profit_leak', 'cash_flow_risk'] as const, 'source');

  const result = await actions.list(ctx, {
    ...parsePagination(sp),
    ...(source ? { source } : {}),
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
