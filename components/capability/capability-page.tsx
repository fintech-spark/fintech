import { CardHeading } from "@/components/common/card-heading";
import Link from "next/link";
import { ArrowRight, CircleDashed, Database, Workflow } from "lucide-react";

import { CapabilityPanel } from "@/components/common/data-state";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import type { PendingCapability } from "@/lib/api/pending";

export interface AlternativeLink {
  readonly href: string;
  readonly label: string;
  readonly description: string;
}

/**
 * A screen whose backend capability does not exist yet.
 *
 * This is the honest alternative to a plausible-looking dashboard. It answers
 * the four questions a merchant would otherwise be left with: what this screen
 * is for, why it is empty, what is already working that feeds it, and what to
 * do in the meantime. It never shows a placeholder figure.
 */
export function CapabilityPage({
  capability,
  icon,
  title,
  description,
  /** What the screen will do once the capability is connected. */
  promise,
  /** What this product already has that the capability will read. */
  inputs,
  /** Where the merchant can go instead, right now. */
  alternatives,
  /** Extra context specific to this screen. */
  children,
}: {
  readonly capability: PendingCapability;
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly description: string;
  readonly promise: readonly string[];
  readonly inputs: readonly { readonly href: string; readonly label: string }[];
  readonly alternatives: readonly AlternativeLink[];
  readonly children?: React.ReactNode;
}) {
  return (
    <>
      <PageHeader
        title={title}
        description={description}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1.5">
              <CircleDashed aria-hidden="true" className="size-3" />
              Not connected yet
            </Badge>
            <Badge variant="secondary">{capability.phase}</Badge>
          </div>
        }
      />

      <CapabilityPanel capability={capability} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardHeading className="flex items-center gap-2">
              <Workflow aria-hidden="true" className="size-4 text-muted-foreground" />
              What this screen will do
            </CardHeading>
            <CardDescription>
              Written out so you know what you are waiting for, and can tell
              whether a future answer is trustworthy.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {promise.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm">
                  <ArrowRight
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="text-pretty">{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardHeading className="flex items-center gap-2">
              <Database aria-hidden="true" className="size-4 text-muted-foreground" />
              What is already here
            </CardHeading>
            <CardDescription>
              These screens already work. This capability will be calculated from
              them, not from somewhere else.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {inputs.map((input) => (
                <li key={input.href}>
                  <Link
                    href={input.href}
                    className="inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {input.label}
                    <ArrowRight aria-hidden="true" className="size-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardHeading className="flex items-center gap-2">
            {icon}
            What to do instead
          </CardHeading>
          <CardDescription>
            Real things you can check in Merchant Brain today.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3 sm:grid-cols-2">
            {alternatives.map((alternative) => (
              <li key={alternative.href}>
                <Link
                  href={alternative.href}
                  className="flex h-full flex-col gap-1 rounded-lg border border-border p-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="text-sm font-medium">{alternative.label}</span>
                  <span className="text-sm text-muted-foreground">
                    {alternative.description}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {children}
    </>
  );
}
