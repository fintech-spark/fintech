"use server";

// Merchant Brain: Business Brain AI reasoning Server Actions.
//
// Grounded AI: Models never access the database directly. They reason
// over deterministic intelligence outputs and retrieved evidence.

import { cookies } from "next/headers";
import { toApiError } from "@/lib/api/settle";
import type { WireAiChatResponse } from "@/lib/api/contracts";
import { wireBusinessBrain } from "@/lib/ai/composition";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { assertPermission, resolveTenantContext } from "@/lib/http/auth-context";
import { AuthenticationError } from "@/lib/errors";
import { z } from "zod";

const querySchema = z.object({
  message: z.string().trim().min(1).max(4000),
  sessionId: z.string().uuid().optional(),
}).strict();

export type AiChatResult =
  | {
      readonly outcome: "success";
      readonly response: WireAiChatResponse;
    }
  | {
      readonly outcome: "error";
      readonly message: string;
    };

export async function askBusinessBrain(
  businessId: string,
  message: string,
  sessionId?: string,
): Promise<AiChatResult> {
  // In-process execution avoids loopback protection and, critically, does not
  // retry a query whose API response was lost after the turn was persisted.
  try {
    const token = (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value;
    if (!token) throw new AuthenticationError("Authentication required.");
    const { ctx } = await resolveTenantContext(new Request("http://localhost", {
      headers: { authorization: `Bearer ${token}` },
    }), businessId);
    assertPermission(ctx, "analytics:read");
    const input = querySchema.parse({ message, sessionId });
    const { brain } = wireBusinessBrain(ctx.businessId);
    const response = await brain.query(ctx, {
      businessId: ctx.businessId,
      userId: ctx.userId,
      message: input.message,
      sessionId: input.sessionId ?? crypto.randomUUID(),
    });
    return { outcome: "success", response: { ...response, toolsUsed: [...response.toolsUsed], evidence: [...response.evidence] } };
  } catch (err) {
    const apiErr = toApiError(err);
    return { outcome: "error", message: apiErr.userMessage || "Failed to retrieve reasoning from Business Brain." };
  }
}
