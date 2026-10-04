"use server";

// Merchant Brain: Business Brain AI reasoning Server Actions.
//
// Grounded AI: Models never access the database directly. They reason
// over deterministic intelligence outputs and retrieved evidence.

import { sendAiChatMessage } from "@/lib/api/endpoints";
import { toApiError } from "@/lib/api/settle";
import type { WireAiChatResponse } from "@/lib/api/contracts";

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
  try {
    const response = await sendAiChatMessage(businessId, { message, sessionId });
    return { outcome: "success", response };
  } catch (error) {
    const apiErr = toApiError(error);
    return {
      outcome: "error",
      message: apiErr.message || "Failed to retrieve reasoning from Business Brain.",
    };
  }
}
