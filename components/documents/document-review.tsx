"use client";

// Merchant Brain: document review — the live human-approval boundary.
//
// Three properties this component is built around:
//
//   1. **Nothing is optimistic.** The buttons disable, a spinner appears, and
//      the new state is whatever the SERVER returned. There is no code path
//      that sets a local status to "approved" before the server agrees.
//
//   2. **The consequence is stated before the click.** Confirming says what
//      happens to the document and to the numbers. Rejecting asks for a reason,
//      because a rejection without one is unactionable for whoever uploaded it.
//
//   3. **Indeterminate is its own state.** If the network drops mid-decision
//      the screen says so and offers a way to check the real status, instead
//      of guessing either way.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleX, RefreshCw, TriangleAlert } from "lucide-react";

import {
  rejectDocumentForMerchant,
  type ReviewResult,
} from "@/app/(dashboard)/documents/actions";
import { ReviewedDocumentForm } from './reviewed-document-form';
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import type { WireDocument } from "@/lib/api/contracts";
import { describeStatus, DOCUMENT_STATUS } from "@/lib/format/status";

export function DocumentReview({
  businessId,
  document,
}: {
  readonly businessId: string;
  readonly document: WireDocument;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);

  const status = describeStatus(DOCUMENT_STATUS, document.status);
  const canDecide = document.status === "review_required" || document.status === "extracted";

  function run(decision: "reject") {
    if (decision === "reject" && reason.trim().length === 0) {
      // Stay open and explain, rather than dismissing the merchant's work.
      setReasonError("A reason is required so the document can be corrected.");
      return;
    }
    setReasonError(null);
    startTransition(async () => {
      const outcome = await rejectDocumentForMerchant(businessId, document.id, reason);
      setResult(outcome);
      // Only a recorded decision closes the dialog. An unconfirmable outcome
      // keeps it open so the merchant can read what happened.
      if (decision === "reject" && outcome.outcome === "confirmed") {
        setRejectOpen(false);
      }
      // The server revalidated the route; pull the authoritative state.
      router.refresh();
    });
  }

  if (!canDecide && !result) {
    return (
      <Alert>
        <CircleCheck aria-hidden="true" />
        <AlertTitle>{document.status === 'failed' ? 'Extraction needs attention' : 'Document state'}</AlertTitle>
        <AlertDescription>
          This document is {status.label.toLowerCase()}.{" "}
          {status.description}
        </AlertDescription>
        <ReviewedDocumentForm businessId={businessId} document={document} />
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Current state</span>
        <StatusBadge descriptor={status} />
      </div>

      {result ? <ReviewOutcome result={result} /> : null}
      <ReviewedDocumentForm businessId={businessId} document={document} />

      <div className="flex flex-wrap items-center gap-2">

        <AlertDialog
          open={rejectOpen}
          onOpenChange={(open) => {
            setRejectOpen(open);
            // Only reset once the dialog is actually going away, so a failed
            // validation does not wipe what the merchant typed.
            if (!open) {
              setReason("");
              setReasonError(null);
            }
          }}
        >
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              disabled={pending || document.status === "rejected"}
            >
              {pending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <CircleX data-icon="inline-start" />
              )}
              Reject
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reject this document?</AlertDialogTitle>
              <AlertDialogDescription>
                It will not affect your numbers. Tell us what was wrong so whoever
                sent it can fix it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Field data-invalid={reasonError ? true : undefined} className="gap-2">
              <FieldLabel htmlFor="reject-reason">Why are you rejecting it?</FieldLabel>
              <Textarea
                id="reject-reason"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  if (reasonError) setReasonError(null);
                }}
                placeholder="The total does not match the invoice…"
                maxLength={500}
                aria-invalid={reasonError ? true : undefined}
                aria-describedby={reasonError ? "reject-reason-error" : undefined}
              />
              {reasonError ? (
                <FieldError id="reject-reason-error">{reasonError}</FieldError>
              ) : null}
            </Field>
            <AlertDialogFooter>
              <AlertDialogCancel>Go back</AlertDialogCancel>
              {/*
                Deliberately a Button, not an AlertDialogAction.
                AlertDialogAction closes the dialog on click, so rejecting with
                no reason would dismiss the dialog and never show the
                explanation. This stays open until the decision is actually
                recorded, and closes itself on success.
              */}
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => run("reject")}
              >
                {pending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <CircleX data-icon="inline-start" />
                )}
                Reject document
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Button variant="ghost" size="sm" onClick={() => router.refresh()} disabled={pending}>
          <RefreshCw data-icon="inline-start" />
          Check the real status
        </Button>
      </div>
    </div>
  );
}

/**
 * The outcome, described honestly. On success it renders the status the SERVER
 * returned — not the status we asked for.
 */
function ReviewOutcome({ result }: { readonly result: ReviewResult }) {
  if (result.outcome === "confirmed") {
    const status = describeStatus(DOCUMENT_STATUS, result.document.status);
    return (
      <Alert
        className={
          result.document.status === "approved"
            ? "border-positive-border bg-positive-subtle"
            : "border-negative-border bg-negative-subtle"
        }
      >
        {result.document.status === "approved" ? (
          <CircleCheck aria-hidden="true" className="text-positive-foreground" />
        ) : (
          <CircleX aria-hidden="true" className="text-negative-foreground" />
        )}
        <AlertTitle
          className={
            result.document.status === "approved"
              ? "text-positive-foreground"
              : "text-negative-foreground"
          }
        >
          Saved. This document is now {status.label.toLowerCase()}.
        </AlertTitle>
        <AlertDescription>
          {status.description} This is the state recorded by the server, not an
          assumption.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert
      variant={result.indeterminate ? "default" : "destructive"}
      className={result.indeterminate ? "border-caution-border bg-caution-subtle" : undefined}
    >
      <TriangleAlert aria-hidden="true" className="text-caution-foreground" />
      <AlertTitle className="text-caution-foreground">{result.message}</AlertTitle>
      <AlertDescription>
        {result.recovery}
        {result.reference ? (
          <span className="mt-1 block text-xs">
            Quote reference{" "}
            <span className="font-mono">{result.reference}</span> if you contact
            support.
          </span>
        ) : null}
        {result.indeterminate ? (
          <span className="mt-1 block text-xs">
            Check &ldquo;Check the real status&rdquo; below before trying again —
            your decision may already have been recorded.
          </span>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
