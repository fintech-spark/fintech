"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Bell,
  CheckCheck,
  AlertTriangle,
  Info,
  CheckCircle2,
  ExternalLink,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyPanel } from "@/components/common/data-state";
import type { WireNotification } from "@/lib/api/contracts";
import { formatDate } from "@/lib/format/dates";

export function NotificationsView({
  businessId,
  initialNotifications,
}: {
  readonly businessId: string;
  readonly initialNotifications: readonly WireNotification[];
}) {
  const [notifications, setNotifications] = useState<readonly WireNotification[]>(initialNotifications);
  const [statusFilter, setStatusFilter] = useState<"all" | "unread">("all");
  const [markingAll, setMarkingAll] = useState(false);

  const handleMarkRead = async (id: string) => {
    try {
      const res = await fetch(`/api/businesses/${businessId}/notifications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "read" }),
      });
      if (!res.ok) throw new Error("Failed to mark notification as read");
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, status: "read" as const } : n)),
      );
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to mark notification as read");
    }
  };

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}/notifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_all_read" }),
      });
      if (!res.ok) throw new Error("Failed to mark all as read");
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, status: "read" as const })),
      );
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to mark all as read");
    } finally {
      setMarkingAll(false);
    }
  };

  const filtered = notifications.filter((n) => {
    if (statusFilter === "unread" && n.status !== "unread") return false;
    return true;
  });

  const unreadCount = notifications.filter((n) => n.status === "unread").length;

  const severityIcon = (sev: string) => {
    switch (sev) {
      case "critical":
        return <ShieldAlert className="size-4 text-destructive shrink-0" />;
      case "warning":
        return <AlertTriangle className="size-4 text-caution-foreground shrink-0" />;
      case "success":
        return <CheckCircle2 className="size-4 text-positive-foreground shrink-0" />;
      default:
        return <Info className="size-4 text-primary shrink-0" />;
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={statusFilter === "all" ? "default" : "outline"}
            onClick={() => setStatusFilter("all")}
            className="text-xs h-8"
          >
            All Alerts ({notifications.length})
          </Button>
          <Button
            size="sm"
            variant={statusFilter === "unread" ? "default" : "outline"}
            onClick={() => setStatusFilter("unread")}
            className="text-xs h-8"
          >
            Unread ({unreadCount})
          </Button>
        </div>

        {unreadCount > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleMarkAllRead}
            disabled={markingAll}
            className="text-xs h-8 gap-1.5"
          >
            <CheckCheck className="size-3.5" aria-hidden="true" />
            <span>Mark all read</span>
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyPanel
          icon={<Bell className="size-8 text-muted-foreground" aria-hidden="true" />}
          title="Inbox clear"
          description={
            statusFilter === "unread"
              ? "You have caught up with all high-priority alerts."
              : "No system notifications or intelligence alerts have been generated."
          }
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {filtered.map((item) => (
            <Card
              key={item.id}
              className={`transition-colors ${
                item.status === "unread"
                  ? "border-primary/40 bg-card"
                  : "border-border/60 bg-muted/20 opacity-80"
              }`}
            >
              <CardContent className="p-4 flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">{severityIcon(item.severity)}</div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{item.title}</span>
                      {item.status === "unread" && (
                        <span className="inline-block size-2 rounded-full bg-primary" />
                      )}
                      <Badge variant="outline" className="text-xs uppercase font-mono">
                        {item.type.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{item.message}</p>
                    <span className="text-xs text-muted-foreground mt-0.5">
                      {formatDate(item.createdAt)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {item.actionUrl && (
                    <Button size="sm" variant="outline" asChild className="h-7 text-xs gap-1">
                      <Link href={item.actionUrl}>
                        <span>View</span>
                        <ExternalLink className="size-3" />
                      </Link>
                    </Button>
                  )}
                  {item.status === "unread" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleMarkRead(item.id)}
                      className="h-7 text-xs"
                    >
                      Dismiss
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
