"use client";

// Merchant Brain: product table.
//
// Server-paginated, server-filtered, server-searched. The browser never holds
// more than one page, because a merchant's catalogue can be thousands of rows
// and an unbounded table is a performance and usability failure.
//
// The mobile view is a record card built from the same rows and the same
// formatted values, so a figure cannot differ between phone and desktop.

import { useCallback } from "react";
import Link from "next/link";
import { PackageSearch } from "lucide-react";

import { DataTable, RecordCard, TableFrame, type DataColumn } from "@/components/data/data-table";
import { TablePagination } from "@/components/data/table-pagination";
import { FilterBar } from "@/components/data/filter-bar";
import { SearchInput } from "@/components/data/search-input";
import { useUrlState } from "@/components/data/url-state";
import { ErrorPanel, EmptyPanel } from "@/components/common/data-state";
import { MoneyValue } from "@/components/common/money";
import { StatusBadge } from "@/components/common/status-badge";
import { Badge } from "@/components/ui/badge";
import type { Settled } from "@/lib/api/settle";
import type { Page } from "@/lib/api/client";
import type { WireProduct } from "@/lib/api/contracts";
import { formatQuantity } from "@/lib/format/money";
import { safeLabel } from "@/lib/format/labels";
import {
  describeStatus,
  PRODUCT_STATUS,
  STOCK_LEVEL,
  stockLevel,
} from "@/lib/format/status";
import type { CurrencyCode } from "@/lib/types";

const PRODUCT_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "out_of_stock", label: "Out of stock" },
  { value: "discontinued", label: "Discontinued" },
] as const;

export function InventoryTable({
  search,
  status,
  lowOnly,
  result,
  backendFlaggedLowStockIds,
}: {
  readonly search?: string;
  readonly status?: string;
  readonly lowOnly: boolean;
  readonly result: Settled<Page<WireProduct>>;
  /**
   * Ids from `GET /api/inventory/low-stock`. Passed in rather than refetched so
   * a product cannot be labelled "Reorder now" in one panel and "Running low"
   * in the table on the same screen.
   */
  readonly backendFlaggedLowStockIds: ReadonlySet<string>;
}) {
  const url = useUrlState();
  const currency: CurrencyCode = "INR";

  const setPage = useCallback((next: number) => url.set("page", String(next)), [url]);

  if (!result.ok) {
    return <ErrorPanel error={result.error} variant="card" />;
  }

  const products = result.value;
  const flaggedLow = backendFlaggedLowStockIds;

  const columns: readonly DataColumn<WireProduct>[] = [
    {
      key: "name",
      header: "Product",
      cell: (product) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <Link
            href={`/inventory/${encodeURIComponent(product.id)}`}
            className="truncate font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {safeLabel(product.name)}
          </Link>
          {product.sku ? (
            <span className="truncate text-xs text-muted-foreground">
              SKU {safeLabel(product.sku, "")}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "category",
      header: "Category",
      hideBelow: "lg",
      cell: (product) => (
        <span className="text-muted-foreground">{safeLabel(product.category)}</span>
      ),
    },
    {
      key: "stock",
      header: "In stock",
      numeric: true,
      cell: (product) => (
        <span className="font-medium">{formatQuantity(product.currentStock)}</span>
      ),
    },
    {
      key: "reorderPoint",
      header: "Reorder at",
      numeric: true,
      hideBelow: "md",
      cell: (product) => (
        <span className="text-muted-foreground">
          {formatQuantity(product.reorderPoint)}
        </span>
      ),
    },
    {
      key: "cost",
      header: "Cost",
      numeric: true,
      hideBelow: "md",
      cell: (product) => (
        <MoneyValue value={{ ...product.costPrice, currency }} compact />
      ),
    },
    {
      key: "selling",
      header: "Selling price",
      numeric: true,
      hideBelow: "lg",
      cell: (product) => (
        <MoneyValue value={{ ...product.sellingPrice, currency }} compact />
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (product) => {
        // `reorder` is only applied when the backend's own low-stock list
        // contains the row; the `low` bucket is a label, not a new rule.
        const level = stockLevel(product, {
          backendFlaggedLowStock: flaggedLow.has(product.id),
        });
        return (
          <StatusBadge descriptor={describeStatus(STOCK_LEVEL, level)} showIcon={false} size="sm" />
        );
      },
    },
    {
      key: "productStatus",
      header: "Trading",
      hideBelow: "lg",
      cell: (product) => (
        <Badge variant="outline" className="font-normal">
          {describeStatus(PRODUCT_STATUS, product.status).label}
        </Badge>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        isPending={url.isPending}
        search={
          <SearchInput
            label="Search products"
            placeholder="Name or SKU…"
            value={search ?? ""}
            onValueChange={(next) => url.setMany({ search: next || null, page: null })}
          />
        }
        selects={[
          {
            param: "status",
            label: "Trading status",
            allLabel: "All products",
            options: PRODUCT_STATUS_OPTIONS,
          },
          {
            param: "filter",
            label: "Stock",
            allLabel: "Any stock level",
            options: [{ value: "low", label: "Needs reordering" }],
          },
        ]}
      />

      {lowOnly ? (
        <p className="text-sm text-muted-foreground">
          Showing the products your inventory rules flagged for reordering.{" "}
          <Link
            href="/inventory"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Show all products
          </Link>
        </p>
      ) : null}

      {products.items.length === 0 ? (
        <EmptyPanel
          variant="card"
          icon={<PackageSearch aria-hidden={true} className="size-5 text-muted-foreground" />}
          title={hasActiveFilters({ search, status, lowOnly }) ? "No products match those filters" : "No products yet"}
          description={
            hasActiveFilters({ search, status, lowOnly })
              ? "Nothing matches this search and filter combination. Try a shorter search term, or clear the filters."
              : "Once your products are in Merchant Brain, they appear here with their stock level, cost and selling price."
          }
        />
      ) : (
        <TableFrame>
          <DataTable
            caption="Products in stock"
            captionDescription="Stock level, cost, selling price and trading status for each product."
            columns={columns}
            rows={products.items}
            rowKey={(product: WireProduct) => product.id}
            renderMobileCard={(product) => {
              const level = stockLevel(product, {
                backendFlaggedLowStock: flaggedLow.has(product.id),
              });
              return (
                <RecordCard
                  href={`/inventory/${encodeURIComponent(product.id)}`}
                  title={safeLabel(product.name)}
                  subtitle={
                    product.sku ? `SKU ${safeLabel(product.sku, "")}` : safeLabel(product.category)
                  }
                  trailing={`${formatQuantity(product.currentStock)} in stock`}
                  status={
                    <>
                      <StatusBadge
                        descriptor={describeStatus(STOCK_LEVEL, level)}
                        showIcon={false}
                        size="sm"
                      />
                      <span className="text-xs text-muted-foreground">
                        Costs{" "}
                        <MoneyValue
                          value={{ ...product.costPrice, currency }}
                          compact
                        />
                      </span>
                    </>
                  }
                />
              );
            }}
            footer={
              <TablePagination
                page={products}
                itemName="product"
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

function hasActiveFilters(input: {
  readonly search?: string;
  readonly status?: string;
  readonly lowOnly: boolean;
}): boolean {
  return Boolean(input.search) || Boolean(input.status) || input.lowOnly;
}
