"use client";

// Merchant Brain: payables ledger — money the merchant owes.
//
// The mirror of receivables, and deliberately structured the same way so the
// two books read as one product.

import { useCallback } from "react";
import { FileText } from "lucide-react";

import { DataTable, RecordCard, TableFrame, type DataColumn } from "@/components/data/data-table";
import { StatusTabs } from "@/components/data/filter-bar";
import { TablePagination } from "@/components/data/table-pagination";
import { useUrlState } from "@/components/data/url-state";
import { EmptyPanel, ErrorPanel } from "@/components/common/data-state";
import { MoneyValue } from "@/components/common/money";
import { StatusBadge } from "@/components/common/status-badge";
import type { Page } from "@/lib/api/client";
import type { WirePayable } from "@/lib/api/contracts";
import type { Settled } from "@/lib/api/settle";
import { daysUntil, formatDate } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import { describeStatus, PAYABLE_STATUS } from "@/lib/format/status";
import type { CurrencyCode } from "@/lib/types";

const STATUS_TABS = [
  { value: "pending", label: "Not due yet" },
  { value: "partial", label: "Part paid" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
] as const;

export function PayablesTable({
  result,
  currency,
  supplierNames,
}: {
  readonly result: Settled<Page<WirePayable>>;
  readonly currency: CurrencyCode;
  readonly supplierNames?: ReadonlyMap<string, string>;
}) {
  const url = useUrlState();
  const setPage = useCallback((next: number) => url.set("page", String(next)), [url]);

  if (!result.ok) {
    return <ErrorPanel error={result.error} variant="card" />;
  }

  const payables = result.value;
  const now = new Date();

  const columns: readonly DataColumn<WirePayable>[] = [
    {
      key: "due",
      header: "Due",
      cell: (payable) => {
        const days = daysUntil(payable.dueDate, now);
        return (
          <span className="flex flex-col gap-0.5">
            <span className="tabular-nums">{formatDate(payable.dueDate)}</span>
            <DaysLeft days={days} status={payable.status} />
          </span>
        );
      },
    },
    {
      key: "amount",
      header: "Amount",
      numeric: true,
      cell: (payable) => (
        <span className="font-medium">
          <MoneyValue value={{ ...payable.amount, currency }} />
        </span>
      ),
    },
    {
      key: "paid",
      header: "Paid",
      numeric: true,
      hideBelow: "md",
      cell: (payable) => (
        <MoneyValue value={{ ...payable.paidAmount, currency }} compact />
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (payable) => (
        <StatusBadge
          descriptor={describeStatus(PAYABLE_STATUS, payable.status)}
          showIcon={false}
          size="sm"
        />
      ),
    },
    {
      key: "reference",
      header: "Reference",
      hideBelow: "lg",
      cell: (payable) => (
        <span className="font-mono text-xs text-muted-foreground">
          {payable.transactionId.slice(0, 8)}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <StatusTabs param="status" tabs={STATUS_TABS} allLabel="All balances" />

      {payables.items.length === 0 ? (
        <EmptyPanel
          variant="card"
          icon={<FileText aria-hidden={true} className="size-5 text-muted-foreground" />}
          title="No balances match"
          description="Nothing on this tab matches. Try another status, or clear the filter to see everything."
        />
      ) : (
        <TableFrame>
          <DataTable
            caption="Money you owe"
            captionDescription="Each unpaid bill, when it was due, how much has been paid and its current status."
            columns={columns}
            rows={payables.items}
            rowKey={(payable) => payable.id}
            renderMobileCard={(payable) => {
              const days = daysUntil(payable.dueDate, now);
              return (
                <RecordCard
                  title={`Due ${formatDate(payable.dueDate)}`}
                  subtitle={supplierNames?.get(payable.supplierId) ?? "Supplier"}
                  trailing={formatMoney({ ...payable.amount, currency })}
                  status={
                    <>
                      <StatusBadge
                        descriptor={describeStatus(PAYABLE_STATUS, payable.status)}
                        showIcon={false}
                        size="sm"
                      />
                      <DaysLeft days={days} status={payable.status} />
                    </>
                  }
                  detail={
                    <span>
                      Paid so far {formatMoney({ ...payable.paidAmount, currency })}
                    </span>
                  }
                />
              );
            }}
            footer={
              <TablePagination
                page={payables}
                itemName="bill"
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

function DaysLeft({
  days,
  status,
}: {
  readonly days: number | null;
  readonly status: WirePayable["status"];
}) {
  if (days === null || status === "paid") return null;
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