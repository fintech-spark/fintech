import type { Metadata } from "next";
import { ClipboardCheck } from "lucide-react";

import { CapabilityPage } from "@/components/capability/capability-page";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { pendingCapability } from "@/lib/api/pending";

export const metadata: Metadata = { title: "Action Center" };

export default async function ActionsPage() {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  return (
    <CapabilityPage
      capability={pendingCapability("actions")}
      icon={<ClipboardCheck aria-hidden={true} className="size-5 text-muted-foreground" />}
      title="Action Center"
      description="Everything Merchant Brain has prepared for you — with the reasoning, before you approve anything."
      promise={[
        "Draft, pending approval, approved, executing, completed, failed, rejected and cancelled — each state shown plainly.",
        "For every action: what it will do, why it was proposed, what it will affect, and the evidence behind it.",
        "Who approved it, and what actually happened afterwards.",
        "Nothing executes without your explicit approval. A prepared action is not a done action.",
      ]}
      inputs={[
        { href: "/documents?status=review_required", label: "Document confirmations that already work" },
      ]}
      alternatives={[
        {
          href: "/documents?status=review_required",
          label: "Approve a document",
          description: "The one live approval boundary in Merchant Brain today, with the same review-before-confirm pattern.",
        },
        {
          href: "/customers/receivables?status=overdue",
          label: "Find something worth acting on",
          description: "Overdue balances are what a reminder action would be built from.",
        },
      ]}
    >
      <p className="rounded-lg border border-border bg-surface-sunken p-3 text-sm text-muted-foreground">
        When this screen is live, no button here will ever report success before
        the server has confirmed it. If a request fails in a way that leaves the
        outcome unknown, the screen will say exactly that instead of guessing.
      </p>
    </CapabilityPage>
  );
}
