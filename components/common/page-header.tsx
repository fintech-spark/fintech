"use client";

// Merchant Brain: page header.
//
// One header component for every screen so hierarchy is never reinvented:
// business context and period first, then what the page is, then the one
// action that matters, then anything secondary.
//
// Visual hierarchy, not decoration: the page title is the largest text on the
// screen, the description is capped at a readable measure, and secondary
// actions are visually quieter than the primary one.

import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  /** Short eyebrow: the business and the reporting window. */
  readonly context?: string;
  readonly title: string;
  readonly description?: string;
  /** The single most important thing to do on this page. */
  readonly primaryAction?: React.ReactNode;
  /** Anything else. Rendered quieter than the primary action. */
  readonly secondaryActions?: React.ReactNode;
  /** Period selector, freshness, filters — sits under the title on desktop. */
  readonly toolbar?: React.ReactNode;
  readonly backHref?: string;
  readonly backLabel?: string;
  readonly className?: string;
}

export function PageHeader({
  context,
  title,
  description,
  primaryAction,
  secondaryActions,
  toolbar,
  backHref,
  backLabel = "Back",
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-4", className)}>
      {backHref ? (
        <Link
          href={backHref}
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          {backLabel}
        </Link>
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          {context ? (
            <p className="text-sm font-medium text-muted-foreground">{context}</p>
          ) : null}
          <h1 className="text-balance text-2xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {description ? (
            <p className="max-w-prose text-pretty text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>

        {primaryAction || secondaryActions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {secondaryActions}
            {primaryAction}
          </div>
        ) : null}
      </div>

      {toolbar ? (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          {toolbar}
        </div>
      ) : null}
    </header>
  );
}

/** A titled region inside a page. H2, so the heading outline stays correct. */
export function SectionHeader({
  title,
  description,
  action,
  className,
  id,
}: {
  readonly title: string;
  readonly description?: string;
  readonly action?: React.ReactNode;
  readonly className?: string;
  readonly id?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id={id} className="scroll-mt-20 text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {description ? (
          <p className="max-w-prose text-pretty text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}