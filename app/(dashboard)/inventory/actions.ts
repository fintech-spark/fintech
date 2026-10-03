"use server";

import { getProduct } from "@/lib/api/endpoints";
import { settle } from "@/lib/api/settle";
import type { WireProduct } from "@/lib/api/contracts";

export async function getProductForMerchant(
  businessId: string,
  productId: string,
): Promise<{ ok: true; value: WireProduct } | { ok: false; error: string }> {
  try {
    const result = await settle(getProduct(businessId, productId));
    if (result.ok) return { ok: true, value: result.value };
    return { ok: false, error: result.error.message || "Not found." };
  } catch {
    return { ok: false, error: "Could not load product." };
  }
}
