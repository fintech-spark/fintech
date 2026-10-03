"use client";

// Merchant Brain: status badge.
//
// A status is NEVER communicated by colour alone. The label is always
// rendered, the meaning is exposed to assistive technology through
// `aria-label`, and an optional icon reinforces it — so the badge still works
// in greyscale, in bright sun on a phone, and for a colour-blind merchant.

import type { LucideIcon } from "lucide-react";
import { CircleAlert, CircleCheck, CircleDot, Clock, Info, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toneSurfaceClasses, type StatusDescriptor } from "@/lib/format/status";

/** Default icon per tone, so meaning survives without colour. */
const TONE_ICON: Readonly<Record<StatusDescriptor["tone"], LucideIcon>> = {
  positive: CircleCheck,
  caution: TriangleAlert,
  negative: CircleAlert,
  pending: Clock,
  info: Info,
  neutral: CircleDot,
};

export interface StatusBadgeProps {
  readonly descriptor: StatusDescriptor;
  /** Hides the icon for dense tables where the row already has context. */
  readonly showIcon?: boolean;
  readonly size?: "sm" | "default";
  readonly className?: string;
}

export function StatusBadge({
  descriptor,
  showIcon = true,
  size = "default",
  className,
}: StatusBadgeProps) {
  const Icon = TONE_ICON[descriptor.tone];
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 rounded-full font-medium",
        toneSurfaceClasses(descriptor.tone),
        size === "sm" && "px-1.5 py-0 text-xs",
        className,
      )}
    >
      {showIcon ? <Icon aria-hidden="true" data-icon="inline-start" /> : null}
      <span>{descriptor.label}</span>
      {/* The plain-language meaning is available on demand, not only on hover. */}
      <span className="sr-only">. {descriptor.description}</span>
    </Badge>
  );
}

/**
 * A short, quiet status marker for dense rows: an icon plus the label, with no
 * tinted background competing with the row's numbers.
 */
export function StatusDot({
  descriptor,
  className,
}: {
  readonly descriptor: StatusDescriptor;
  readonly className?: string;
}) {
  const Icon = TONE_ICON[descriptor.tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", className)}>
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span>{descriptor.label}</span>
    </span>
  );
}