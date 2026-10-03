// Merchant Brain: application shell.
//
// A Server Component. It resolves the tenant context once, then composes the
// sidebar, top bar and content column. Only the interactive leaves are Client
// Components, so the shell itself adds nothing to the client bundle.
//
// Three shapes, all real states rather than fallbacks:
//   - `signed_in`     → the full application
//   - `needs_account` → no session; explains the state and does not fake a UI
//   - `api_offline`   → the backend for this app is not connected yet

import Link from "next/link";
import { Building2, Cable, LogIn, ShieldCheck } from "lucide-react";

import { BusinessSwitcher } from "./business-switcher";
import { SidebarNav } from "./sidebar-nav";
import { TopBar } from "./top-bar";
import { APP_NAME } from "./nav-config";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { resolveMerchantContext } from "@/lib/api/context";
import { pendingCapability } from "@/lib/api/pending";
import { initials } from "@/lib/format/labels";
import { cn } from "@/lib/utils";

/** One content measure for the whole product (DESIGN_SYSTEM.md). */
const CONTENT_WIDTH = "max-w-6xl";

export async function AppShell({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const context = await resolveMerchantContext();

  if (context.status === "backend_unavailable") {
    return <BackendUnavailable capability={context.capability} />;
  }

  if (context.status === "unauthenticated") {
    return <NeedsAccount />;
  }

  const accountName = context.session.email || "Your account";

  return (
    <div className="flex min-h-dvh bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar. Hidden below md, where the bottom bar takes over. */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
        <div className="flex h-16 shrink-0 items-center gap-2 px-4">
          <BrandMark />
          <p className="text-sm font-semibold tracking-tight">{APP_NAME}</p>
        </div>
        <div className="px-3 pb-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <BusinessSwitcher
                  businesses={context.businesses.map((business) => ({
                    id: business.id,
                    name: business.name,
                    status: business.status,
                  }))}
                  activeBusinessId={context.activeBusinessId}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">
              You are working in {context.activeBusiness.name}. Figures on every
              screen belong to this business only.
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border">
          <SidebarNav />
        </div>
        <p className="shrink-0 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          Signed in as {accountName}
        </p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          accountName={accountName}
          businessName={context.activeBusiness.name}
          unreadNotifications={null}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            "flex-1 px-4 pt-6 pb-24 focus-visible:outline-none md:px-6 md:pb-10",
          )}
        >
          <div className={cn("mx-auto flex w-full flex-col gap-6", CONTENT_WIDTH)}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground"
    >
      {initials(APP_NAME)}
    </span>
  );
}

/**
 * Signed out. This is a real product state with a real explanation — not a
 * login form, because the auth UI belongs to the backend workstream and a form
 * here would submit to nothing.
 */
function NeedsAccount() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-12">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="flex items-center gap-3">
          <BrandMark />
          <div className="flex flex-col">
            <p className="text-lg font-semibold tracking-tight">{APP_NAME}</p>
            <p className="text-sm text-muted-foreground">
              Your business, understood
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <LogIn aria-hidden="true" className="mt-0.5 size-5 text-muted-foreground" />
              <div className="flex flex-col gap-1">
                <h1 className="text-lg font-semibold tracking-tight">
                  You are not signed in
                </h1>
                <p className="text-pretty text-sm text-muted-foreground">
                  Merchant Brain only shows a business after it has verified who
                  you are and which business you may see. That check happens on
                  the server, never in the browser.
                </p>
              </div>
            </div>

            <Alert>
              <ShieldCheck aria-hidden="true" />
              <AlertTitle>Sign-in is not connected yet</AlertTitle>
              <AlertDescription>
                The authentication flow belongs to the backend workstream and has
                not been built. Rather than show you a sign-in form that cannot
                work, this screen tells you exactly where you are.
              </AlertDescription>
            </Alert>

            <Button asChild className="w-full">
              <Link href="/">Back to the start</Link>
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          This is expected during development. No data is being hidden — there is
          simply no verified business to show yet.
        </p>
      </div>
    </div>
  );
}

/**
 * The API this app reads from has no route. Named plainly, with the reason and
 * the owner, so nobody mistakes it for an empty business.
 */
function BackendUnavailable({ capability }: { readonly capability: string }) {
  const pending = pendingCapability("analyticsOverview");
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-lg">
        <Alert className="items-start border-info-border bg-card">
          <Cable aria-hidden="true" className="mt-0.5 size-5 text-info-foreground" />
          <AlertTitle className="text-base">Merchant Brain&rsquo;s data service is not connected</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <p>
              This app could not reach <span className="font-mono">{capability}</span>,
              so it cannot show any business figures. Nothing has gone wrong with
              your data.
            </p>
            <p className="text-muted-foreground">
              {pending.explanation}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href="/">
                  <Building2 aria-hidden="true" data-icon="inline-start" />
                  Back to the start
                </Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
}