"use client";

// Merchant Brain: client providers.
//
// `TooltipProvider` is required by every Radix tooltip and must sit above the
// whole tree, including server-rendered children.
//
// There is deliberately no toast system here. A mutation's outcome is shown as
// persistent state on the page — an inline outcome panel, or the record's own
// current status — because a merchant who approves something must be able to
// see what happened without relying on a message that disappears. Transient
// toasts are for things that do not change business state.

import { TooltipProvider } from "@/components/ui/tooltip";

export function AppProviders({ children }: { readonly children: React.ReactNode }) {
  return <TooltipProvider delayDuration={200}>{children}</TooltipProvider>;
}
