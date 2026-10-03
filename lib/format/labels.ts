// Merchant Brain: copy and label helpers.
//
// Two jobs:
//   1. Turn backend enums and identifiers into words a merchant can read.
//   2. Keep UNTRUSTED text (customer names, document names, transaction notes,
//      AI-sourced strings) safe to render: React escapes it, and these
//      helpers make sure nothing long or hostile breaks the layout.
//
// Untrusted text is never passed to `dangerouslySetInnerHTML`, never
// interpolated into an attribute that becomes a URL, and never treated as an
// instruction. See `docs/ai/AI_RULES.md`.

/** `not_due_yet` → `Not due yet`. A total fallback for unexpected enum values. */
export function humanizeToken(token: string): string {
  const cleaned = token.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "Unknown";
  const lower = cleaned.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** `ABC Traders` from `abc traders`, without mangling names already cased. */
export function titleCase(value: string): string {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}

/** Truncates to a character budget, appending a real ellipsis. */
export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

/**
 * Splits text for two-line clamping. Used with Tailwind `line-clamp-*`.
 * Returns words, not characters, so the clamp lands on a word boundary.
 */
export function clampToWords(value: string, wordCount: number): string {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length <= wordCount) return value;
  return `${words.slice(0, wordCount).join(" ")}…`;
}

/** Initials for an avatar fallback. Never more than two characters. */
export function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * A short, readable reference for a UUID — the first group only.
 * A merchant never needs the full identifier, but it stays in the DOM as the
 * accessible title so the value is never lost.
 */
export function shortReference(id: string): string {
  return id.slice(0, 8);
}

/** Lowercase words used in navigation and section headings. */
export function sentenceCase(value: string): string {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Renders a value-or-placeholder pair consistently. `null` and `undefined`
 * become an em dash so a gap in the data is visible as a gap.
 */
export function orDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const text = String(value).trim();
  return text.length === 0 ? "—" : text;
}

/**
 * Names an untrusted string for the UI without ever treating it as markup.
 * Control characters are stripped so a crafted document name cannot inject
 * line breaks or terminal escapes into a table cell or a title attribute.
 */
export function safeLabel(value: string | null | undefined, fallback = "—"): string {
  if (value === null || value === undefined) return fallback;
  const cleaned = value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length === 0 ? fallback : truncate(cleaned, 160);
}

/**
 * A merchant-facing explanation of what a value represents. Used as the
 * accessible description on charts so the information is never carried by
 * the visual alone.
 */
export function describeSeries(unit: string, period: string): string {
  return `${unit} over ${period}. The same figures are listed in the table below.`;
}

/** "1 action" / "4 actions" without pulling in a pluralisation dependency. */
export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

/**
 * Builds a sentence a merchant can act on, instead of a raw delta.
 * `formatImpactSentence("Margin", "-2.7 pts")` → "Margin fell by 2.7 pts".
 */
export function describeMovement(
  subject: string,
  direction: "up" | "down" | "flat",
  magnitude: string,
): string {
  if (direction === "flat") return `${subject} did not change`;
  return direction === "up"
    ? `${subject} rose by ${magnitude}`
    : `${subject} fell by ${magnitude}`;
}
/** Merchant-facing names for business types. */
export const BUSINESS_TYPE_LABEL: Readonly<Record<string, string>> = {
  retail: "Retail shop",
  wholesale: "Wholesale",
  manufacturing: "Manufacturing",
  services: "Services",
  food_beverage: "Food and drink",
  other: "Other",
};
