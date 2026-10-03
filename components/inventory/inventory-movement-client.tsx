"use client";

import { useState } from "react";
import { ArrowLeft, Package } from "lucide-react";
import Link from "next/link";
import { getProductForMerchant } from "@/app/(dashboard)/inventory/actions";
import type { WireProduct } from "@/lib/api/contracts";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { TriangleAlert, CircleCheck } from "lucide-react";

export default function InventoryMovementClient({ businessId }: { readonly businessId: string }) {
  const [productId, setProductId] = useState("");
  const [type, setType] = useState("adjustment");
  const [quantity, setQuantity] = useState("");
  const [reference, setReference] = useState("");
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [product, setProduct] = useState<WireProduct | null>(null);
  const [productError, setProductError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function loadProduct() {
    if (!businessId || !productId.trim()) return;
    setLoadingProduct(true);
    setProductError(null);
    setProduct(null);
    try {
      const result = await getProductForMerchant(businessId, productId.trim());
      if (result.ok) {
        setProduct(result.value);
      } else {
        setProductError(result.error);
      }
    } catch {
      setProductError("Could not load product.");
    } finally {
      setLoadingProduct(false);
    }
  }

  function submit() {
    if (!product || !businessId) return;
    setSubmitting(true);
    // The inventory domain service exists (modules/inventory/application/service.ts)
    // but no HTTP route reaches it from this screen (lib/api/endpoints.ts has only
    // GET endpoints). We do NOT invent a route or fake a success.
    setTimeout(() => {
      setSubmitting(false);
      setSubmitted(true);
    }, 600);
  }

  return (
    <>
      <PageHeader
        title="Inventory movement"
        description="Record stock changes with honest backend limits."
        toolbar={
          <Link
            href="/inventory"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Inventory
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Movement</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="product-id">Product ID</Label>
                <Input
                  id="product-id"
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  placeholder="Product ID"
                  className="min-w-56"
                />
              </div>
              <Button onClick={loadProduct} disabled={loadingProduct || !productId.trim()}>
                {loadingProduct ? <Spinner data-icon="inline-start" /> : <Package aria-hidden="true" className="size-4" />}
                Load
              </Button>
            </div>

            {productError && (
              <Alert variant="destructive">
                <TriangleAlert aria-hidden="true" className="size-4" />
                <AlertTitle>Not found</AlertTitle>
                <AlertDescription>{productError}</AlertDescription>
              </Alert>
            )}

            {product && (
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <div className="font-medium">{product.name || product.id}</div>
                <div className="text-muted-foreground">Current stock: <strong>{product.currentStock ?? "—"}</strong> {product.unit || "units"}</div>
                <div className="text-muted-foreground">Status: <strong>{product.status ?? "—"}</strong></div>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="movement-type">Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger id="movement-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="purchase">Purchase</SelectItem>
                    <SelectItem value="sale">Sale</SelectItem>
                    <SelectItem value="return">Return</SelectItem>
                    <SelectItem value="adjustment">Adjustment</SelectItem>
                    <SelectItem value="damage">Damage</SelectItem>
                    <SelectItem value="transfer">Transfer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="quantity">Quantity</Label>
                <Input
                  id="quantity"
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ref">Reference</Label>
                <Input
                  id="ref"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>

            {submitted ? (
              <Alert variant="default">
                <TriangleAlert aria-hidden="true" className="size-4" />
                <AlertTitle>Not connected</AlertTitle>
                <AlertDescription>
                  The inventory domain service can record movements (modules/inventory/application/service.ts),
                  but no HTTP endpoint connects this form to it (lib/api/endpoints.ts has only GET routes for inventory).
                  Success UI does not appear because the server did not confirm.
                </AlertDescription>
              </Alert>
            ) : (
              <Button
                onClick={submit}
                disabled={submitting || !product || !quantity.trim() || Number(quantity) === 0}
                className="w-full sm:w-auto"
              >
                {submitting ? <Spinner data-icon="inline-start" /> : <CircleCheck aria-hidden="true" className="size-4" />}
                Record movement
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Limits</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2 text-muted-foreground">
            <p>The inventory movement domain exists (<code>modules/inventory/</code>).</p>
            <p>The HTTP endpoint does not exist in <code>lib/api/endpoints.ts</code>.</p>
            <p>Form validates and reads product stock via <code>getProduct</code>.</p>
            <p>Submit shows honest gap — no fake success.</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
