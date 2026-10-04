"use client";

// Merchant Brain: the top bar.
//
// Carries business identity, the command affordance, notifications and the
// account menu. On mobile it degrades to a compact bar with the screen title,
// because a merchant on a phone needs orientation above all else.

import { Bell, LogOut, Settings, User } from "lucide-react";
import Link from "next/link";

import { CommandMenu } from "./command-menu";
import { MobileNav } from "./mobile-nav";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials } from "@/lib/format/labels";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TopBar({
  accountName,
  businessName,
  unreadNotifications,
}: {
  readonly accountName: string;
  readonly businessName: string;
  /** `null` means the notification service is not connected — shown honestly. */
  readonly unreadNotifications: number | null;
}) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80">
      <div className="flex h-14 items-center gap-2 px-4 md:h-16 md:px-6">
        <MobileNav />

        <div className="flex min-w-0 flex-1 items-center gap-3">
          {/* On mobile this is the only orientation cue, so it stays. */}
          <p className="min-w-0 truncate text-sm font-medium text-muted-foreground md:hidden">
            {businessName}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1 md:gap-2">
          <CommandMenu />

          <Button variant="ghost" size="icon" asChild>
            <Link href="/notifications" aria-label="Notifications">
              <Bell aria-hidden="true" />
              {unreadNotifications !== null && unreadNotifications > 0 ? (
                <span className="sr-only">
                  {unreadNotifications} unread notification
                  {unreadNotifications === 1 ? "" : "s"}
                </span>
              ) : null}
            </Link>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Account menu"
                className="rounded-full"
              >
                <Avatar className="size-8">
                  <AvatarFallback>{initials(accountName)}</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="flex flex-col gap-0.5">
                <span className="truncate text-sm font-medium">{accountName}</span>
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {businessName}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem asChild>
                  <Link href="/settings">
                    <Settings aria-hidden="true" />
                    Business settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings#team">
                    <User aria-hidden="true" />
                    Team access
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={isSigningOut}
                onSelect={(event) => {
                  event.preventDefault();
                  void handleSignOut();
                }}
              >
                <LogOut aria-hidden="true" />
                {isSigningOut ? "Signing out…" : "Sign out"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}