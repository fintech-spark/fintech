// Merchant Brain: shell for the authentication screens.
//
// One layout for sign-in and sign-up so the two screens cannot drift into two
// different visual languages. It is intentionally outside the dashboard shell:
// an unauthenticated visitor has no business context to render.

import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { APP_NAME } from "@/components/layout/nav-config";
import { ThemeSwitcher } from "@/components/layout/theme-switcher";

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-foreground"
          >
            <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
            {APP_NAME}
          </Link>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground sm:inline">Your business, understood</span>
            <ThemeSwitcher />
          </div>
        </div>
      </header>

      <main className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-10 sm:px-6">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top, color-mix(in_oklch,var(--primary)_10%,transparent), transparent_42%)]" />
        <div className="relative w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
