import { withApi } from '@/lib/http/handler';
import { parseEnum, parsePagination } from '@/lib/http/params';
import { resolveTenantContext } from '@/lib/http/auth-context';
import { wireIntelligence } from '@/lib/http/wiring';

const NOTIFICATION_TYPES = [
  'profit_leak_detected',
  'cash_flow_risk',
  'action_proposed',
  'action_completed',
  'document_processed',
  'low_stock_alert',
  'overdue_payment',
  'review_required',
  'system',
] as const;

const NOTIFICATION_STATUSES = ['unread', 'read', 'dismissed'] as const;

/**
 * GET /api/businesses/[businessId]/notifications — one page of tenant alerts.
 */
export const GET = withApi(async (request: Request, route) => {
  const { ctx } = await resolveTenantContext(request, route.params.businessId);
  const { notifications } = wireIntelligence(ctx.businessId);
  const sp = new URL(request.url).searchParams;
  const pagination = parsePagination(sp);

  const status = parseEnum(sp.get('status'), NOTIFICATION_STATUSES, 'status');
  const type = parseEnum(sp.get('type'), NOTIFICATION_TYPES, 'type');

  const result = await notifications.list(ctx, {
    page: pagination.page,
    limit: pagination.limit,
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

/**
 * POST /api/businesses/[businessId]/notifications/read-all — mark all as read.
 */
export const POST = withApi(async (request: Request, route) => {
  const { ctx } = await resolveTenantContext(request, route.params.businessId);
  const { notifications } = wireIntelligence(ctx.businessId);
  await notifications.markAllAsRead(ctx);
  return { status: 200, data: { success: true } };
});
