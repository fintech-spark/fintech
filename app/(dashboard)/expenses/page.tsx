import type { Metadata } from "next";
import { Link2, Receipt } from "lucide-react";

import { CapabilityPage } from "@/components/capability/capability-page";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { pendingCapability } from "@/lib/api/pending";

export const metadata: Metadata = { title: "Expenses" };

export default async function ExpensesPage() {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  return (
    <CapabilityPage
      capability={pendingCapability("expenseLedger")}
      icon={<Receipt aria-hidden={true} className="size-5 text-muted-foreground" />}
      title="Expenses"
      description="Money going out to run the business, and where a cost has quietly grown."
      promise={[
        "Every expense with its category, vendor and approval state.",
        "Totals per category, so you can see which cost is actually the biggest.",
        "Recurring costs and when they are next due — rent, utilities, subscriptions.",
        "Unusual increases compared with your own history, not with some average no merchant matches.",
        "Expenses still waiting for your approval, gathered in one place.",
      ]}
      inputs={[
        { href: "/documents", label: "Receipts you have added" },
        { href: "/suppliers", label: "Suppliers you pay" },
      ]}
      alternatives={[
        {
          href: "/documents?status=review_required",
          label: "Confirm your receipts",
          description: "A receipt you confirm becomes an expense you can see the cost of.",
        },
        {
          href: "/suppliers/payables",
          label: "See what you owe",
          description: "Unpaid bills are the largest expenses you have committed to.",
        },
      ]}
    >
      <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-sunken p-3 text-xs text-muted-foreground">
        <Link2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>
          Expenses can already be recorded, reviewed and approved through the API.
          What is missing is the route that lists them, so no ledger can be drawn
          here. That is a backend gap, not a missing feature in this design.
        </span>
      </p>
    </CapabilityPage>
  );
}
