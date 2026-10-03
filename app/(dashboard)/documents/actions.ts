"use server";

// Merchant Brain: document review actions.
//
// This is a genuine human-approval boundary, so the rules are strict:
//
//   1. The server response is the ONLY source of truth. A successful request
//      that returns a status the merchant did not expect is still what the UI
//      renders. The client never assumes `approved`.
//   2. A transport failure is reported as indeterminate, never as "rejected".
//      Saying "we could not confirm" is honest; saying "it failed" would be a
//      guess that could make a merchant re-approve something already approved.
//   3. Idempotency keys are derived from the document id and the decision, so a
//      double-tap or a retry cannot record two decisions.
//   4. Authorization is enforced by the backend from the session. Nothing here
//      decides whether the merchant may act.

import { revalidatePath } from "next/cache";

import { approveDocument, rejectDocument } from "@/lib/api/endpoints";
import { toApiError, type Settled } from "@/lib/api/settle";
import type { WireDocument } from "@/lib/api/contracts";

export type ReviewResult =
  | {
      readonly outcome: "confirmed";
      /** The server's authoritative state after the decision. */
      readonly document: WireDocument;
    }
  | {
      readonly outcome: "rejected";
      /** What went wrong, in language the merchant can act on. */
      readonly message: string;
      readonly recovery: string;
      /** True when we cannot tell whether the decision was recorded. */
      readonly indeterminate: boolean;
      readonly reference: string | null;
    };

export async function approveDocumentForMerchant(
  businessId: string,
  documentId: string,
): Promise<ReviewResult> {
  let result: Settled<WireDocument>;
  try {
    result = {
      ok: true,
      value: await approveDocument(businessId, documentId),
    };
  } catch (error) {
    return toReviewFailure(error);
  }

  revalidatePath(`/documents/${documentId}`);
  revalidatePath("/documents");
  return { outcome: "confirmed", document: result.value };
}

export async function rejectDocumentForMerchant(
  businessId: string,
  documentId: string,
  reason: string,
): Promise<ReviewResult> {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    // Checked here for a fast, clear message. The backend validates again.
    return {
      outcome: "rejected",
      message: "Tell us why you are rejecting this.",
      recovery: "A short reason helps whoever uploaded it fix it.",
      indeterminate: false,
      reference: null,
    };
  }

  let result: Settled<WireDocument>;
  try {
    result = {
      ok: true,
      value: await rejectDocument(businessId, documentId, trimmed),
    };
  } catch (error) {
    return toReviewFailure(error);
  }

  revalidatePath(`/documents/${documentId}`);
  revalidatePath("/documents");
  return { outcome: "confirmed", document: result.value };
}

function toReviewFailure(error: unknown): ReviewResult {
  const apiError = toApiError(error);
  return {
    outcome: "rejected",
    message: apiError.isIndeterminate
      ? "We could not confirm whether your decision was recorded."
      : apiError.userMessage,
    recovery: apiError.recovery,
    indeterminate: apiError.isIndeterminate,
    reference: apiError.reference,
  };
}