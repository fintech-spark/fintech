// Merchant Brain: the authoritative low-stock list.
//
// Fetched once per page render and handed to both the reorder panel and the
// product table. Two consequences, both of them the point:
//
//   1. Consistency — a product cannot be labelled "Reorder now" in one panel
//      and "Running low" in the table on the same screen.
//   2. One request instead of two.
//
// The bucket itself is still the backend's: `GET /api/inventory/low-stock`
// applies the Phase 1 `needsReorder` rule. The UI only labels rows the backend
// already flagged, and never re-derives the rule.

import Link from "next/link";
import { Boxes } from "lucide-react";

import { CapabilityPanel, EmptyPanel, ErrorPanel } from "@/components/common/data-state";
import { MoneyValue } from "@/components/common/money";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatQuantity } from "@/lib/format/money";
import { safeLabel } from "@/lib/format/labels";
import { describeStatus, STOCK_LEVEL, stockLevel } from "@/lib/format/status";
import { pendingCapability } from "@/lib/api/pending";
import type { Settled } from "@/lib/api/settle";
import type { WireProduct } from "@/lib/api/contracts";
import type { CurrencyCode } from "@/lib/types";

export function LowStockPanel({
  result,
  currency,
}: {
  readonly result: Settled<readonly WireProduct[]>;
  readonly currency: CurrencyCode;
}) {
  if (!result.ok) {
    return <ErrorPanel error={result.error} variant="card" />;
  }

  const products = result.value;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Products below their reorder point</CardTitle>
        <CardDescription>
          {products.length === 0
            ? "Nothing is at or below its reorder point."
            : "Order before you run out — you cannot sell what you do not have. This list comes straight from your inventory rules."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {products.length === 0 ? (
          <EmptyPanel
            icon={<Boxes aria-hidden="true" className="size-5 text-muted-foreground" />}
            title="Nothing needs reordering"
            description="Every product is above its reorder point right now. This list fills itself as stock falls, so you do not have to watch it."
            action={
              <Button variant="outline" size="sm" asChild>
                <Link href="/inventory">See all stock</Link>
              </Button>
            }
          />
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-border">
              {products.slice(0, 8).map((product) => {
                const level = stockLevel(product, { backendFlaggedLowStock: true });
                const unitCost = { ...product.costPrice, currency };
                const suggestedUnits =
                  product.reorderQuantity > 0
                    ? product.reorderQuantity
                    : Math.max(product.reorderPoint * 2 - product.currentStock, 0);

                return (
                  <li
                    key={product.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <Link
                        href={`/inventory/${encodeURIComponent(product.id)}`}
                        className="truncate text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {safeLabel(product.name)}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {formatQuantity(product.currentStock)} left · reorder at{" "}
                        {formatQuantity(product.reorderPoint)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <StatusBadge
                        descriptor={describeStatus(STOCK_LEVEL, level)}
                        showIcon={false}
                        size="sm"
                      />
                      {suggestedUnits > 0 ? (
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {/* "at … each", never a multiplied total: the frontend
                              formats authoritative amounts and never computes
                              money. */}
                          Order {formatQuantity(suggestedUnits)} at{" "}
                          <MoneyValue value={unitCost} compact /> each
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            {products.length > 8 ? (
              <div className="mt-4">
                <Button variant="outline" size="sm" asChild>
                  <Link href="/inventory?filter=low">
                    See all {products.length} products needing reordering
                  </Link>
                </Button>
              </div>
            ) : null}
            <p className="mt-4 text-xs text-muted-foreground">
              Reorder quantities come from your product records. Merchant Brain has
              not yet calculated how much to order or when — that needs the
              inventory forecasting work.
            </p>
          </>
        )}

        <div className="mt-4">
          <CapabilityPanel capability={pendingCapability("simulator")} />
        </div>
      </CardContent>
    </Card>
  );
}