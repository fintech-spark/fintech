---
name: financial-rules-and-money
description: Implement or review anything that computes a business number. Use when touching analytics, cash-flow, profit-leaks, simulator, revenue/COGS/margin/inventory valuation, invoice or expense arithmetic, Money types, rounding, or any rule that turns rows into a figure shown to a merchant. Encodes the integer-minor-unit invariant, the three divergent margin implementations, and which layer is allowed to produce a number.
---

# Financial rules and money

This is a fintech product. A wrong number is a worse bug than a crash: it is silently believed.

## Layer rule

| Layer | Owns | Must never |
|---|---|---|
| PostgreSQL | business facts | be duplicated in app memory |
| domain rules / analytics | **every number** — revenue, profit, margin, balances, totals, deltas, thresholds | delegate arithmetic to a model |
| AI | explanation, interpretation, summary | compute or invent a figure |

If a number reaches a merchant, it came from deterministic TypeScript or SQL. Full stop.

## Money representation

Integer **minor units** (paise), never floats. `createMoney` (`lib/types.ts:33-40`) throws a
`TypeError` on a non-integer — that guard is the invariant, so never bypass it with arithmetic on
raw numbers. `bigint`-backed in SQL; `tests/database-schema.test.ts` asserts every money column is
`bigint` and never float.

`analytics/domain/numeric.ts` is the canonical numeric toolkit: `assertMinorUnits`, `sumMinorUnits`,
`applyBpsToMinorUnits`, `roundHalfAwayFromZero`, `ratioBps`, `weightedAverageMinorUnits`,
`BPS_SCALE = 10_000`.

Revenue/COGS recognition is `analytics/domain/revenue.ts`: `recognizeRevenue`, `recognizeCogs`,
`lineCostMinor`, `openBalanceMinor`, `workingCapitalMinor`, `ledgerCashMovement`. Inventory
valuation is `inventory/domain/rules.ts`: `calculateNewStock`, `calculateInventoryValue`.

## The divergence trap — read before adding any ratio

Margin is implemented **three times** with different behaviour on zero revenue:

| Implementation | Zero-revenue behaviour |
|---|---|
| `analytics/domain/numeric.ts:103` `marginBps` | returns `undefined` |
| `analytics/domain/rules.ts:27` `calculateMarginBps` | returns `0` |
| `inventory/domain/rules.ts:14` `calculateMarginBps` | returns `0` |

`changeBps` is duplicated the same way (`numeric.ts:93` vs `rules.ts:53`): a zero baseline yields
`10_000` in one and `undefined` in the other. `business-brain/application/tools/common.ts:32` has
to alias-import just to disambiguate — and on that AI-facing path **"no revenue" and "zero margin"
are indistinguishable**, which contradicts the intent documented at `analytics/domain/rules.ts:25-26`.

When you need a margin or a delta: prefer `numeric.ts`, state the zero-denominator choice
explicitly, and never let the divergence spread. Consolidating these is a known cleanup.

## Idempotency and state transitions

Money-moving operations must be replay-safe: partial unique indexes on
`transactions`/`expenses`/`actions` plus `executionIdempotencyKey` /
`hashActionParameters` (`actions/domain/rules.ts:324-353`). A unique-violation (SQLSTATE `23505`)
maps to **409**, and repositories treat it as an idempotent replay rather than an error.

Legal transitions live in domain rules and nowhere else:
`transactions/domain/rules.ts:6` `canTransitionTo`,
`documents/domain/rules.ts:3` `canTransitionDocumentTo`,
`actions/domain/rules.ts:27` `canTransitionActionTo` (+ `requiresApproval`, `canCancel`,
`canRetryAction`, `requiresDistinctApprover`, `classifyRisk`).

## Gotchas

- Rounding is **half-away-from-zero** (`roundHalfAwayFromZero`). Do not use `Math.round` on
  negatives — it rounds toward +∞.
- Basis points use `BPS_SCALE = 10_000`; 5% is `500`, not `0.05`.
- `wireIntelligence` computes analytics over raw `pg` with no RLS — a missing `business_id`
  predicate is both a security bug and a wrong-number bug. Run
  `node .agents/skills/tenant-isolation-review/scripts/scan-tenant-safety.mjs`.
- Simulator scenarios are what-if **projections**, never persisted actuals. Do not let a scenario
  result flow back into a ledger.
- Format at the edge only: `lib/format/money.ts` (`formatMoney`, `formatMinorUnits`). Store and
  compute minor units; never a formatted string.

## Validation

```bash
npx vitest run tests/intelligence
npm run test:db            # schema-level money CHECK constraints
npm run typecheck && npm test
```

New arithmetic needs a test that pins the zero/negative/boundary case explicitly — that is exactly
where the existing duplicates disagree.
