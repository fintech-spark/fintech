// Merchant Brain: data freshness.
//
// A Server Component on purpose. "Updated 4 minutes ago" computed from
// `Date.now()` on both the server and the client is a guaranteed hydration
// mismatch; rendered only on the server it cannot mismatch at all.
//
// Deliberately no ticking timer. A clock that updates every second does not
// build trust, it builds anxiety — and the merchant has a refresh control.

import { RefreshCw } from "lucide-react";

import { formatRelativeTime } from "@/lib/format/dates";
import { cn } from "@/lib/utils";

export function FreshnessLine({
  updatedAt,
  prefix = "Updated",
  className,
}: {
  readonly updatedAt: string | Date | null | undefined;
  readonly prefix?: string;
  readonly className?: string;
}) {
  if (!updatedAt) {
    return (
      <p
        className={cn(
          "flex items-center gap-1.5 text-xs text-muted-foreground",
          className,
        )}
      >
        <RefreshCw aria-hidden="true" className="size-3" />
        Not loaded yet
      </p>
    );
  }

  const iso = updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt;
  // `now` is the server clock, read once per render.
  const relative = formatRelativeTime(updatedAt, new Date());

  return (
    <p
      className={cn(
        "flex items-center gap-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <RefreshCw aria-hidden="true" className="size-3" />
      <span>
        {prefix}{" "}
        <time dateTime={iso} title={iso}>
          {relative}
        </time>
      </span>
    </p>
  );
}

/**
 * The reporting window, always visible. DESIGN_SYSTEM.md: never change a
 * reporting period silently — show which one is active wherever figures appear.
 */
export function PeriodLabel({
  label,
  description,
  className,
}: {
  readonly label: string;
  readonly description?: string;
  readonly className?: string;
}) {
  return (
    <p className={cn("flex items-baseline gap-1.5 text-sm", className)}>
      <span className="text-muted-foreground">Period</span>
      <span className="font-medium" title={description}>
        {label}
      </span>
    </p>
  );
}