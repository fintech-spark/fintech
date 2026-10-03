"use client";

// Merchant Brain: customers table.
//
// The first question on this screen is "who owes me money?", so the table
// leads with what each customer has outstanding, and the receivables tab is
// one click away rather than buried.

import { useCallback } from "react";
import Link from "next/link";
import { Users } from "lucide-react";

import { DataTable, RecordCard, TableFrame, type DataColumn } from "@/components/data/data-table";
import { FilterBar } from "@/components/data/filter-bar";
import { SearchInput } from "@/components/data/search-input";
import { TablePagination } from "@/components/data/table-pagination";
import { useUrlState } from "@/components/data/url-state";
import { EmptyPanel, ErrorPanel } from "@/components/common/data-state";
import { MoneyValue } from "@/components/common/money";
import { StatusBadge } from "@/components/common/status-badge";
import type { Settled } from "@/lib/api/settle";
import type { Page } from "@/lib/api/client";
import type { WireCustomer } from "@/lib/api/contracts";
import { formatDate } from "@/lib/format/dates";
import { formatMoney } from "@/lib/format/money";
import { safeLabel } from "@/lib/format/labels";
import { describeStatus, PARTNER_STATUS } from "@/lib/format/status";
import type { CurrencyCode } from "@/lib/types";

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
] as const;

export function CustomersTable({
  search,
  status,
  result,
}: {
  readonly search?: string;
  readonly status?: string;
  readonly result: Settled<Page<WireCustomer>>;
}) {
  const url = useUrlState();
  const currency: CurrencyCode = "INR";
  const setPage = useCallback((next: number) => url.set("page", String(next)), [url]);

  if (!result.ok) {
    return <ErrorPanel error={result.error} variant="card" />;
  }

  const customers = result.value;
  const filtered = Boolean(search) || Boolean(status);

  const columns: readonly DataColumn<WireCustomer>[] = [
    {
      key: "name",
      header: "Customer",
      cell: (customer) => (
        <Link
          href={`/customers/${encodeURIComponent(customer.id)}`}
          className="truncate font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {safeLabel(customer.name)}
        </Link>
      ),
    },
    {
      key: "outstanding",
      header: "Owes you",
      numeric: true,
      cell: (customer) => {
        const amount = customer.outstandingBalance.amount;
        if (amount === 0) {
          return <span className="text-muted-foreground">Settled</span>;
        }
        return (
          <span className="font-medium">
            <MoneyValue value={{ ...customer.outstandingBalance, currency }} />
          </span>
        );
      },
    },
    {
      key: "totalPurchases",
      header: "Total bought",
      numeric: true,
      hideBelow: "md",
      cell: (customer) => (
        <MoneyValue value={{ ...customer.totalPurchases, currency }} compact />
      ),
    },
    {
      key: "lastOrder",
      header: "Last order",
      hideBelow: "lg",
      cell: (customer) => (
        <span className="text-muted-foreground">
          {formatDate(customer.lastTransactionDate)}
        </span>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      hideBelow: "lg",
      cell: (customer) => (
        <span className="truncate text-muted-foreground">
          {safeLabel(customer.phone ?? customer.email)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (customer) => (
        <StatusBadge
          descriptor={describeStatus(PARTNER_STATUS, customer.status)}
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
            label="Search customers"
            placeholder="Name, phone or email…"
            value={search ?? ""}
            onValueChange={(next) => url.setMany({ search: next || null, page: null })}
          />
        }
        selects={[
          {
            param: "status",
            label: "Customer status",
            allLabel: "All customers",
            options: STATUS_OPTIONS,
          },
        ]}
      />

      {customers.items.length === 0 ? (
        <EmptyPanel
          variant="card"
          icon={<Users aria-hidden={true} className="size-5 text-muted-foreground" />}
          title={filtered ? "No customers match" : "No customers yet"}
          description={
            filtered
              ? "Nothing matches this search and filter. Try a shorter search term, or clear the filters."
              : "When your sales records name a customer, they appear here along with what they owe you."
          }
        />
      ) : (
        <TableFrame>
          <DataTable
            caption="Customers"
            captionDescription="What each customer has bought and what they still owe."
            columns={columns}
            rows={customers.items}
            rowKey={(customer) => customer.id}
            renderMobileCard={(customer) => (
              <RecordCard
                href={`/customers/${encodeURIComponent(customer.id)}`}
                title={safeLabel(customer.name)}
                subtitle={
                  customer.lastTransactionDate
                    ? `Last order ${formatDate(customer.lastTransactionDate)}`
                    : "No orders recorded yet"
                }
                trailing={
                  customer.outstandingBalance.amount === 0
                    ? "Settled"
                    : formatMoney({ ...customer.outstandingBalance, currency })
                }
                status={
                  <StatusBadge
                    descriptor={describeStatus(PARTNER_STATUS, customer.status)}
                    showIcon={false}
                    size="sm"
                  />
                }
              />
            )}
            footer={
              <TablePagination
                page={customers}
                itemName="customer"
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