import type { Metadata } from "next";
import { Banknote } from "lucide-react";

import { CapabilityPage } from "@/components/capability/capability-page";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { pendingCapability } from "@/lib/api/pending";

export const metadata: Metadata = { title: "Profit leaks" };

/**
 * The product's flagship screen. It is also the screen that must NOT be faked:
 * a profit leak is a deterministic finding supported by evidence, so inventing
 * one for a demo would be the single most damaging thing this app could do.
 */
export default async function ProfitLeaksPage() {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  return (
    <CapabilityPage
      capability={pendingCapability("profitLeaks")}
      icon={<Banknote aria-hidden={true} className="size-5 text-muted-foreground" />}
      title="Profit leaks"
      description="Money slipping away — found by rules, explained by evidence, and never guessed at."
      promise={[
        "Each leak answered as an investigation: what is happening, why, how much, since when, and what you can do.",
        "Findings with the records behind them, so you can check the claim instead of trusting it.",
        "Severity in words — critical, high, medium — never a bare colour or a score out of a hundred.",
        "A path from a finding to a scenario, so you can test a response before you act on it.",
      ]}
      inputs={[
        { href: "/suppliers", label: "Supplier prices and what you pay" },
        { href: "/inventory", label: "Product costs and selling prices" },
        { href: "/expenses", label: "Running costs" },
        { href: "/customers/receivables", label: "Money owed to you, and how late" },
      ]}
      alternatives={[
        {
          href: "/inventory",
          label: "Check your product prices",
          description: "Compare cost price against selling price on any product you sell.",
        },
        {
          href: "/suppliers",
          label: "Check what your suppliers charge",
          description: "Current prices per product, as last recorded.",
        },
        {
          href: "/customers/receivables?status=overdue",
          label: "Chase what is overdue",
          description: "Late payments are money you earned and did not receive.",
        },
      ]}
    >
      <p className="rounded-lg border border-border bg-surface-sunken p-3 text-sm text-muted-foreground">
        When this screen works, nothing here will ever be a plausible-looking
        number with no source behind it. If Merchant Brain cannot point at the
        records that prove a leak, it will say there is no evidence rather than
        show you a finding.
      </p>
    </CapabilityPage>
  );
}
