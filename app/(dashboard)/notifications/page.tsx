import type { Metadata } from "next";
import { FreshnessLine } from "@/components/common/freshness";
import { PageHeader } from "@/components/common/page-header";
import { NotificationsView } from "@/components/notifications/notifications-view";
import { isAuthenticated, resolveMerchantContext } from "@/lib/api/context";
import { listNotifications } from "@/lib/api/endpoints";
import { settle } from "@/lib/api/settle";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const context = await resolveMerchantContext();
  if (!isAuthenticated(context)) return null;

  const businessId = context.activeBusinessId;
  const loadedAt = new Date();

  const notificationsResult = await settle(listNotifications(businessId, { limit: 50 }));
  const initialNotifications = notificationsResult.ok ? notificationsResult.value.items : [];

  return (
    <>
      <PageHeader
        context={context.activeBusiness.name}
        title="Notifications & Alerts"
        description="Operational alerts from profit leaks, cash-flow risks, low stock, and approved actions."
        toolbar={<FreshnessLine updatedAt={loadedAt} />}
      />

      <section aria-labelledby="notifications-inbox" className="flex flex-col gap-3">
        <h2 id="notifications-inbox" className="sr-only">
          Notifications Inbox
        </h2>
        <NotificationsView
          businessId={businessId}
          initialNotifications={initialNotifications}
        />
      </section>
    </>
  );
}
