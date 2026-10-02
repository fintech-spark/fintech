import { CardHeading } from "@/components/common/card-heading";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CapabilityPanel } from "@/components/common/data-state";
import { FreshnessLine } from "@/components/common/freshness";
import { MoneyValue } from "@/components/common/money";
import { PageHeader, SectionHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { getProduct } from "@/lib/api/endpoints";
import { pendingCapability } from "@/lib/api/pending";
import { formatQuantity } from "@/lib/format/money";
import { safeLabel } from "@/lib/format/labels";
import {
  describeStatus,
  PRODUCT_STATUS,
  PRODUCT_UNIT_LABEL,
  STOCK_LEVEL,
  stockLevel,
} from "@/lib/format/status";
import type { CurrencyCode } from "@/lib/types";

export const metadata: Metadata = { title: "Product" };

export default async function ProductPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  const { id } = await params;
  const businessId = context.activeBusinessId;

  let product: Awaited<ReturnType<typeof getProduct>>;
  try {
    product = await getProduct(businessId, id);
  } catch {
    // A 404 from this route means the record is gone or belongs to another
    // business — the backend deliberately does not tell us which.
    notFound();
  }

  const currency: CurrencyCode = "INR";
  const level = describeStatus(STOCK_LEVEL, stockLevel(product));
  const unit = PRODUCT_UNIT_LABEL[product.unit] ?? product.unit;

  return (
    <>
      <PageHeader
        context={context.activeBusiness.name}
        title={safeLabel(product.name)}
        description={product.sku ? `SKU ${safeLabel(product.sku)}` : undefined}
        backHref="/inventory"
        backLabel="All products"
        toolbar={<FreshnessLine updatedAt={product.updatedAt} prefix="Product last changed" />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardHeading>Stock</CardHeading>
            <CardDescription>
              How much you have, against the point at which you asked to be told.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <dt className="text-sm text-muted-foreground">In stock now</dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  {formatQuantity(product.currentStock, unit)}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-sm text-muted-foreground">Stock level</dt>
                <dd>
                  <StatusBadge descriptor={level} />
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-sm text-muted-foreground">Reorder point</dt>
                <dd className="text-lg font-medium tabular-nums">
                  {formatQuantity(product.reorderPoint, unit)}
                </dd>
                <p className="text-xs text-muted-foreground">
                  You are told to reorder at or below this quantity.
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-sm text-muted-foreground">Usual reorder quantity</dt>
                <dd className="text-lg font-medium tabular-nums">
                  {formatQuantity(product.reorderQuantity, unit)}
                </dd>
              </div>
            </dl>

            <Separator className="my-5" />

            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium">Trading status</h3>
                <StatusBadge
                  descriptor={describeStatus(PRODUCT_STATUS, product.status)}
                  showIcon={false}
                  size="sm"
                />
              </div>
              <p className="text-pretty text-sm text-muted-foreground">
                {describeStatus(PRODUCT_STATUS, product.status).description}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardHeading>Pricing</CardHeading>
            <CardDescription>
              As recorded on this product. Merchant Brain has not calculated your
              margin from these.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-4">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-muted-foreground">Cost price</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  <MoneyValue value={{ ...product.costPrice, currency }} />
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-muted-foreground">Selling price</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  <MoneyValue value={{ ...product.sellingPrice, currency }} />
                </dd>
              </div>
              <Separator />
              <div className="flex flex-col gap-1">
                <dt className="text-sm text-muted-foreground">Value of stock on hand</dt>
                <dd className="text-sm tabular-nums">
                  Computed from cost price × quantity by your inventory service.
                </dd>
              </div>
              {product.category ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-sm text-muted-foreground">Category</dt>
                  <dd className="text-sm">{safeLabel(product.category)}</dd>
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="not-available" className="flex flex-col gap-3">
        <SectionHeader
          id="not-available"
          title="What this screen cannot tell you yet"
          description="Named so you know the limit of the product, rather than assuming the number is all there is."
        />
        <div className="grid gap-3 md:grid-cols-2">
          <CapabilityPanel
            capability={pendingCapability("profitLeaks")}
            action={
              <Button variant="outline" size="sm" asChild>
                <Link href="/profit-leaks">Open Profit leaks</Link>
              </Button>
            }
          />
          <CapabilityPanel
            capability={pendingCapability("simulator")}
            action={
              <Button variant="outline" size="sm" asChild>
                <Link href="/simulator">Open Simulator</Link>
              </Button>
            }
          />
        </div>
      </section>
    </>
  );
}

export { describeStatus };
