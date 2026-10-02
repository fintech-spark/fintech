import type { Metadata } from "next";
import { BellOff } from "lucide-react";

import { CapabilityPage } from "@/components/capability/capability-page";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { pendingCapability } from "@/lib/api/pending";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  return (
    <CapabilityPage
      capability={pendingCapability("notifications")}
      icon={<BellOff aria-hidden={true} className="size-5 text-muted-foreground" />}
      title="Notifications"
      description="Things worth your attention, and nothing else."
      promise={[
        "Only events that matter: a profit leak found, a cash risk, an overdue balance, a low stock item, a supplier price change.",
        "A record of what happened to an action you approved.",
        "A problem with a document that could not be read.",
        "No marketing, no digests you did not ask for, and no notification you cannot act on.",
      ]}
      inputs={[
        { href: "/overview", label: "What needs attention right now" },
        { href: "/documents?status=review_required", label: "Items currently waiting on you" },
      ]}
      alternatives={[
        {
          href: "/overview",
          label: "See your Needs attention list",
          description: "Overdue balances, low stock and documents waiting on you, ordered by the money involved.",
        },
        {
          href: "/documents?status=review_required",
          label: "See what is waiting for you",
          description: "Documents Merchant Brain has read and is waiting on you to confirm.",
        },
      ]}
    >
      <p className="text-xs text-muted-foreground">
        This list is empty by design, not by accident. An empty notification
        centre that looked like a working one would be worse than an honest
        explanation.
      </p>
    </CapabilityPage>
  );
}
