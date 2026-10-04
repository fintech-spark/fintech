# Merchant Brain frontend

How the merchant-facing interface is built, and the rules that keep it honest.
Read this before adding a screen or a component.

The governing documents are [`../product/DESIGN_SYSTEM.md`](../product/DESIGN_SYSTEM.md)
(visual language) and [`AI_CONTEXT.md`](../../AI_CONTEXT.md) (what the product is
and what it must never do). This file records what has actually been built.

---

## 1. The one rule

> **The frontend presents authoritative values. It never produces them.**

Revenue, margin, balances, stock levels, severity and simulation results are
computed by deterministic code and the database. This layer formats what it is
given. `lib/format/money.ts` contains no arithmetic beyond converting minor
units at the presentation boundary — that is the point.

Two consequences that are easy to get wrong:

| Situation | Wrong | Right |
|---|---|---|
| A reorder suggestion | `Order 50 · ₹420` (reads as a ₹420 order) | `Order 50 at ₹420 each` |
| A margin move | `+15%` | `+2.7 pts` — see `formatPointChange` |
| A missing amount | `₹0.00` | `—`, plus `No amount available` for screen readers |

---

## 2. Layers

```
app/(marketing)/page.tsx     public entry point, no shell
app/(dashboard)/             every authenticated screen
  layout.tsx                 → components/layout/app-shell.tsx
  actions.ts                 "use server" — business switch only
components/ui/               shadcn primitives (exempt from token lint rules)
components/common/           design-system components used by every screen
components/data/             tables, filters, URL-backed view state
components/<domain>/         business components (inventory, customers, …)
components/layout/           shell, navigation, command palette
lib/api/                     SERVER ONLY — typed client for approved contracts
lib/format/                  pure presentation helpers (isomorphic)
```

`lib/api/client.ts` imports `server-only`. A Client Component that imports it
fails the build, which is deliberate: the session cookie and tenant derivation
must never reach the browser.

---

## 3. Navigation

One declarative list, `components/layout/nav-config.ts`, drives the sidebar, the
mobile bar, the command palette and the skip link. Adding a screen means adding
one entry — never editing four places.

Groups answer the merchant's actual question rather than listing features
alphabetically: **Daily operations**, **Business intelligence**, **Business
Brain**, **Actions**, **Settings**.

Mobile gets a five-item bottom bar plus a sheet, not a squeezed sidebar. Items
in the bottom bar carry a `shortLabel` because "Ask Merchant Brain" truncates to
"Ask Merch…" at 390px.

---

## 4. Every screen has the same five states

`components/common/data-state.tsx` takes a discriminated union, so a page cannot
forget a state — TypeScript rejects an unhandled branch.

| State | What it must do |
|---|---|
| `loading` | Skeleton matching the real layout, in a live region, with contextual copy ("Reading your inventory…") |
| `ready` | The data, plus a partial-data notice when some of it is missing |
| `empty` | Say what it means and what to do next. Never "No data" |
| `error` | Plain-language cause, a recovery path, a support reference. Never a status code or class name |
| `unavailable` | The capability's backend does not exist yet — see §6 |

Partial failure is a first-class state. `lib/api/settle.ts` runs independent
reads together and settles them individually, so one failure cannot blank the
other four, and the screen says which figures are missing.

---

## 5. Money, dates and status

All three live in `lib/format/` as pure functions, unit-tested in
`tests/frontend/`.

- **Money** — integer minor units in, localized string out. Indian lakh
  grouping. Compact notation is opt-in and always keeps the exact figure
  reachable (`formatMoneyCompact`).
- **Dates** — `Intl.DateTimeFormat` only. `parseDateInput` builds a *local*
  calendar day, because `new Date("2026-03-01")` is UTC midnight and renders as
  the previous day for most of the world. `resolvePeriod` makes the reporting
  window explicit and bounded.
- **Status** — one table per backend union in `lib/format/status.ts`. Every
  entry carries a merchant-facing `label`, a written `description`, and a
  `tone`. Colour is the third signal, never the only one.
  `tests/frontend/status.test.ts` fails if a backend status has no label.

`stockLevel()` is a **label**, not a business rule. The authoritative
"needs reorder" set is `GET /api/inventory/low-stock`; the UI only labels rows
the backend already flagged.

---

## 6. Capabilities that are not built yet

`lib/api/pending.ts` is the single, honest catalogue of screens whose backend
does not exist: analytics roll-ups, profit leaks, cash-flow forecasts, the
simulator, Business Brain answers, actions, notifications, audit, evidence, the
document upload path, the expense ledger and the sales ledger.

Each entry names the capability in merchant language, says why it is empty, says
what the merchant can do instead, and records the owning workstream and phase.

**This is the rule the whole approach rests on:** PRODUCT_SPEC.md excludes "fake
dashboards, fake AI answers, or unverified business facts used to make a demo
look complete", and AI_CONTEXT.md §10.1 forbids inventing endpoints to make a
feature look complete. So the app states the gap instead of filling it. There
is no demo mode, no fixture fallback and no placeholder chart — a test enforces
this (`tests/frontend/security.test.ts`).

---

## 7. The approval boundary

`app/(dashboard)/documents/actions.ts` + `components/documents/document-review.tsx`
implement the one live review → approve → execute path. The rules:

1. **Nothing is optimistic.** Buttons disable and show a spinner; the state
   shown is whatever the server returned. No code path sets a local status to
   "approved" before the server agrees.
2. **The consequence is stated before the click.** The confirmation names the
   document and says it will become part of the merchant's records. The cancel
   path is always present.
3. **Rejection requires a reason**, and the dialog *stays open* when the reason
   is missing — it is a `Button`, not an `AlertDialogAction`, precisely so the
   explanation is not dismissed along with the dialog.
4. **Indeterminate is its own state.** If the request fails in a way that leaves
   the outcome unknown, the screen says "We could not confirm whether your
   decision was recorded" and offers a way to check the real status. It never
   guesses either way, because a wrong guess makes a merchant re-approve
   something already approved.
5. **Idempotency keys** are derived from the document id and the decision, so a
   double-tap cannot record two decisions.

---

## 8. Tenant safety

- `businessId` comes from `GET /api/auth/session`, never from a URL or a body.
- The active-business choice lives in an **httpOnly** cookie written by a server
  action that checks the id against the session first. A forged value is
  rejected, not stored. The cookie is a preference, not an authorisation.
- Every read is `no-store`. There is no cached tenant fragment for a business
  switch to reveal.
- `assertInternalUrl` refuses to forward the session cookie to any origin the
  deployment did not name for itself: `API_INTERNAL_BASE_URL`, or the
  `VERCEL_URL` Vercel injects for the build. Neither is read from the request,
  so a forged `Host` cannot move the cookie.
- `tests/e2e/navigation.spec.ts` proves a `?businessId=` in the URL never
  reaches a request.

---

## 9. Responsive and accessibility

Tables are one component with three honest behaviours: full table ≥ `sm`,
reduced columns at narrow widths, and **the same rows as record cards** on a
phone — built from the same row objects, so a figure cannot differ between
phone and desktop.

Accessibility is enforced, not aspirational:

- Real headings throughout. shadcn's `CardTitle` renders a `<div>`, so
  `components/common/card-heading.tsx` provides a real `<h3>` with the same
  treatment — semantic HTML before ARIA.
- A skip link on the shell, the marketing page and the 404.
- `:focus-visible` is defined globally in `app/globals.css`; `outline-none`
  without a focus replacement is an ESLint error.
- Status is label + icon + written description, never colour alone.
- `prefers-reduced-motion` is honoured globally.
- `touch-action: manipulation` and safe-area utilities are named Tailwind
  utilities (`pb-safe-bottom`), not inline styles — which keeps
  `shadcn/no-inline-styles` enabled.
- Tables and `[data-numeric]` use `tabular-nums`.
- Mobile overflow is asserted, not eyeballed: `merchant-journeys.spec.ts`
  checks `scrollWidth - clientWidth <= 1` on every list screen at 390px.

---

## 10. Testing

| Layer | Where | What it protects |
|---|---|---|
| Unit | `tests/frontend/*.test.ts` | Money, dates, status vocabulary, wire contracts, security invariants |
| E2E | `tests/e2e/*.spec.ts` | The merchant journeys, all data states, responsive, keyboard |
| Security | `tests/frontend/security.test.ts` | 15 invariants that are easy to reintroduce by accident |

### Why E2E uses a stub server

Every API call is made from a React Server Component, so it leaves the Next.js
process — not the browser — and Playwright's `page.route` cannot see it. Rather
than move data fetching into the client (which would put tenant data in the
browser and weaken the architecture), the tests point the server-side fetcher at
a synthetic backend via `API_INTERNAL_BASE_URL`:

```
tests/e2e/fixtures/data.ts     synthetic records (reserved 11111111-… UUIDs)
tests/e2e/fixtures/router.ts   pure (method, url, scenario) → response
tests/e2e/fixtures/stub-server.ts   http server wrapping the router
tests/e2e/global-setup.ts      starts it for the run
```

The app runs completely unmodified through the real `lib/api/client.ts` path —
session forwarding, envelope decoding and the same-origin guard included. The
scenario travels in a cookie, so parallel workers cannot interfere.

**Production contains no mock data, no demo mode and no fixture fallback.** A
test asserts this.

### Running

```bash
npm run lint && npm run typecheck && npm test && npm run build   # full gate
npm run test:e2e                                                  # 39 journeys
```

E2E runs against a **production build** (`next build && next start`). Only the
production bundle exercises the real client/server boundary, so a broken
client-side navigation cannot hide behind Fast Refresh.

---

## 11. Conventions

- Server Components by default. `"use client"` only where interactivity demands
  it, and only on the leaf.
- `icon` props take an **element** (`<Boxes aria-hidden />`), never a component
  type. A component object cannot be serialised across the RSC boundary; React
  rejects it at runtime with a warning that is easy to misread.
- No arbitrary Tailwind values and no inline styles outside `components/ui/`
  (enforced by `shadcn/no-arbitrary-values` and `shadcn/no-inline-styles`).
- No `any`, no `@ts-ignore`, no blanket `eslint-disable` (enforced by test).
- Prefer editing an existing document over creating a parallel one.

---

## 12. Known gaps

| Gap | Why | Owner |
|---|---|---|
| No charts | There is no approved aggregation route, so every chart would be drawn from data the app does not have | Intelligence + Automation |
| No AI response UI | `business-brain` has no approved route; a chat box that cannot answer is worse than none | AI / ML |
| No action center | The action lifecycle is not connected; document confirmation is the live boundary | Intelligence + Automation |
| No period selector in the UI | `resolvePeriod` is ready, but no endpoint consumes `from`/`to` yet | Backend |
| No dark-mode toggle | `.dark` tokens exist and are correct; no product requirement for a toggle | — |