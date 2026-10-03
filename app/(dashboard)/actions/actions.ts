"use server";

// Merchant Brain: action lifecycle Server Actions.
//
// Dual-approval invariant: Consequential actions require two distinct users.
// Server actions run in server-only context and call authoritative endpoints.

import { revalidatePath } from "next/cache";
import { approveAction, executeAction } from "@/lib/api/endpoints";
import { toApiError } from "@/lib/api/settle";
import type { WireAction } from "@/lib/api/contracts";

export type ActionExecutionResult =
  | {
      readonly outcome: "confirmed";
      readonly action: WireAction;
    }
  | {
      readonly outcome: "rejected";
      readonly message: string;
      readonly indeterminate: boolean;
    };

export async function approveActionForMerchant(
  businessId: string,
  actionId: string,
): Promise<ActionExecutionResult> {
  try {
    const updated = await approveAction(businessId, actionId);
    revalidatePath("/actions");
    return { outcome: "confirmed", action: updated };
  } catch (error) {
    const apiErr = toApiError(error);
    const message =
      apiErr.statusCode === 403
        ? "Action approval denied: Under strict dual-approval policy, the action creator cannot self-approve, or your role lacks permission."
        : apiErr.message || "Failed to approve action.";
    return {
      outcome: "rejected",
      message,
      indeterminate: apiErr.statusCode >= 500,
    };
  }
}

export async function executeActionForMerchant(
  businessId: string,
  actionId: string,
): Promise<ActionExecutionResult> {
  try {
    const result = await executeAction(businessId, actionId);
    revalidatePath("/actions");
    return { outcome: "confirmed", action: result.action };
  } catch (error) {
    const apiErr = toApiError(error);
    return {
      outcome: "rejected",
      message: apiErr.message || "Failed to execute action.",
      indeterminate: apiErr.statusCode >= 500,
    };
  }
}
