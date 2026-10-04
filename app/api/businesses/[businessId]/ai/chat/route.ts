import { withApi } from "@/lib/http/handler";
import { assertPermission, resolveTenantContext } from "@/lib/http/auth-context";
import { parseJsonBody } from "@/lib/http/params";
import { wireBusinessBrain } from "@/lib/ai/composition";
import { z } from "zod";

const aiChatSchema = z.object({
  message: z.string().min(1).max(4000),
  sessionId: z.string().uuid().optional(),
});

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
    sessionId: body.sessionId ?? "default-session",
    message: body.message,
  });

  return { status: 200, data: response };
});
