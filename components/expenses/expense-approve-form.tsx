"use client";

// Merchant Brain: expense approval form.
//
// Nothing is optimistic. The buttons disable, a spinner appears, and the new
// state is whatever the SERVER returned. Success only after confirmation.

import { useState, useTransition } from "react";
import { CircleCheck, CircleX, RefreshCw, TriangleAlert, ShieldAlert } from "lucide-react";

import { approveExpenseForMerchant, type ExpenseApprovalResult } from "@/app/(dashboard)/expenses/actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

export function ExpenseApproveForm({
  businessId,
  expenseId,
  canApprove,
  currentStatusLabel,
}: {
  readonly businessId: string;
  readonly expenseId: string;
  readonly canApprove: boolean;
  readonly currentStatusLabel: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ExpenseApprovalResult | null>(null);

  function submit() {
    startTransition(async () => {
      const outcome = await approveExpenseForMerchant(businessId, expenseId);
      setResult(outcome);
    });
  }

  if (result?.outcome === "confirmed") {
    return (
      <div className="flex flex-col gap-3">
        <Alert variant="default">
          <CircleCheck aria-hidden="true" className="size-4" />
          <AlertTitle>Approved</AlertTitle>
          <AlertDescription>
            The expense has been confirmed. The server returned the updated
            state — this is the authoritative record.
          </AlertDescription>
        </Alert>
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          Status: <strong>approved</strong> | Expense ID: {expenseId.slice(0, 8)}
        </div>
      </div>
    );
  }

  if (result?.outcome === "rejected") {
    const indeterminate = result.indeterminate;
    return (
      <div className="flex flex-col gap-3">
        <Alert variant={indeterminate ? "default" : "destructive"}>
          {indeterminate ? (
            <TriangleAlert aria-hidden="true" className="size-4" />
          ) : (
            <CircleX aria-hidden="true" className="size-4" />
          )}
          <AlertTitle>Not confirmed</AlertTitle>
          <AlertDescription>
            {result.message}{" "}
            <span className="font-medium">{result.recovery}</span>
          </AlertDescription>
        </Alert>
        {indeterminate && (
          <p className="text-xs text-muted-foreground">
            The outcome is indeterminate — the server could not confirm whether
            the approval was recorded. Check the expense state before retrying.
          </p>
        )}
        <Button
          onClick={submit}
          disabled={pending}
          variant="outline"
          className="w-full"
        >
          {pending ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">Current</span>
        <span className="font-medium">{currentStatusLabel}</span>
      </div>

      {!canApprove && (
        <Alert variant="destructive">
          <ShieldAlert aria-hidden="true" className="size-4" />
          <AlertTitle>Not available</AlertTitle>
          <AlertDescription>
            This expense is already at a terminal state and does not need
            approval.
          </AlertDescription>
        </Alert>
      )}

      <p className="text-xs text-muted-foreground">
        Confirming this expense will record it as approved on the server. The
        confirmation below is the only source of truth.
      </p>

      <Button
        onClick={submit}
        disabled={pending || !canApprove}
        className="w-full"
      >
        {pending ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <CircleCheck data-icon="inline-start" />
        )}
        Confirm approval
      </Button>
    </div>
  );
}
