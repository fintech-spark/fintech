"use client";

// Merchant Brain: the five states of real data.
//
// A page cannot forget a state, because `DataState` takes a discriminated
// union and TypeScript rejects an unhandled branch. Every screen in this app
// therefore has loading, empty, error, partial and ready states by
// construction rather than by remembering.
//
// The rule from PRODUCT_SPEC.md is load-bearing here: "no data" is never an
// acceptable answer on its own. Every panel says what it means and what to do
// next.

import {
  Cable,
  CircleAlert,
  Inbox,
  Loader2,
  Lock,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

import { ApiError, type CapabilityUnavailableError } from "@/lib/api/errors";
import type { PendingCapability } from "@/lib/api/pending";
import { cn } from "@/lib/utils";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

/** True when some of a dataset loaded and some did not. */
export interface PartialDataNote {
  /** What is missing, in merchant language. */
  readonly missing: string;
  /** Why it is missing, if the backend said so. */
  readonly reason?: string;
}

export type DataState<T> =
  | { readonly kind: "loading"; readonly label?: string; readonly rows?: number }
  | {
      readonly kind: "ready";
      readonly data: T;
      readonly partial?: PartialDataNote | null;
    }
  | {
      readonly kind: "empty";
      readonly title: string;
      readonly description: string;
      readonly action?: React.ReactNode;
      /**
       * An ELEMENT, not a component type. `data-state.tsx` is a Client
       * Component, and React cannot serialise a component function across the
       * server/client boundary — so callers must pass `<Icon aria-hidden />`.
       */
      readonly icon?: React.ReactNode;
    }
  | {
      readonly kind: "error";
      readonly error: ApiError | CapabilityUnavailableError;
      readonly onRetry?: () => void;
    }
  | {
      readonly kind: "unavailable";
      readonly capability: PendingCapability;
      readonly action?: React.ReactNode;
    }
  | {
      readonly kind: "forbidden";
      readonly message?: string;
      readonly recovery?: string;
    };

export interface DataStateProps<T> {
  readonly state: DataState<T>;
  readonly children: (data: T) => React.ReactNode;
  /** `card` wraps each panel in a Card; `plain` leaves spacing to the page. */
  readonly variant?: "card" | "plain";
  readonly className?: string;
  /** Skeleton height for the loading state. */
  readonly loadingRows?: number;
}

export function DataState<T>({
  state,
  children,
  variant = "plain",
  className,
  loadingRows = 3,
}: DataStateProps<T>) {
  switch (state.kind) {
    case "loading":
      return (
        <LoadingPanel
          label={state.label}
          rows={state.rows ?? loadingRows}
          variant={variant}
          className={className}
        />
      );
    case "ready":
      return (
        <>
          {state.partial ? (
            <PartialDataNotice note={state.partial} className="mb-3" />
          ) : null}
          {children(state.data)}
        </>
      );
    case "empty":
      return (
        <EmptyPanel
          title={state.title}
          description={state.description}
          action={state.action}
          icon={state.icon}
          variant={variant}
          className={className}
        />
      );
    case "error":
      return (
        <ErrorPanel
          error={state.error}
          onRetry={state.onRetry}
          variant={variant}
          className={className}
        />
      );
    case "unavailable":
      return (
        <CapabilityPanel
          capability={state.capability}
          action={state.action}
          variant={variant}
          className={className}
        />
      );
    case "forbidden":
      return (
        <ForbiddenPanel
          message={state.message}
          recovery={state.recovery}
          variant={variant}
          className={className}
        />
      );
  }
}

// ── Individual panels ──────────────────────────────────────────────────────

/**
 * Loading is announced, never faked. Contextual copy beats a spinner with no
 * explanation: "Reading your inventory…" tells the merchant what is happening
 * and roughly how long to expect.
 */
export function LoadingPanel({
  label = "Loading…",
  rows = 3,
  variant = "plain",
  className,
}: {
  readonly label?: string;
  readonly rows?: number;
  readonly variant?: "card" | "plain";
  readonly className?: string;
}) {
  const content = (
    <div
      // The skeleton is decorative; the live region carries the meaning.
      role="status"
      aria-live="polite"
      className={cn("flex flex-col gap-3", className)}
    >
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        {label}
      </span>
      <div aria-hidden="true" className="flex flex-col gap-2">
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton
            key={index}
            className={cn("h-10 w-full", index === 0 && "h-12 w-3/5")}
          />
        ))}
      </div>
    </div>
  );

  return variant === "card" ? <PanelFrame>{content}</PanelFrame> : content;
}

/** Says what an empty result MEANS and what to do next. Never just "No data". */
export function EmptyPanel({
  title,
  description,
  action,
  icon,
  variant = "plain",
  className,
}: {
  readonly title: string;
  readonly description: string;
  readonly action?: React.ReactNode;
  readonly icon?: React.ReactNode;
  readonly variant?: "card" | "plain";
  readonly className?: string;
}) {
  const content = (
    <Empty
      className={cn(
        "rounded-xl border border-dashed border-border bg-surface-sunken",
        className,
      )}
    >
      <EmptyHeader>
        <EmptyMedia variant="default">
          {icon ?? (
            <Inbox aria-hidden="true" className="size-5 text-muted-foreground" />
          )}
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );

  return variant === "card" ? <PanelFrame>{content}</PanelFrame> : content;
}

/**
 * Plain-language failure with a recovery path. Never renders a status code, a
 * class name or a stack trace.
 */
export function ErrorPanel({
  error,
  onRetry,
  variant = "plain",
  className,
}: {
  readonly error: ApiError;
  readonly onRetry?: () => void;
  readonly variant?: "card" | "plain";
  readonly className?: string;
}) {
  // We do not know whether the server received the request. Saying "failed"
  // would be a guess, so an indeterminate failure is named as such.
  const indeterminate = error?.isIndeterminate;
  const message = indeterminate
    ? "We could not confirm whether that went through."
    : error?.userMessage || error?.message || "Something went wrong while loading this.";
  const recovery = error?.recovery || "Please try refreshing the page or try again in a few moments.";

  const content = (
    <Alert variant="destructive" className={cn("items-start", className)}>
      <CircleAlert aria-hidden="true" />
      <AlertTitle>{message}</AlertTitle>
      <AlertDescription className="flex flex-col gap-1">
        <span>{recovery}</span>
        {error?.reference ? (
          <span className="text-xs">
            Quote reference <span className="font-mono">{error.reference}</span>{" "}
            if you contact support.
          </span>
        ) : null}
      </AlertDescription>
      {onRetry ? (
        <AlertAction>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw data-icon="inline-start" />
            Try again
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );

  return variant === "card" ? <PanelFrame>{content}</PanelFrame> : content;
}

/**
 * A capability whose backend is not built yet.
 *
 * This exists because the honest alternative — showing zero, or a plausible
 * chart — would be a lie. DESIGN_SYSTEM.md requires showing missing data
 * explicitly; PRODUCT_SPEC.md forbids unverified facts dressed up as real.
 */
export function CapabilityPanel({
  capability,
  action,
  variant = "plain",
  className,
}: {
  readonly capability: PendingCapability;
  readonly action?: React.ReactNode;
  readonly variant?: "card" | "plain";
  readonly className?: string;
}) {
  const content = (
    <Alert className={cn("items-start border-info-border bg-info-subtle", className)}>
      <Cable aria-hidden="true" className="text-info-foreground" />
      <AlertTitle className="text-info-foreground">{capability.label} is not available yet</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span>{capability.explanation}</span>
        <span className="text-muted-foreground">{capability.alternative}</span>
        <span className="text-xs text-muted-foreground">
          Planned in {capability.phase} · owned by {capability.owner}
        </span>
      </AlertDescription>
      {action ? <AlertAction>{action}</AlertAction> : null}
    </Alert>
  );

  return variant === "card" ? <PanelFrame>{content}</PanelFrame> : content;
}

/** The signed-in merchant lacks the permission. Never phrased as "no data". */
export function ForbiddenPanel({
  message,
  recovery,
  variant = "plain",
  className,
}: {
  readonly message?: string;
  readonly recovery?: string;
  readonly variant?: "card" | "plain";
  readonly className?: string;
}) {
  const content = (
    <Alert className={cn("items-start", className)}>
      <Lock aria-hidden="true" />
      <AlertTitle>{message ?? "You do not have access to this"}</AlertTitle>
      <AlertDescription>
        {recovery ??
          "Your role in this business does not include this. Ask the owner to grant access, or ask them to do this for you."}
      </AlertDescription>
    </Alert>
  );

  return variant === "card" ? <PanelFrame>{content}</PanelFrame> : content;
}

/** Some of the data loaded; some did not. Stated plainly, not glossed over. */
export function PartialDataNotice({
  note,
  className,
}: {
  readonly note: PartialDataNote;
  readonly className?: string;
}) {
  return (
    <Alert className={cn("items-start border-caution-border bg-caution-subtle", className)}>
      <TriangleAlert aria-hidden="true" className="text-caution-foreground" />
      <AlertTitle className="text-caution-foreground">Some information is missing</AlertTitle>
      <AlertDescription>
        {note.missing}
        {note.reason ? ` ${note.reason}` : ""} Treat totals below as incomplete.
      </AlertDescription>
    </Alert>
  );
}

function PanelFrame({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
      {children}
    </div>
  );
}