// Merchant Brain: shell for the authentication screens.
//
// One layout for sign-in and sign-up so the two screens cannot drift into two
// different visual languages. It is intentionally outside the dashboard shell:
// an unauthenticated visitor has no business context to render.

import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { APP_NAME } from "@/components/layout/nav-config";

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-foreground"
          >
            <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
            {APP_NAME}
          </Link>
          <span className="text-xs text-muted-foreground">
            Your business, understood
          </span>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
