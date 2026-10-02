// Merchant Brain: a card title that is actually a heading.
//
// shadcn's `CardTitle` renders a `<div>`. In this product a card title is a
// section title, and a screen-reader user navigating by heading would skip
// every card in the app. The interface guidelines require semantic HTML before
// ARIA, so this renders a real `<h3>` with the same visual treatment rather
// than bolting `role="heading"` onto a div.
//
// Levels: `<h1>` is the page title (PageHeader), `<h2>` is a page section
// (SectionHeader), `<h3>` is a card inside a section. Use `level` only when a
// card sits directly under the page title.

import { cn } from "@/lib/utils";

export function CardHeading({
  level = 3,
  className,
  children,
}: {
  /** Heading level. Defaults to `h3`. */
  readonly level?: 2 | 3 | 4;
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  const Tag = `h${level}` as const;
  return (
    <Tag
      className={cn(
        // Matches shadcn's `card-title` so a heading looks identical to a
        // `CardTitle` did, without pretending a div is a heading.
        "font-heading text-base leading-snug font-medium text-card-foreground",
        className,
      )}
    >
      {children}
    </Tag>
  );
}