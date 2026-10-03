"use client";

// Merchant Brain: business switcher.
//
// The merchant must always know which business they are acting on. Switching is
// a navigation, not a silent state flip: the chosen business is written to an
// httpOnly cookie by a server action and the router refreshes, so the server
// re-derives the tenant and no cached fragment from the previous business can
// survive the change.
//
// Only businesses the server already authorised are offered. The client cannot
// add one — the list arrives from `GET /api/businesses`.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, ChevronsUpDown, Loader2 } from "lucide-react";

import { switchBusiness } from "@/app/(dashboard)/actions";
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
import { describeStatus, BUSINESS_STATUS, type BusinessStatus } from "@/lib/format/status";
import { cn } from "@/lib/utils";

export interface BusinessOption {
  readonly id: string;
  readonly name: string;
  readonly status: BusinessStatus;
}

export function BusinessSwitcher({
  businesses,
  activeBusinessId,
}: {
  readonly businesses: readonly BusinessOption[];
  readonly activeBusinessId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const active = businesses.find((business) => business.id === activeBusinessId);
  const others = businesses.filter((business) => business.id !== activeBusinessId);

  function choose(id: string) {
    startTransition(async () => {
      await switchBusiness(id);
      // Full refresh: the server re-derives the tenant, so no fragment from the
      // previous business can be reused.
      router.refresh();
    });
  }

  if (businesses.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="h-auto min-h-9 w-full justify-start gap-2 px-2 py-1.5 text-left"
        >
          <Building2 aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-xs leading-tight text-muted-foreground">
              Business
            </span>
            <span className="truncate text-sm font-medium leading-tight">
              {active?.name ?? "Select a business"}
            </span>
          </span>
          {pending ? (
            <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin" />
          ) : (
            <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Your businesses</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {businesses.map((business) => {
            const isActive = business.id === activeBusinessId;
            const status = describeStatus(BUSINESS_STATUS, business.status);
            return (
              <DropdownMenuItem
                key={business.id}
                onSelect={() => {
                  if (!isActive) choose(business.id);
                }}
                className="items-start gap-2 py-2"
              >
                <Check
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    isActive ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">{business.name}</span>
                  <span className="text-xs text-muted-foreground">{status.label}</span>
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
        {others.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              Switching changes every figure on screen to the new business.
            </p>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}