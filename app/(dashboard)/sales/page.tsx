import type { Metadata } from "next";
import { ShoppingCart } from "lucide-react";

import { CapabilityPage } from "@/components/capability/capability-page";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { pendingCapability } from "@/lib/api/pending";

export const metadata: Metadata = { title: "Sales" };

export default async function SalesPage() {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  return (
    <CapabilityPage
      capability={pendingCapability("salesLedger")}
      icon={<ShoppingCart aria-hidden={true} className="size-5 text-muted-foreground" />}
      title="Sales"
      description="Revenue, orders and what is selling — with the reason behind any change in them."
      promise={[
        "Every sale and purchase, newest first, with who it was with and what was in it.",
        "Revenue over time against the previous period, in the currency you trade in.",
        "Which products drive revenue, and which ones are losing money on every sale.",
        "Average order value, refunds and discounts, so a fall in revenue can be explained rather than just observed.",
        "Payment method breakdown — cash, UPI, card, credit — because a change in how you get paid is a change in your cash.",
      ]}
      inputs={[
        { href: "/customers", label: "Customers and who they owe you" },
        { href: "/inventory", label: "Products, prices and stock" },
        { href: "/documents", label: "Invoices and receipts" },
      ]}
      alternatives={[
        {
          href: "/customers",
          label: "See who buys from you",
          description: "What each customer has bought in total, and when they last ordered.",
        },
        {
          href: "/inventory",
          label: "See what is selling",
          description: "Stock movements tell you what has gone out of the shelf.",
        },
        {
          href: "/customers/receivables",
          label: "See who has not paid yet",
          description: "Money you are still owed, and which of it is late.",
        },
        {
          href: "/documents?status=review_required",
          label: "Confirm your invoices",
          description: "Confirming a document is what puts a sale into your records.",
        },
      ]}
    >
      <p className="text-xs text-muted-foreground">
        Signed in to {context.activeBusiness.name}. Figures on every linked screen
        belong to this business.
      </p>
    </CapabilityPage>
  );
}
