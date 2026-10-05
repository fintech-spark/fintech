"use server";

// Merchant Brain: action lifecycle Server Actions.
//
// Dual-approval invariant: Consequential actions require two distinct users.
// Server actions run in server-only context and call authoritative endpoints.

import { revalidatePath } from "next/cache";
import { approveAction, executeAction, transitionAction } from "@/lib/api/endpoints";
import { z } from 'zod';
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

export async function transitionActionForMerchant(businessId: string, actionId: string, transition: 'draft' | 'submit' | 'reject' | 'cancel' | 'expire', reason?: string): Promise<ActionExecutionResult> {
  try {
    const parsed = z.enum(['draft','submit','reject','cancel','expire']).parse(transition);
    const action = await transitionAction(businessId,actionId,parsed,reason);
    revalidatePath('/actions');
    return {outcome:'confirmed',action};
  } catch (error) {
    const err = toApiError(error);
    return {outcome:'rejected',message:err.userMessage,indeterminate:err.isIndeterminate};
  }
}

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
    if (!result.executed || result.action.status !== 'completed') {
      return { outcome: 'rejected', message: 'Execution was not confirmed. Check the action status before trying again.', indeterminate: result.action.status === 'executing' };
    }
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
