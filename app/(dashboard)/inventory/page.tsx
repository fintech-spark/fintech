import { CardHeading } from "@/components/common/card-heading";
import type { Metadata } from "next";

import { CapabilityPanel } from "@/components/common/data-state";
import { FreshnessLine } from "@/components/common/freshness";
import { MoneyValue } from "@/components/common/money";
import { PageHeader, SectionHeader } from "@/components/common/page-header";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { InventoryTable } from "@/components/inventory/inventory-table";
import { LowStockPanel } from "@/components/inventory/low-stock-panel";
import {
  PARAM,
  PRODUCT_STATUS_VALUES,
  readEnum,
  readPageNumber,
  readPageSize,
  readParam,
  type RawSearchParams,
} from "@/components/data/params";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { getInventoryValue, listLowStockProducts, listProducts } from "@/lib/api/endpoints";
import type { Page } from "@/lib/api/client";
import type { WireProduct } from "@/lib/api/contracts";
import { pendingCapability } from "@/lib/api/pending";
import { settle, type Settled } from "@/lib/api/settle";
import { formatCount } from "@/lib/format/money";
import type { CurrencyCode } from "@/lib/types";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage({
  searchParams,
}: {
  readonly searchParams: Promise<RawSearchParams>;
}) {
  const context = await resolveMerchantContext();
  // The shell owns the signed-out and offline states; this keeps the page
  // type-safe without duplicating that UI.
  if (!isAuthenticated(context)) return null;

  const params = await searchParams;
  const page = readPageNumber(params);
  const limit = readPageSize(params);
  const search = readParam(params, PARAM.search, 80);
  const status = readEnum(params, PARAM.status, PRODUCT_STATUS_VALUES);
  const category = readParam(params, PARAM.category, 80);
  /** `?filter=low` selects the backend's authoritative low-stock list. */
  const lowOnly = params[PARAM.filter] === "low";

  const businessId = context.activeBusinessId;
  const loadedAt = new Date();
  const currency: CurrencyCode = "INR";

  // The low-stock list is always fetched, not just when the filter is on: the
  // table needs it to label rows consistently with the reorder panel above.
  const lowStockRequest = settle(listLowStockProducts(businessId));

  const productsRequest = lowOnly
    ? // The low-stock endpoint is not paginated, so it is presented as one
      // complete list. No page size is invented for it.
      lowStockRequest.then(
        (settled): Settled<Page<WireProduct>> =>
          settled.ok
            ? {
                ok: true,
                value: {
                  items: settled.value,
                  total: settled.value.length,
                  page: 1,
                  limit: Math.max(settled.value.length, 1),
                  hasMore: false,
                },
              }
            : settled,
      )
    : settle(listProducts(businessId, { page, limit, status, category, search }));

  const valueRequest = settle(getInventoryValue(businessId));

  const [lowStock, products, inventoryValue] = await Promise.all([
    lowStockRequest,
    productsRequest,
    valueRequest,
  ]);

  const lowStockIds = new Set(
    (lowStock.ok ? lowStock.value : []).map((product) => product.id),
  );

  return (
    <>
      <PageHeader
        context={context.activeBusiness.name}
        title="Inventory"
        description="What is in stock, what it is worth, and what is running out. Stock levels come from your own movements."
        toolbar={<FreshnessLine updatedAt={loadedAt} />}
      />

      <section aria-labelledby="stock-summary" className="flex flex-col gap-3">
        <h2 id="stock-summary" className="sr-only">
          Stock summary
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Card size="sm">
            <CardHeader>
              <CardDescription>Money tied up in stock</CardDescription>
              <CardHeading className="text-2xl tabular-nums">
                {inventoryValue.ok ? (
                  <MoneyValue
                    value={{
                      amount: inventoryValue.value.totalValue,
                      currency,
                    }}
                  />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </CardHeading>
            </CardHeader>
            <CardContent>
              <p className="text-pretty text-sm text-muted-foreground">
                {inventoryValue.ok
                  ? `Valued at cost price, across ${formatCount(
                      inventoryValue.value.productCount,
                      "product",
                    )}.`
                  : "This figure could not be loaded just now."}
              </p>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardDescription>How low stock is decided</CardDescription>
              <CardHeading className="text-base">Per product, by you</CardHeading>
            </CardHeader>
            <CardContent>
              <p className="text-pretty text-sm text-muted-foreground">
                Each product carries its own reorder point. Nothing is flagged
                unless it is at or below that number — no guesswork.
              </p>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardDescription>Stock valuation</CardDescription>
              <CardHeading className="text-base">Calculated on the server</CardHeading>
            </CardHeader>
            <CardContent>
              <p className="text-pretty text-sm text-muted-foreground">
                The value of your unsold stock is worked out from your cost
                prices, not estimated in this screen.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      <section aria-labelledby="needs-reorder" className="flex flex-col gap-3">
        <SectionHeader
          id="needs-reorder"
          title="Needs reordering"
          description="Products at or below their reorder point, straight from your inventory rules."
        />
        <LowStockPanel result={lowStock} currency={currency} />
      </section>

      <section aria-labelledby="all-products" className="flex flex-col gap-3">
        <SectionHeader
          id="all-products"
          title="All products"
          description="Search, filter and page through your stock. Secondary columns drop away on smaller screens rather than shrinking into unreadability."
        />
        <InventoryTable
          search={search}
          status={status}
          lowOnly={lowOnly}
          result={products}
          backendFlaggedLowStockIds={lowStockIds}
        />
      </section>

      <CapabilityPanel capability={pendingCapability("profitLeaks")} />
    </>
  );
}