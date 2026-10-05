import { withApi } from "@/lib/http/handler";
import { assertPermission, extractAccessToken, resolveTenantContext } from "@/lib/http/auth-context";
import { AuthenticationError } from "@/lib/errors";
import { assertTrustedOrigin } from "@/lib/auth/http";
import { parseJsonBody } from "@/lib/http/params";
import { wireBusinessBrain } from "@/lib/ai/composition";
import { z } from "zod";

const aiChatSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  sessionId: z.string().uuid().optional(),
}).strict();

/**
 * POST /api/businesses/[businessId]/ai/chat
 *
 * Authenticated AI endpoint for Merchant Brain Business Brain.
 * - Resolves verified tenant context (rejects cross-tenant caller with 403)
 * - Restricts message size
 * - Evaluates question through tenant-scoped read-only tools & RAG
 * - Returns structured response with cited evidence and confidence
 */
export const POST = withApi(async (request: Request, route) => {
  assertTrustedOrigin(request);
  if (!extractAccessToken(request)) throw new AuthenticationError();
  const { ctx } = await resolveTenantContext(request, route.params.businessId);
  // Business Brain answers questions from the merchant's own financial records,
  // so it is an analytics capability: a role without analytics:read has no
  // business seeing the aggregate figures behind the answer.
  assertPermission(ctx, 'analytics:read');
  const body = await parseJsonBody(request, aiChatSchema);
  const { brain } = wireBusinessBrain(ctx.businessId);

  const response = await brain.query(ctx, {
    businessId: ctx.businessId,
    userId: ctx.userId,
    // Never share a process-wide/default conversation key. Clients that want
    // continuity provide their own UUID; a one-off request gets an isolated
    // server-generated session instead.
    sessionId: body.sessionId ?? crypto.randomUUID(),
    message: body.message,
  });

  return { status: 200, data: response };
});
