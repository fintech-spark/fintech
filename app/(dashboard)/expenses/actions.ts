"use server";

// Merchant Brain: expense approval — human-approval boundary.
//
// The server response is the ONLY source of truth. A successful request
// that returns a status the merchant did not expect is still what the UI
// renders. A transport failure is reported honestly, never as "rejected".

import { revalidatePath } from "next/cache";
import { approveExpense } from "@/lib/api/endpoints";
import { toApiError, type Settled } from "@/lib/api/settle";
import type { WireExpense } from "@/lib/api/contracts";

export type ExpenseApprovalResult =
  | {
      readonly outcome: "confirmed";
      readonly expense: WireExpense;
    }
  | {
      readonly outcome: "rejected";
      readonly message: string;
      readonly recovery: string;
      readonly indeterminate: boolean;
      readonly reference: string | null;
    };

export async function approveExpenseForMerchant(
  businessId: string,
  expenseId: string,
  idempotencyKey?: string,
): Promise<ExpenseApprovalResult> {
  let result: Settled<WireExpense>;
  try {
    result = {
      ok: true,
      value: await approveExpense(businessId, expenseId, idempotencyKey),
    };
  } catch (error) {
    const apiErr = toApiError(error);
    const message = apiErr.message || "Could not confirm the approval.";
    const recovery =
      apiErr.statusCode === 403
        ? "Only owners, admins or managers can approve expenses."
        : apiErr.statusCode === 409
          ? "This expense may already be approved. Check the current state before retrying."
          : apiErr.statusCode === 422
            ? "The request could not be processed (scan overflow or invalid state). Review the expense details."
            : apiErr.statusCode === 500
              ? "The server could not complete the approval. Wait a moment and retry."
              : "Please check the connection and retry.";
    return {
      outcome: "rejected",
      message,
      recovery,
      indeterminate: apiErr.statusCode >= 500 || apiErr.name === "NetworkError",
      reference: apiErr.code ?? null,
    };
  }

  revalidatePath(`/expenses/${expenseId}`);
  revalidatePath("/expenses");
  return { outcome: "confirmed", expense: result.value };
}
