import type { Metadata } from "next";

import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import InventoryMovementClient from "@/components/inventory/inventory-movement-client";

export const metadata: Metadata = { title: "Inventory movement" };

export default async function InventoryMovementPage() {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  return <InventoryMovementClient businessId={context.activeBusinessId} />;
}
