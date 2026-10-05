import { withApi, type NextRouteContext } from "@/lib/http/handler";
import { assertPermission, extractAccessToken, resolveTenantContext } from "@/lib/http/auth-context";
import { AuthenticationError, ValidationError } from "@/lib/errors";
import { wireBusinessBrain } from "@/lib/ai/composition";
import { z } from "zod";

const historyQuery = z.object({
  sessionId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
  before: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict();

const historyHandler = withApi(async (request, route) => {
  if (!extractAccessToken(request)) throw new AuthenticationError();
  const { ctx } = await resolveTenantContext(request, route.params.businessId);
  assertPermission(ctx, "analytics:read");
  const parsed = historyQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) throw new ValidationError("Invalid history query.");
  const { sessionId, ...options } = parsed.data;
  const { brain } = wireBusinessBrain(ctx.businessId);
  return { data: await brain.getSessionHistory(ctx, sessionId, options) };
});

export async function GET(request: Request, route: NextRouteContext): Promise<Response> {
  const response = await historyHandler(request, route);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
