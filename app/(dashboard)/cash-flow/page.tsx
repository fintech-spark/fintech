import type { Metadata } from "next";
import { CircleDollarSign } from "lucide-react";

import { CapabilityPage } from "@/components/capability/capability-page";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { pendingCapability } from "@/lib/api/pending";

export const metadata: Metadata = { title: "Cash flow" };

export default async function CashFlowPage() {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  return (
    <CapabilityPage
      capability={pendingCapability("cashFlow")}
      icon={<CircleDollarSign aria-hidden={true} className="size-5 text-muted-foreground" />}
      title="Cash flow"
      description="Money coming in, money going out, and what is expected — clearly separated from what has already happened."
      promise={[
        "Current cash, expected inflows and expected outflows, each labelled so they are never confused.",
        "A 30-day projection built from receivables, payables and recurring commitments.",
        "The assumptions behind every projection, stated openly rather than buried.",
        "Risk points named in words: 'three bills totalling ₹X are due this week'.",
        "A clear statement of uncertainty when there is not enough history to be confident.",
      ]}
      inputs={[
        { href: "/customers/receivables", label: "Money owed to you, and what is late" },
        { href: "/suppliers/payables", label: "Money you owe, and what is late" },
        { href: "/inventory", label: "Stock you hold and what it is worth" },
      ]}
      alternatives={[
        {
          href: "/customers/receivables?status=overdue",
          label: "Check what is overdue",
          description: "Late receivables are the most common cause of cash pressure.",
        },
        {
          href: "/suppliers/payables?status=overdue",
          label: "Check what you owe soon",
          description: "Bills coming due are what turns a healthy balance into a tight one.",
        },
      ]}
    >
      <p className="rounded-lg border border-caution-border bg-caution-subtle p-3 text-xs text-caution-foreground">
        A forecast is never the same kind of thing as a record. When this screen
        is built, historical figures, expected figures and projections will each
        carry their own label, and a projection will never be presented as
        something that has already happened.
      </p>
    </CapabilityPage>
  );
}
