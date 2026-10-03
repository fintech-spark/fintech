import { CardHeading } from "@/components/common/card-heading";
import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BrainCircuit,
  Calculator,
  CircleDollarSign,
  Eye,
  FileText,
  ShieldCheck,
} from "lucide-react";

import { APP_NAME } from "@/components/layout/nav-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export const metadata: Metadata = {
  title: "Merchant Brain — your business, understood",
  description:
    "Merchant Brain reads the business records a small merchant already has, explains what changed and why, and prepares safe actions for the merchant to approve.",
};

/**
 * The loop the whole product is built around. Stated here in the order a
 * merchant actually experiences it, because "see → understand → verify →
 * simulate → act → approve → execute → review" is the product, not a slogan.
 */
const LOOP = [
  {
    icon: Eye,
    title: "See",
    body: "Money owed to you, money you owe, stock, and anything waiting on you — in one place.",
  },
  {
    icon: BrainCircuit,
    title: "Understand",
    body: "What changed, and why, in language a merchant would actually use.",
  },
  {
    icon: BadgeCheck,
    title: "Verify",
    body: "Every claim carries the records behind it. Check the evidence instead of trusting a score.",
  },
  {
    icon: Calculator,
    title: "Simulate",
    body: "Try a price change and see the effect, before you commit to it.",
  },
  {
    icon: ShieldCheck,
    title: "Approve",
    body: "Nothing irreversible happens without an explicit yes from you.",
  },
  {
    icon: CircleDollarSign,
    title: "Act",
    body: "The result is recorded, and you can see what actually happened.",
  },
] as const;

export default function Home() {
  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to main content
      </a>

      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 md:px-6">
          <p className="text-sm font-semibold tracking-tight">{APP_NAME}</p>
          <Button asChild size="sm">
            <Link href="/overview">
              Open the app
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="focus-visible:outline-none">
        <section className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-14 md:px-6 md:py-20">
          <Badge variant="secondary" className="w-fit">
            For small merchants in India
          </Badge>
          <h1 className="max-w-prose text-balance text-3xl font-semibold tracking-tight md:text-4xl">
            Your business records already exist. Merchant Brain is what makes
            them make sense.
          </h1>
          <p className="max-w-prose text-pretty text-base text-muted-foreground">
            Invoices, receipts, UPI screenshots, spreadsheets and a lot of memory.
            Merchant Brain reads what you already have, tells you what changed and
            why, and prepares the next step — with your approval before anything
            happens.
          </p>
          <p className="max-w-prose text-pretty text-sm text-muted-foreground">
            &ldquo;Don&rsquo;t make the merchant learn software — make the software
            understand the merchant.&rdquo;
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/overview">
                Open Merchant Brain
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/documents">See what works today</Link>
            </Button>
          </div>
        </section>

        <section
          aria-labelledby="loop-heading"
          className="border-y border-border bg-surface-sunken"
        >
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-12 md:px-6">
            <div className="flex flex-col gap-2">
              <h2 id="loop-heading" className="text-xl font-semibold tracking-tight">
                One loop, not thirty screens
              </h2>
              <p className="max-w-prose text-pretty text-sm text-muted-foreground">
                Every part of the product exists to move a merchant along this
                path. A screen that does not advance it is not a screen we build.
              </p>
            </div>
            <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {LOOP.map((step) => (
                <li key={step.title}>
                  <Card size="sm" className="h-full">
                    <CardHeader>
                      <div className="flex items-center gap-2">
                        <step.icon
                          aria-hidden="true"
                          className="size-4 text-muted-foreground"
                        />
                        <CardHeading>{step.title}</CardHeading>
                      </div>
                      <CardDescription className="text-pretty">
                        {step.body}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="built-heading" className="mx-auto max-w-6xl px-4 py-12 md:px-6">
          <h2 id="built-heading" className="text-xl font-semibold tracking-tight">
            How it is built
          </h2>
          <p className="mt-2 max-w-prose text-pretty text-sm text-muted-foreground">
            These are not marketing claims. They are the rules the product is
            built to obey.
          </p>
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <Principle
              title="Numbers are calculated, never guessed"
              body="Revenue, profit, margin, balances and stock levels come from deterministic rules over your records. A model explains them; it never computes them."
            />
            <Principle
              title="Every claim carries its evidence"
              body="If Merchant Brain says something about your business, it can point at the records that prove it. No evidence means no claim."
            />
            <Principle
              title="You approve; it never acts alone"
              body="Reminders, reorders and changes are drafted, then wait for you. A prepared action is visibly not a completed one."
            />
          </div>
        </section>

        <section className="border-t border-border">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-10 md:px-6">
            <Separator />
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileText aria-hidden="true" className="size-3.5" />
              Merchant Brain is under active development. Parts of the product are
              not connected yet, and the app says so on the screen rather than
              showing you an empty dashboard.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

function Principle({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <Card size="sm" className="h-full">
      <CardHeader>
        <CardHeading>{title}</CardHeading>
        <CardDescription className="text-pretty">{body}</CardDescription>
      </CardHeader>
    </Card>
  );
}
