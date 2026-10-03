// Merchant Brain: money display.
//
// The frontend FORMATS an authoritative amount. It never computes one. A
// missing value renders as an em dash so a gap is visibly a gap rather than a
// confident "₹0.00".

import { cn } from "@/lib/utils";
import { formatMoney, formatMoneyCompact, formatMoneyDelta } from "@/lib/format/money";
import type { Money } from "@/lib/types";

export interface MoneyValueProps {
  readonly value: Money | null | undefined;
  /** Compact form for dense layouts; the exact figure stays available. */
  readonly compact?: boolean;
  /** Renders as an em dash when there is no value, with a spoken explanation. */
  readonly className?: string;
}

export function MoneyValue({ value, compact = false, className }: MoneyValueProps) {
  if (!value) {
    return (
      <span className={cn("text-muted-foreground tabular-nums", className)}>
        —
        <span className="sr-only">No amount available</span>
      </span>
    );
  }

  if (compact) {
    const { compact: short, exact } = formatMoneyCompact(value);
    return (
      <span className={cn("tabular-nums", className)}>
        {/* Screen readers and hover both get the precise figure. */}
        <span aria-hidden="true">{short}</span>
        <span className="sr-only">{exact}</span>
      </span>
    );
  }

  return <span className={cn("tabular-nums", className)}>{formatMoney(value)}</span>;
}

/**
 * A signed change, always with an arrow and always with the word "higher" or
 * "lower" available to assistive technology. Sign alone is ambiguous in a
 * financial table; the direction icon and the accessible text remove the
 * ambiguity.
 */
export function MoneyDelta({
  value,
  className,
  /** `higher_is_better` picks the tone. Money going up is not always good. */
  higherIsBetter = true,
}: {
  readonly value: Money | null | undefined;
  readonly className?: string;
  readonly higherIsBetter?: boolean;
}) {
  const delta = formatMoneyDelta(value);
  if (delta.direction === "flat") {
    return (
      <span className={cn("text-muted-foreground tabular-nums", className)}>
        {delta.text}
        <span className="sr-only">, unchanged</span>
      </span>
    );
  }

  const isGood = delta.direction === "up" ? higherIsBetter : !higherIsBetter;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 tabular-nums",
        isGood ? "text-positive-foreground" : "text-negative-foreground",
        className,
      )}
    >
      <span aria-hidden="true">{delta.direction === "up" ? "▲" : "▼"}</span>
      <span>{delta.text}</span>
      <span className="sr-only">
        {delta.direction === "up" ? " higher than" : " lower than"} the comparison
        period
      </span>
    </span>
  );
}