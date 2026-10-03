"use client";

// Merchant Brain: filter bar and status tabs.
//
// Filters use merchant words — "Payment status", "Needs review" — never a
// database column name. Every filter is in the URL, so the view is shareable
// and survives a refresh.

import type { LucideIcon } from "lucide-react";
import { Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUrlState } from "./url-state";
import { cn } from "@/lib/utils";

export interface FilterOption {
  readonly value: string;
  readonly label: string;
}

export interface FilterBarProps {
  readonly search?: React.ReactNode;
  readonly selects?: readonly {
    readonly param: string;
    readonly label: string;
    readonly options: readonly FilterOption[];
    readonly allLabel: string;
    readonly icon?: LucideIcon;
  }[];
  /** Shows a "Clear filters" control when anything is active. */
  readonly clearable?: boolean;
  readonly isPending?: boolean;
  readonly className?: string;
}

export function FilterBar({
  search,
  selects = [],
  clearable = true,
  isPending = false,
  className,
}: FilterBarProps) {
  const url = useUrlState();
  // A typed search counts as an active filter. Without this, a merchant who
  // searched for something has no way to clear it from the toolbar — the only
  // route back is the browser's back button.
  const activeParams = [
    ...selects.map((select) => select.param),
    ...(search ? ["search"] : []),
  ].filter((param) => url.get(param) !== null);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between",
        className,
      )}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
        {search ? <div className="sm:col-span-2 lg:w-64">{search}</div> : null}
        {selects.map((select) => (
          <FilterSelect key={select.param} {...select} value={url.get(select.param)} />
        ))}
      </div>

      <div className="flex items-center gap-2">
        {isPending ? (
          <span
            role="status"
            aria-live="polite"
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <Loader2 aria-hidden="true" className="size-3 animate-spin" />
            Updating…
          </span>
        ) : null}
        {clearable && activeParams.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => url.setMany(Object.fromEntries(activeParams.map((p) => [p, null])))}
          >
            <X data-icon="inline-start" />
            Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function FilterSelect({
  param,
  label,
  options,
  allLabel,
  value,
}: {
  readonly param: string;
  readonly label: string;
  readonly options: readonly FilterOption[];
  readonly allLabel: string;
  readonly value: string | null;
}) {
  const url = useUrlState();
  return (
    <div className="flex min-w-40 flex-col gap-1.5">
      <Label
        htmlFor={`filter-${param}`}
        className="text-xs text-muted-foreground"
      >
        {label}
      </Label>
      <Select
        value={value ?? "all"}
        onValueChange={(next) => url.set(param, next === "all" ? null : next)}
      >
        <SelectTrigger id={`filter-${param}`} className="w-full">
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="all">{allLabel}</SelectItem>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

export interface StatusTab {
  readonly value: string;
  readonly label: string;
  /** Optional count badge, e.g. "4". */
  readonly count?: number;
}

/**
 * Tabs double as filters. Counts are authoritative totals from the backend, not
 * guesses; when a count is unavailable the tab simply has none.
 */
export function StatusTabs({
  param,
  tabs,
  allLabel = "All",
  className,
}: {
  readonly param: string;
  readonly tabs: readonly StatusTab[];
  readonly allLabel?: string;
  readonly className?: string;
}) {
  const url = useUrlState();
  const current = url.get(param) ?? "all";

  return (
    <div
      role="tablist"
      aria-label="Filter by status"
      className={cn(
        "flex flex-wrap items-center gap-1 border-b border-border",
        className,
      )}
    >
      <StatusTabButton
        role="tab"
        selected={current === "all"}
        onClick={() => url.set(param, null)}
      >
        {allLabel}
      </StatusTabButton>
      {tabs.map((tab) => (
        <StatusTabButton
          key={tab.value}
          role="tab"
          selected={current === tab.value}
          onClick={() => url.set(param, tab.value)}
        >
          {tab.label}
          {typeof tab.count === "number" ? (
            <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
              {tab.count.toLocaleString("en-IN")}
            </span>
          ) : null}
        </StatusTabButton>
      ))}
    </div>
  );
}

function StatusTabButton({
  selected,
  onClick,
  children,
}: {
  readonly selected: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
  readonly role?: "tab";
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        selected
          ? "border-primary font-medium text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}