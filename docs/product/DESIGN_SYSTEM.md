# Merchant Brain design system foundation

This is a UI standard, not a product screen specification. It establishes the visual language before product flows are approved.

## Product character

Merchant Brain should feel trustworthy, calm, premium, financial, intelligent, and useful to a busy merchant. Clarity beats spectacle. The system should communicate what is known, what is inferred, and what needs review.

Do not use generic AI visual language: no purple-first palette, neon gradients, glossy glassmorphism, decorative 3D, giant hero typography, dense card grids, random rounded corners, meaningless charts, or motion without a comprehension benefit.

## Tokens

Use the semantic shadcn tokens in `app/globals.css` rather than raw Tailwind colors:

- Surfaces: `background`, `card`, `popover`, `muted`.
- Text: `foreground`, `card-foreground`, `muted-foreground`.
- Actions: `primary` and `primary-foreground` for the main action; `secondary` for supporting actions.
- Structure: `border`, `input`, and `ring`.
- Risk: `destructive` only for destructive or urgent states.
- Charts: `chart-1` through `chart-5`; use a small, consistent series palette with a legend.

Future theme changes update tokens, not one-off component colors. Status meanings must remain stable: positive, caution, negative, neutral, and pending are semantic concepts and must not rely on color alone.

### Status scale (implemented)

Five semantic tones, each a `--*-subtle` / `--*-border` / `--*-foreground`
triple in `app/globals.css`. Never a raw colour, never colour alone:

| Tone | Meaning | Example status |
|---|---|---|
| `positive` | A good business outcome | Paid, Confirmed, Healthy |
| `caution` | Needs attention | Needs review, Part paid, Overdue balance |
| `negative` | Serious risk or destructive action | Rejected, Out of stock, Overdue |
| `pending` | Waiting on a person or a process | Needs review, Reading |
| `info` | Informational context | Understood, Not connected yet |
| `neutral` | No signal | Voided, Inactive |

The vocabulary itself — every label and its plain-language meaning — lives in
`lib/format/status.ts`, one table per backend union.
`tests/frontend/status.test.ts` fails if a backend status has no label, so the
two can never drift.

The page surface also sits one step below its cards (`--background` vs
`--card`, with a hairline ring) so elevation reads without shadows.

### Layout utilities

Safe-area and overscroll handling are named Tailwind utilities — `pb-safe-bottom`,
`px-safe-inline`, `overscroll-contain` — rather than inline styles, so
`shadcn/no-inline-styles` can stay enabled and the handling is reviewable in one
place.

## Typography

- Use one readable sans family for UI and a restrained monospace face for IDs, reference numbers, and technical values.
- Use a compact type scale: display only for a single page purpose, `h1` for the page title, `h2` for sections, `h3` for grouped content, and body text for decisions.
- Use `tabular-nums` for currency, quantities, percentages, and dates aligned in tables.
- Keep line length around 60–80 characters for explanatory copy. Do not use all caps for long text.
- Use plain, merchant-friendly words. Explain a financial term before abbreviating it.

## Spacing and layout

- Use a predictable 4px-based spacing scale and `gap-*` for layout. Avoid `space-x-*` and `space-y-*`.
- Establish one page container and consistent horizontal padding per breakpoint. Do not let every page invent its own max width.
- Prefer a readable content column plus intentional secondary context over a dashboard wall of equal cards.
- Use CSS grid for page structure and flexbox for rows/toolbars. Keep mobile layouts single-column unless a two-column relationship remains understandable.
- Define responsive behavior at content breakpoints, not device-name breakpoints.

## Components

- Prefer shadcn primitives and compose them: `Button`, `Card`, `Table`, `Tabs`, `Dialog`, `Sheet`, `Alert`, `Badge`, `Skeleton`, `Empty`, `Separator`, and form `Field` primitives.
- Keep a component's visual ownership in the component. Pages control placement and layout; variants control component treatment.
- Use `cn()` for conditional classes, semantic tokens, and the configured Lucide icon library.
- Icons are supporting signals, not labels. Use `aria-label` when an icon-only button has no visible label. Icons inside Buttons use the shadcn `data-icon` convention.
- Use consistent radii from `--radius` and its derived tokens. No per-component radius experiments.
- Borders should define grouping; shadows should be rare and tied to elevation or an overlay. Never use shadows to compensate for weak hierarchy.

## Data and charts

- Every chart must answer a decision-relevant question and name its period, unit, and data state.
- Prefer a table or key metric alongside a chart. Never imply precision that the source data does not support.
- Use legends, accessible labels, tooltips, and non-color distinctions. Support reduced motion and keyboard access where chart interaction exists.
- Show missing, partial, stale, and conflicting data explicitly.

## Required states

Every future interaction should specify:

- **Loading:** stable layout using `Skeleton` or an equivalent announced state; never pretend data is ready.
- **Empty:** explain why it is empty and offer the next useful action without fake sample data.
- **Error:** plain-language cause, safe retry, and a support/reference ID when applicable; no stack traces.
- **Success:** confirm what changed and what happens next.
- **Destructive:** use `AlertDialog`, describe consequence, require deliberate confirmation, and never hide the cancel path.
- **Disabled:** explain why when the reason is not obvious; never use disabled state as authorization.

## Forms and accessibility

- Every control has a visible or programmatically associated label, clear instructions, validation, and recovery.
- Use `FieldGroup`/`Field` composition, `aria-invalid`, `aria-describedby`, and server-side validation. Do not rely on placeholder text as a label.
- Preserve entered values on recoverable errors. Use correct `autocomplete`, input modes, and numeric formats.
- Maintain visible `:focus-visible`, logical tab order, semantic landmarks, keyboard-operable dialogs/menus, minimum touch targets, and sufficient contrast.
- Respect `prefers-reduced-motion`; animation may clarify state but may not block work.

## AI-specific interface patterns

- Separate verified facts, calculations, model interpretation, and recommendations visually and semantically.
- Every important insight should expose a **Why am I seeing this?** affordance with evidence IDs and source records.
- Show freshness, coverage, conflicts, and confidence based on evidence quality, not a model's self-reported certainty.
- Mark drafts as drafts. A prepared action is not an executed action. Use clear `Review`, `Confirm`, and `Cancel` steps.
- Let a user correct extracted fields before downstream calculations. Preserve the original source and the correction history.
- Stream text only when partial text is useful; do not stream financial totals or actions as if they are already verified.

## Review gate

Before merging UI, review it against this document, the current Vercel Web Interface Guidelines, shadcn component guidance, keyboard behavior, responsive states, and synthetic accessibility checks. A polished screenshot is not sufficient evidence.
