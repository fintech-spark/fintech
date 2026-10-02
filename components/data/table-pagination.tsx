"use client";

// Merchant Brain: table pagination.
//
// Server-side, always. A merchant's transaction table can be large and the
// browser must not hold it all. Page size is a URL parameter, capped at the
// backend's own limit of 100, and the control states exactly which slice is on
// screen so the merchant can tell they are not looking at everything.

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Page } from "@/lib/api/client";
import { cn } from "@/lib/utils";

const PAGE_SIZES = [10, 25, 50, 100] as const;

export interface TablePaginationProps {
  readonly page: Page<unknown>;
  readonly onPageChange: (page: number) => void;
  readonly onLimitChange?: (limit: number) => void;
  /** Singular noun for the count, e.g. "product". */
  readonly itemName: string;
  readonly className?: string;
}

export function TablePagination({
  page,
  onPageChange,
  onLimitChange,
  itemName,
  className,
}: TablePaginationProps) {
  const first = page.total === 0 ? 0 : (page.page - 1) * page.limit + 1;
  const last = Math.min(page.page * page.limit, page.total);
  const totalPages = Math.max(1, Math.ceil(page.total / page.limit));

  return (
    <nav
      aria-label={`${itemName} pagination`}
      className={cn(
        "flex flex-col gap-3 border-t border-border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <p aria-live="polite" className="text-muted-foreground">
        {page.total === 0 ? (
          <>No {itemName}s to show</>
        ) : (
          <>
            Showing <span className="font-medium text-foreground tabular-nums">{first}</span>
            {"–"}
            <span className="font-medium text-foreground tabular-nums">{last}</span> of{" "}
            <span className="font-medium text-foreground tabular-nums">
              {page.total.toLocaleString("en-IN")}
            </span>{" "}
            {itemName}
            {page.total === 1 ? "" : "s"}
          </>
        )}
      </p>

      <div className="flex items-center justify-between gap-3 sm:justify-end">
        {onLimitChange ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Rows</span>
            <select
              value={page.limit}
              onChange={(event) => onLimitChange(Number(event.target.value))}
              className="h-8 rounded-lg border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous page"
            disabled={page.page <= 1}
            onClick={() => onPageChange(page.page - 1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span className="px-2 text-xs text-muted-foreground tabular-nums">
            Page {page.page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next page"
            disabled={!page.hasMore}
            onClick={() => onPageChange(page.page + 1)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>
    </nav>
  );
}