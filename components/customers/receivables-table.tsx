"use client";

// Merchant Brain: receivables ledger.
//
// "Who owes me money?" — sorted by how late, because a merchant's priority is
// not alphabetical. Days late is computed from the backend's `dueDate`; it is a
// calendar difference between two authoritative dates, not a business rule.

import { useCallback } from "react";
import { Receipt } from "lucide-react";

import { DataTable, RecordCard, TableFrame, type DataColumn } from "@/components/data/data-table";
import { StatusTabs } from "@/components/data/filter-bar";
import { TablePagination } from "@/components/data/table-pagination";
import { useUrlState } from "@/components/data/url-state";
import { EmptyPanel, ErrorPanel } from "@/components/common/data-state";
import { MoneyValue } from "@/components/common/money";
import { StatusBadge } from "@/components/common/status-badge";
import type { Page } from "@/lib/api/client";
import type { WireReceivable } from "@/lib/api/contracts";
import type { Settled } from "@/lib/api/settle";
import { daysUntil, formatDate } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import { describeStatus, RECEIVABLE_STATUS } from "@/lib/format/status";
import type { CurrencyCode } from "@/lib/types";

const STATUS_TABS = [
  { value: "pending", label: "Not due yet" },
  { value: "partial", label: "Part paid" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
  { value: "written_off", label: "Written off" },
] as const;

export function ReceivablesTable({
  result,
  currency,
  customerNames,
}: {
  readonly result: Settled<Page<WireReceivable>>;
  readonly currency: CurrencyCode;
  /** Optional name lookup so the ledger is readable, not a wall of ids. */
  readonly customerNames?: ReadonlyMap<string, string>;
}) {
  const url = useUrlState();
  const setPage = useCallback((next: number) => url.set("page", String(next)), [url]);

  if (!result.ok) {
    return <ErrorPanel error={result.error} variant="card" />;
  }

  const receivables = result.value;
  const now = new Date();

  const columns: readonly DataColumn<WireReceivable>[] = [
    {
      key: "due",
      header: "Due",
      cell: (receivable) => {
        const days = daysUntil(receivable.dueDate, now);
        return (
          <span className="flex flex-col gap-0.5">
            <span className="tabular-nums">{formatDate(receivable.dueDate)}</span>
            <DaysLate days={days} status={receivable.status} />
          </span>
        );
      },
    },
    {
      key: "amount",
      header: "Amount",
      numeric: true,
      cell: (receivable) => (
        <span className="font-medium">
          <MoneyValue value={{ ...receivable.amount, currency }} />
        </span>
      ),
    },
    {
      key: "paid",
      header: "Received",
      numeric: true,
      hideBelow: "md",
      cell: (receivable) => (
        <MoneyValue value={{ ...receivable.paidAmount, currency }} compact />
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (receivable) => (
        <StatusBadge
          descriptor={describeStatus(RECEIVABLE_STATUS, receivable.status)}
          showIcon={false}
          size="sm"
        />
      ),
    },
    {
      key: "reference",
      header: "Reference",
      hideBelow: "lg",
      cell: (receivable) => (
        <span className="font-mono text-xs text-muted-foreground">
          {receivable.transactionId.slice(0, 8)}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <StatusTabs param="status" tabs={STATUS_TABS} allLabel="All balances" />

      {receivables.items.length === 0 ? (
        <EmptyPanel
          variant="card"
          icon={<Receipt aria-hidden={true} className="size-5 text-muted-foreground" />}
          title="No balances match"
          description="Nothing on this tab matches. Try another status, or clear the filter to see everything."
        />
      ) : (
        <TableFrame>
          <DataTable
            caption="Money owed to you"
            captionDescription="Each unpaid balance, when it was due, how much was received and its current status."
            columns={columns}
            rows={receivables.items}
            rowKey={(receivable) => receivable.id}
            renderMobileCard={(receivable) => {
              const days = daysUntil(receivable.dueDate, now);
              return (
                <RecordCard
                  title={`Due ${formatDate(receivable.dueDate)}`}
                  subtitle={customerNames?.get(receivable.customerId) ?? "Customer"}
                  trailing={formatMoney({ ...receivable.amount, currency })}
                  status={
                    <>
                      <StatusBadge
                        descriptor={describeStatus(RECEIVABLE_STATUS, receivable.status)}
                        showIcon={false}
                        size="sm"
                      />
                      <DaysLate days={days} status={receivable.status} />
                    </>
                  }
                  detail={
                    <span>
                      Received so far{" "}
                      {formatMoney({ ...receivable.paidAmount, currency })}
                    </span>
                  }
                />
              );
            }}
            footer={
              <TablePagination
                page={receivables}
                itemName="balance"
                onPageChange={setPage}
                onLimitChange={(next) => url.setMany({ limit: String(next), page: null })}
              />
            }
          />
        </TableFrame>
      )}
    </div>
  );
}

/**
 * Days late, in words. Never colour-only, and never shown for a balance that
 * is not actually late.
 */
function DaysLate({
  days,
  status,
}: {
  readonly days: number | null;
  readonly status: WireReceivable["status"];
}) {
  if (days === null) return null;
  if (status === "paid" || status === "written_off") return null;
  if (days > 0) {
    return (
      <span className="text-xs text-muted-foreground">
        Due in {days} day{days === 1 ? "" : "s"}
      </span>
    );
  }
  const late = Math.abs(days);
  return (
    <span className="text-xs font-medium text-negative-foreground">
      {late} day{late === 1 ? "" : "s"} late
    </span>
  );
}