"use client";

// Route-level error boundary for the authenticated application.
//
// The rule: a merchant never sees a status code, an error class name, or a
// stack trace. They see what happened, what they can do, and a way to try
// again. The technical detail goes to the console for the developer.

import { useEffect } from "react";
import { CircleAlert, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    // No business data is logged here — only the failure itself.
    console.error("Merchant Brain screen failed to render:", error.message);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-start gap-4 rounded-xl border border-border bg-card p-6">
      <div className="flex items-start gap-3">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-5 text-destructive" />
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold tracking-tight">
            This screen could not be shown
          </h1>
          <p className="text-pretty text-sm text-muted-foreground">
            Something went wrong while loading this page. Your records are
            untouched. Try again, and if it keeps happening, tell support the
            reference below.
          </p>
        </div>
      </div>

      {error.digest ? (
        <p className="text-xs text-muted-foreground">
          Reference <span className="font-mono">{error.digest}</span>
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button onClick={reset}>
          <RotateCcw data-icon="inline-start" />
          Try again
        </Button>
        <Button variant="outline" asChild>
          <a href="/overview">Go to Overview</a>
        </Button>
      </div>
    </div>
  );
}
