import { withApi } from '@/lib/http/handler';
import { requireRequestContext } from '@/lib/http/auth-context';
import { wire, wireClient } from '@/lib/http/wiring';

/**
 * GET /api/businesses
 *
 * Businesses the caller is an active member of. There is no tenant parameter
 * to forge: RLS filters the query and the service additionally predicates on
 * the authenticated user id.
 */
export const GET = withApi(async (request: Request) => {
  const context = await requireRequestContext(request);
  const { db } = wire(context.accessToken);
  const { businesses } = wireClient(db as never);
  const list = await businesses.listForUser(context.user.userId);

  return {
    data: list.map((b) => ({ id: b.id, name: b.name, type: b.type, status: b.status })),
  };
});
