"use client";

// Merchant Brain: responsive data table.
//
// One component, three honest behaviours, because "responsive" for a merchant
// table is not "the same table, narrower":
//
//   ≥ lg   the full table
//   ≥ sm   secondary columns dropped, table scrolls horizontally if needed
//   < sm   the same rows as stacked record cards
//
// The mobile cards are built from the SAME row objects and the SAME cells, so a
// merchant can never see one figure on a phone and a different one on a
// desktop. Nothing is re-derived here.

import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface DataColumn<T> {
  readonly key: string;
  readonly header: string;
  readonly cell: (row: T) => React.ReactNode;
  /** Dropped below this breakpoint to protect readability. */
  readonly hideBelow?: "sm" | "md" | "lg";
  readonly align?: "left" | "right";
  /** Right-aligned figures get tabular numerals. */
  readonly numeric?: boolean;
  /** Visually hidden header, for icon-only cells. */
  readonly srOnlyHeader?: boolean;
}

const HIDE_BELOW_CLASS: Readonly<Record<NonNullable<DataColumn<unknown>["hideBelow"]>, string>> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

export interface DataTableProps<T> {
  readonly caption: string;
  /** Describes the table for assistive technology. */
  readonly captionDescription?: string;
  readonly columns: readonly DataColumn<T>[];
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  /** Rendered instead of the table on small screens. */
  readonly renderMobileCard?: (row: T) => React.ReactNode;
  readonly footer?: React.ReactNode;
  readonly className?: string;
}

export function DataTable<T>({
  caption,
  captionDescription,
  columns,
  rows,
  rowKey,
  renderMobileCard,
  footer,
  className,
}: DataTableProps<T>) {
  return (
    <div className={cn("flex flex-col", className)}>
      {/* Phone: record cards. Same data, one fact per line. */}
      {renderMobileCard ? (
        <ul className="flex flex-col divide-y divide-border sm:hidden">
          {rows.map((row) => (
            <li key={rowKey(row)} className="p-3">
              {renderMobileCard(row)}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Tablet and up: a real table, horizontally scrollable when needed. */}
      <div
        className={cn(
          "overflow-x-auto overscroll-contain",
          renderMobileCard && "hidden sm:block",
        )}
      >
        <Table>
          <TableCaption className="sr-only">
            {caption}
            {captionDescription ? `. ${captionDescription}` : ""}
          </TableCaption>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead
                  key={column.key}
                  scope="col"
                  className={cn(
                    column.numeric && "text-right",
                    column.srOnlyHeader && "sr-only",
                    column.hideBelow && HIDE_BELOW_CLASS[column.hideBelow],
                  )}
                  aria-label={column.srOnlyHeader ? column.header : undefined}
                >
                  {column.srOnlyHeader ? column.header : column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={rowKey(row)}>
                {columns.map((column) => (
                  <TableCell
                    key={column.key}
                    className={cn(
                      column.numeric && "text-right tabular-nums",
                      column.hideBelow && HIDE_BELOW_CLASS[column.hideBelow],
                    )}
                  >
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {footer ? <div className="border-t border-border">{footer}</div> : null}
    </div>
  );
}

/**
 * The standard shape of a mobile record card: a title, a line of context, and
 * the figure that matters most on the right.
 */
export function RecordCard({
  title,
  subtitle,
  trailing,
  status,
  detail,
  href,
  children,
}: {
  readonly title: React.ReactNode;
  readonly subtitle?: React.ReactNode;
  readonly trailing?: React.ReactNode;
  readonly status?: React.ReactNode;
  readonly detail?: React.ReactNode;
  readonly href?: string;
  readonly children?: React.ReactNode;
}) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          {/* min-w-0 + truncate so a long customer name cannot push the
              figure off a 390px screen. */}
          <p className="min-w-0 truncate text-sm font-medium">{title}</p>
          {subtitle ? (
            <p className="min-w-0 truncate text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {trailing ? (
          <p className="shrink-0 text-right text-sm font-medium tabular-nums">
            {trailing}
          </p>
        ) : null}
      </div>
      {status ? <div className="mt-2 flex flex-wrap items-center gap-2">{status}</div> : null}
      {detail ? (
        <div className="mt-2 flex flex-col gap-0.5 text-xs text-muted-foreground">
          {detail}
        </div>
      ) : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </>
  );

  if (!href) {
    return (
      <Card size="sm" className="gap-2">
        {inner}
      </Card>
    );
  }

  return (
    <Card size="sm" className="gap-2">
      {/* A card that navigates is a link, so middle-click works. */}
      <a
        href={href}
        className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {inner}
      </a>
    </Card>
  );
}

/** Wraps a table in a card with the right border and clipping. */
export function TableFrame({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <Card className={cn("gap-0 overflow-hidden py-0", className)}>{children}</Card>
  );
}