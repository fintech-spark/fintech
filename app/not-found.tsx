import Link from "next/link";
import { FileQuestion, LayoutDashboard } from "lucide-react";

import { APP_NAME } from "@/components/layout/nav-config";
import { Button } from "@/components/ui/button";

// The GLOBAL not-found boundary: any URL that matches no route at all. Without
// this file Next renders its own page, which has no `<main>` landmark, no skip
// link and none of Merchant Brain's voice — a 404 is still a screen a merchant
// can land on, so it gets the same care as any other.

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to main content
      </a>

      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-6xl items-center px-4 md:px-6">
          <p className="text-sm font-semibold tracking-tight">{APP_NAME}</p>
        </div>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center gap-5 px-4 py-16 focus-visible:outline-none"
      >
        <FileQuestion aria-hidden="true" className="size-8 text-muted-foreground" />
        <div className="flex flex-col gap-2">
          <h1 className="text-balance text-2xl font-semibold tracking-tight">
            There is no screen at this address
          </h1>
          <p className="max-w-prose text-pretty text-muted-foreground">
            The link may be out of date, or the address may have a typo. Nothing
            about your business records has changed.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/overview">
              <LayoutDashboard data-icon="inline-start" />
              Go to Overview
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Back to the start</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}