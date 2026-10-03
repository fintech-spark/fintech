// Merchant Brain: metric card.
//
// A bare number is not information. DESIGN_SYSTEM.md asks for "Revenue ₹X ↓ X%
// vs previous period", not "Revenue ₹X". This component therefore makes a
// metric without context structurally awkward: the label, the figure, the
// direction and the basis are separate slots, and the whole card can be a
// link when there is somewhere to investigate.
//
// A delta is only ever rendered when a real comparison was supplied. It is
// never invented from a single point.

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type MetricTone = "default" | "positive" | "caution" | "negative" | "pending";

const TONE_RULES: Readonly<Record<MetricTone, string>> = {
  default: "text-foreground",
  positive: "text-positive-foreground",
  caution: "text-caution-foreground",
  negative: "text-negative-foreground",
  pending: "text-pending-foreground",
};

export interface MetricDelta {
  /** Already formatted by the caller, e.g. "−12.4%" or "−2.7 pts". */
  readonly text: string;
  readonly direction: "up" | "down" | "flat";
  /** What is being compared, e.g. "vs previous 30 days". */
  readonly basis: string;
  /** Whether an increase is a good outcome for THIS metric. */
  readonly higherIsBetter?: boolean;
}

export interface MetricCardProps {
  /** Merchant-facing label. Not a database column name. */
  readonly label: string;
  /** Pre-formatted authoritative value. Never computed here. */
  readonly value: string;
  /** What the value means, in one line. Required — a number needs a noun. */
  readonly hint: string;
  readonly delta?: MetricDelta;
  readonly tone?: MetricTone;
  /**
   * Small leading glyph, as an ELEMENT (`<Boxes aria-hidden />`). Passing a
   * component type would break if this were ever rendered from a Server
   * Component into a Client one.
   */
  readonly icon?: React.ReactNode;
  readonly href?: string;
  /** Link label. Defaults to "View details". */
  readonly linkLabel?: string;
  readonly footnote?: React.ReactNode;
  readonly className?: string;
}

export function MetricCard({
  label,
  value,
  hint,
  delta,
  tone = "default",
  icon,
  href,
  linkLabel = "View details",
  footnote,
  className,
}: MetricCardProps) {
  const body = (
    <>
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
      </div>
      <p
        data-numeric
        className={cn(
          "text-2xl font-semibold tracking-tight tabular-nums",
          TONE_RULES[tone],
        )}
      >
        {value}
      </p>
      <p className="max-w-prose text-pretty text-sm text-muted-foreground">{hint}</p>
      {delta ? <MetricDeltaRow delta={delta} /> : null}
      {footnote ? (
        <div className="text-xs text-muted-foreground">{footnote}</div>
      ) : null}
      {href ? (
        <p className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-foreground underline-offset-4 group-hover:underline">
          {linkLabel}
          <ArrowRight aria-hidden="true" className="size-4" />
        </p>
      ) : null}
    </>
  );

  const classes = cn(
    "h-full gap-2 transition-colors",
    href && "group hover:bg-muted/40",
    className,
  );

  if (href) {
    // A card that navigates is a link, so middle-click and Cmd-click work.
    return (
      <Card size="sm" className={classes}>
        <Link
          href={href}
          className="flex flex-col gap-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {body}
        </Link>
      </Card>
    );
  }

  return (
    <Card size="sm" className={classes}>
      {body}
    </Card>
  );
}

/**
 * Direction is shown three ways: an arrow, a sign in the text, and words for
 * assistive technology. Colour is the fourth signal, never the first.
 */
function MetricDeltaRow({ delta }: { readonly delta: MetricDelta }) {
  if (delta.direction === "flat") {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span aria-hidden="true">→</span>
        <span>No change</span>
        <span className="text-xs text-muted-foreground">{delta.basis}</span>
      </p>
    );
  }

  const isGood =
    delta.direction === "up" ? (delta.higherIsBetter ?? true) : !(delta.higherIsBetter ?? true);

  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-1.5 text-sm tabular-nums",
        isGood ? "text-positive-foreground" : "text-negative-foreground",
      )}
    >
      <span aria-hidden="true">{delta.direction === "up" ? "▲" : "▼"}</span>
      <span className="font-medium">{delta.text}</span>
      <span className="text-muted-foreground">{delta.basis}</span>
      <span className="sr-only">
        {delta.direction === "up" ? " higher than" : " lower than"} the comparison
        period
      </span>
    </p>
  );
}