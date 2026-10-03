import { withApi } from '@/lib/http/handler';
import { requireRequestContext } from '@/lib/http/auth-context';

/**
 * GET /api/auth/session
 *
 * The only endpoint that tells a client which business ids it may use.
 * The list comes from the database's own membership resolution.
 */
export const GET = withApi(async (request: Request) => {
  const context = await requireRequestContext(request);
  return {
    data: {
      userId: context.user.userId,
      email: context.user.email,
      businessIds: context.user.businessIds,
    },
  };
});
