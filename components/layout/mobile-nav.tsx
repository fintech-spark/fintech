"use client";

// Merchant Brain: mobile navigation.
//
// A squeezed desktop sidebar on a 390px screen is not a mobile experience, so
// the phone gets its own pattern: a compact top bar and a bottom bar of the
// five destinations that earn a permanent slot, with everything else behind an
// accessible sheet.
//
// The bottom bar respects the home-indicator safe area and keeps a minimum
// 44px touch target per item.

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";

import { MOBILE_NAV_ITEMS, NAV_GROUPS, isNavItemActive } from "./nav-config";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80 pb-safe-bottom md:hidden"
      >
        <ul className="grid grid-cols-5">
          {MOBILE_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isNavItemActive(item.href, pathname);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-xs transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    active
                      ? "font-medium text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  <Icon
                    aria-hidden="true"
                    className={cn("size-5", active && "text-foreground")}
                  />
                  <span className="w-full truncate text-center">
                    {item.shortLabel ?? item.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label="All screens"
            className="md:hidden"
          >
            <Menu aria-hidden="true" />
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="w-80 overflow-y-auto">
          <SheetHeader>
            <SheetTitle>All screens</SheetTitle>
            <SheetDescription>
              Every part of Merchant Brain, grouped by what you are trying to do.
            </SheetDescription>
          </SheetHeader>
          <nav aria-label="All screens" className="flex flex-col gap-5 px-4 pb-6">
            {NAV_GROUPS.map((group) => (
              <div key={group.id} className="flex flex-col gap-1">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {group.label}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = isNavItemActive(item.href, pathname);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={() => setOpen(false)}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            active
                              ? "bg-accent font-medium text-accent-foreground"
                              : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground",
                          )}
                        >
                          <Icon aria-hidden="true" className="size-4 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}