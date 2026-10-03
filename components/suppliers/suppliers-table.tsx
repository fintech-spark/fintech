"use client";

// Merchant Brain: suppliers table.
//
// Leads with what the merchant owes, because that is the operational question
// on this screen. Cost-change detection is a profit-leak capability and is
// deliberately not implied here — a single current price is not a change.

import { useCallback } from "react";
import Link from "next/link";
import { Truck } from "lucide-react";

import { DataTable, RecordCard, TableFrame, type DataColumn } from "@/components/data/data-table";
import { FilterBar } from "@/components/data/filter-bar";
import { SearchInput } from "@/components/data/search-input";
import { TablePagination } from "@/components/data/table-pagination";
import { useUrlState } from "@/components/data/url-state";
import { EmptyPanel, ErrorPanel } from "@/components/common/data-state";
import { MoneyValue } from "@/components/common/money";
import { StatusBadge } from "@/components/common/status-badge";
import type { Page } from "@/lib/api/client";
import type { WireSupplier } from "@/lib/api/contracts";
import type { Settled } from "@/lib/api/settle";
import { formatDate } from "@/lib/format/dates";
import { safeLabel } from "@/lib/format/labels";
import { describeStatus, PARTNER_STATUS } from "@/lib/format/status";
import type { CurrencyCode } from "@/lib/types";

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
] as const;

export function SuppliersTable({
  search,
  status,
  result,
}: {
  readonly search?: string;
  readonly status?: string;
  readonly result: Settled<Page<WireSupplier>>;
}) {
  const url = useUrlState();
  const currency: CurrencyCode = "INR";
  const setPage = useCallback((next: number) => url.set("page", String(next)), [url]);

  if (!result.ok) {
    return <ErrorPanel error={result.error} variant="card" />;
  }

  const suppliers = result.value;
  const filtered = Boolean(search) || Boolean(status);

  const columns: readonly DataColumn<WireSupplier>[] = [
    {
      key: "name",
      header: "Supplier",
      cell: (supplier) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <Link
            href={`/suppliers/${encodeURIComponent(supplier.id)}`}
            className="truncate font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {safeLabel(supplier.name)}
          </Link>
          {supplier.contactName ? (
            <span className="truncate text-xs text-muted-foreground">
              {safeLabel(supplier.contactName)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "outstanding",
      header: "You owe",
      numeric: true,
      cell: (supplier) => {
        if (supplier.outstandingPayable.amount === 0) {
          return <span className="text-muted-foreground">Settled</span>;
        }
        return (
          <span className="font-medium">
            <MoneyValue value={{ ...supplier.outstandingPayable, currency }} />
          </span>
        );
      },
    },
    {
      key: "totalPurchases",
      header: "Total bought",
      numeric: true,
      hideBelow: "md",
      cell: (supplier) => (
        <MoneyValue value={{ ...supplier.totalPurchases, currency }} compact />
      ),
    },
    {
      key: "lastOrder",
      header: "Last purchase",
      hideBelow: "lg",
      cell: (supplier) => (
        <span className="text-muted-foreground">
          {formatDate(supplier.lastTransactionDate)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (supplier) => (
        <StatusBadge
          descriptor={describeStatus(PARTNER_STATUS, supplier.status)}
          showIcon={false}
          size="sm"
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        isPending={url.isPending}
        search={
          <SearchInput
            label="Search suppliers"
            placeholder="Name or contact…"
            value={search ?? ""}
            onValueChange={(next) => url.setMany({ search: next || null, page: null })}
          />
        }
        selects={[
          {
            param: "status",
            label: "Supplier status",
            allLabel: "All suppliers",
            options: STATUS_OPTIONS,
          },
        ]}
      />

      {suppliers.items.length === 0 ? (
        <EmptyPanel
          variant="card"
          icon={<Truck aria-hidden={true} className="size-5 text-muted-foreground" />}
          title={filtered ? "No suppliers match" : "No suppliers yet"}
          description={
            filtered
              ? "Nothing matches this search and filter. Try a shorter search term, or clear the filters."
              : "When your purchase records name a supplier, they appear here along with what you owe them."
          }
        />
      ) : (
        <TableFrame>
          <DataTable
            caption="Suppliers"
            captionDescription="What the merchant buys from each supplier and what is still owed."
            columns={columns}
            rows={suppliers.items}
            rowKey={(supplier) => supplier.id}
            renderMobileCard={(supplier) => (
              <RecordCard
                href={`/suppliers/${encodeURIComponent(supplier.id)}`}
                title={safeLabel(supplier.name)}
                subtitle={
                  supplier.lastTransactionDate
                    ? `Last purchase ${formatDate(supplier.lastTransactionDate)}`
                    : "No purchases recorded yet"
                }
                trailing={
                  supplier.outstandingPayable.amount === 0
                    ? "Settled"
                    : undefined
                }
                status={
                  <>
                    <StatusBadge
                      descriptor={describeStatus(PARTNER_STATUS, supplier.status)}
                      showIcon={false}
                      size="sm"
                    />
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {supplier.outstandingPayable.amount === 0
                        ? "Nothing owed"
                        : `You owe ${new Intl.NumberFormat("en-IN", {
                            style: "currency",
                            currency,
                            minimumFractionDigits: 2,
                          }).format(supplier.outstandingPayable.amount / 100)}`}
                    </span>
                  </>
                }
              />
            )}
            footer={
              <TablePagination
                page={suppliers}
                itemName="supplier"
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