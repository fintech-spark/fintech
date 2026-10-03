import type { Metadata } from "next";
import { Calculator } from "lucide-react";

import { CapabilityPage } from "@/components/capability/capability-page";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { pendingCapability } from "@/lib/api/pending";

export const metadata: Metadata = { title: "Simulator" };

export default async function SimulatorPage() {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  return (
    <CapabilityPage
      capability={pendingCapability("simulator")}
      icon={<Calculator aria-hidden={true} className="size-5 text-muted-foreground" />}
      title="Simulator"
      description="Try a change — raise a price, change a cost — and see the effect before you make it."
      promise={[
        "Current, scenario and the difference between them, side by side.",
        "Effect on revenue, profit, margin, cash and stock, each labelled with its unit.",
        "Percentage and percentage points kept apart, so a margin move is never overstated.",
        "A standing statement that a scenario changes nothing in your business until you act on it.",
        "A path from a promising scenario to a prepared action, with approval still required.",
      ]}
      inputs={[
        { href: "/inventory", label: "Current cost and selling prices" },
        { href: "/suppliers", label: "What your suppliers charge" },
        { href: "/sales", label: "How much you actually sell" },
      ]}
      alternatives={[
        {
          href: "/inventory",
          label: "Review today's prices",
          description: "See the cost and selling price of every product before you change one.",
        },
        {
          href: "/suppliers",
          label: "Review supplier pricing",
          description: "Compare what different suppliers charge for the same product.",
        },
      ]}
    >
      <p className="rounded-lg border border-caution-border bg-caution-subtle p-3 text-xs text-caution-foreground">
        A scenario is not a decision, and applying one is never automatic. When
        this screen is built, &ldquo;Apply&rdquo; will lead to a review step and
        your explicit approval before anything in your business changes.
      </p>
    </CapabilityPage>
  );
}
