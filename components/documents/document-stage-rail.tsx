"use client";

// Merchant Brain: the document processing rail.
//
// A merchant should never wonder whether something is stuck. Each step is named
// in their language, the current one is marked with text and a dot (not colour
// alone), and completed steps are visibly complete.
//
// `review_required` is its own step because it is the one that needs the
// merchant — hiding it inside "processing" would make the product feel broken.

import { Check } from "lucide-react";

import {
  DOCUMENT_PIPELINE,
  describeStatus,
  DOCUMENT_STATUS,
  type DocumentStatus,
} from "@/lib/format/status";
import { cn } from "@/lib/utils";

const TERMINAL: readonly DocumentStatus[] = ["approved", "rejected", "failed"];

export function DocumentStageRail({ status }: { readonly status: DocumentStatus }) {
  // A terminal state is appended to the rail rather than replacing it, so the
  // merchant can see how far a document got before it stopped.
  const stages: readonly DocumentStatus[] = TERMINAL.includes(status)
    ? [...DOCUMENT_PIPELINE, status]
    : DOCUMENT_PIPELINE;

  const currentIndex = stages.indexOf(status);
  const stopped = TERMINAL.includes(status);

  return (
    <ol className="flex flex-col gap-3">
      {stages.map((stage, index) => {
        const done = currentIndex > index;
        const current = stage === status;
        return (
          <li
            key={stage}
            aria-current={current ? "step" : undefined}
            className="flex items-start gap-3"
          >
            <StageMarker
              done={done}
              current={current}
              failed={stopped && current}
            />
            <StageLabel stage={stage} current={current} done={done} />
          </li>
        );
      })}
    </ol>
  );
}

function StageMarker({
  done,
  current,
  failed,
}: {
  readonly done: boolean;
  readonly current: boolean;
  readonly failed: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
        failed
          ? "border-negative-border bg-negative-subtle text-negative-foreground"
          : done
            ? "border-positive-border bg-positive-subtle text-positive-foreground"
            : current
              ? "border-pending-border bg-pending-subtle text-pending-foreground"
              : "border-border bg-background text-muted-foreground",
      )}
    >
      {done ? (
        <Check className="size-3.5" />
      ) : (
        <span
          className={cn(
            "size-1.5 rounded-full",
            current ? "bg-current" : "bg-border",
          )}
        />
      )}
    </span>
  );
}

function StageLabel({
  stage,
  current,
  done,
}: {
  readonly stage: DocumentStatus;
  readonly current: boolean;
  readonly done: boolean;
}) {
  const descriptor = describeStatus(DOCUMENT_STATUS, stage);
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span
        className={cn(
          "text-sm",
          current
            ? "font-medium text-foreground"
            : done
              ? "text-foreground"
              : "text-muted-foreground",
        )}
      >
        {descriptor.label}
        {current ? <span className="sr-only"> (current step)</span> : null}
        {done && !current ? <span className="sr-only"> (done)</span> : null}
      </span>
      <span className="text-xs text-muted-foreground">{descriptor.description}</span>
    </span>
  );
}