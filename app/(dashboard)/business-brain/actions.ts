"use server";

// Merchant Brain: Business Brain AI reasoning Server Actions.
//
// Grounded AI: Models never access the database directly. They reason
// over deterministic intelligence outputs and retrieved evidence.

import { sendAiChatMessage } from "@/lib/api/endpoints";
import { toApiError } from "@/lib/api/settle";
import type { WireAiChatResponse } from "@/lib/api/contracts";
import { resolveMerchantContext, isAuthenticated } from "@/lib/api/context";
import { wireBusinessBrain } from "@/lib/ai/composition";
import { asBusinessId, asUserId } from "@/lib/types";

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
  // Try via API endpoint first
  try {
    const response = await sendAiChatMessage(businessId, { message, sessionId });
    return { outcome: "success", response };
  } catch (err) {
    // In-process fallback: avoid network loopback and Vercel preview deployment protection blocks
    try {
      const context = await resolveMerchantContext();
      if (!isAuthenticated(context)) {
        return {
          outcome: "error",
          message: "Authentication required to query Business Brain.",
        };
      }
      const bizId = asBusinessId(businessId);
      const { brain } = wireBusinessBrain(bizId);
      const activeMember = context.members.find((m) => m.businessId === businessId);
      const tenantCtx = {
        businessId: bizId,
        userId: asUserId(context.session.userId),
        role: activeMember?.role ?? "owner",
        correlationId: crypto.randomUUID(),
      };
      const response = await brain.query(tenantCtx, {
        businessId: bizId,
        userId: tenantCtx.userId,
        sessionId: sessionId ?? crypto.randomUUID(),
        message,
      });
      return { outcome: "success", response: response as unknown as WireAiChatResponse };
    } catch (fallbackError) {
      const apiErr = toApiError(fallbackError || err);
      return {
        outcome: "error",
        message: apiErr.userMessage || apiErr.message || "Failed to retrieve reasoning from Business Brain.",
      };
    }
  }
}
