# Cash-Flow Methodology

How Merchant Brain turns a merchant's books into a near-term cash picture, and exactly
how much to trust it.

---

## 1. The core rule

**A forecast is never presented as a fact.** Every result carries:

| Field | Meaning |
|---|---|
| `isProjection: true` | Always true. Assertable programmatically, not inferred from context. |
| `assumptions[]` | Every stated premise, each with an explicit `limitation`. Never empty. |
| `coverage.coverageBps` | Share of projected magnitude backed by a dated obligation. |
| `coverage.quality` | `complete` / `partial` / `insufficient_data`. |
| `coverage.knownGaps[]` | What the data model structurally cannot supply. |
| `openingBalanceSource` | `ledger_derived` or `unavailable`. |

Line items are graded individually:

| `confidence` | Meaning |
|---|---|
| `actual` | Observed in the period from the ledger. A fact. |
| `expected` | A dated obligation with a known amount and due date. A commitment, not yet a fact. |
| `projected` | Extrapolated from history. The weakest tier; always `assumptionBased: true`. |

## 2. Horizon and buckets

- Horizon is clamped to `MAX_HORIZON_DAYS` (400). A caller cannot request a decade.
- Bucket size is **derived**, not chosen by the caller: longer than
  `WEEKLY_HORIZON_MAX_DAYS` (84) → monthly, otherwise weekly. Day buckets are never
  auto-selected; nothing in the schema supports a per-day projection without inventing values.
- Default horizon when a caller supplies an open-ended range: `DEFAULT_HORIZON_DAYS` (90).

## 3. The projection

```
opening cash (ledger-derived, see ANALYTICS_FORMULAS.md §6)
  + collections           open receivables, bucketed by due_date
  + sales_revenue         only with >= 3 prior complete periods
  - supplier_payments     open payables, bucketed by due_date
  - operating_expenses    dated expenses + expanded recurring expenses
  = projected balance per bucket
```

### Inflows

**`collections`** — every open receivable placed in the bucket containing its `due_date`.
Confidence `expected`: amount and date are known, collection is not. A receivable already
past due is placed in the **first** bucket, not dropped: that money still leaves the
account, and hiding it would understate the merchant's exposure. The item records the
original due date and days overdue.

**`sales_revenue`** — projected **only** when at least `MIN_HISTORY_PERIODS` (3) prior
complete periods exist. Value is the mean of those periods, scaled to the bucket's day
length, confidence `projected`, always accompanied by an explicit assumption. With less
history there is **no sales line at all** and the omission is recorded as an assumption.
A missing forecast is more honest than a fabricated one.

### Outflows

**`supplier_payments`** — open payables by due date, confidence `expected`.

**`operating_expenses`** — recognised non-recurring expenses already dated inside the
horizon, plus every occurrence of a recurring expense. The **first** occurrence is read
from the record; later occurrences are **derived from the stored frequency** and are
flagged `assumptionBased`, which dilutes coverage. Recurrence is bounded by
`MAX_RECURRING_OCCURRENCES` (60) so a malformed daily record cannot spin.

### What is deliberately not projected

Loan repayments, tax payments beyond an expense record, and discretionary stock
purchases have no representation in the schema. They are **absent rather than guessed**,
and named in `knownGaps`.

## 4. Coverage

```
coverageBps = round(non-assumption-based magnitude / total projected magnitude × 10000)
```

| Situation | `quality` |
|---|---|
| Total magnitude 0 | `insufficient_data` |
| Some magnitude assumed | `partial` |
| Everything dated | `complete` |

## 5. Risks

| Type | Rule | Severity |
|---|---|---|
| `negative_balance` | Running balance `< 0` at any bucket end. `projectedShortfall` is the absolute deficit. | `critical` |
| `low_balance` | Running balance `< calculateLowBalanceThreshold(avgMonthlyOutflow)` and `>= 0`. | `warning` |
| `payment_spike` | One bucket's outflows `>= 2×` the **median** bucket outflow. | `warning` |
| `high_concentration` | One counterparty holds **> 50%** of horizon receivables or payables, with at least two counterparties. | `warning` |

Threshold constants: `PAYMENT_SPIKE_MULTIPLIER = 2`, `CONCENTRATION_RISK_BPS = 5000`,
`calculateLowBalanceThreshold = round(avgMonthlyOutflow × 0.1)` (a one-week buffer).

Design choices worth stating:

- The spike baseline is the **median**, not the mean, so one genuine spike cannot raise
  the baseline and mask itself.
- Concentration is **strictly greater** than half. An even 50/50 split is not a
  concentration risk.
- When opening cash cannot be derived, an `info` risk is raised instead of presenting
  balances that are known to be wrong.

A negative balance is never also reported as a low balance: running out of buffer is a
signal to act, running negative is the failure itself.

## 6. Always-present assumptions

Every projection states at least one assumption, even a fully obligation-backed one:

- `obligations-settle-on-due-date` — every receivable and payable settles in full on its
  recorded due date. No collection behaviour is modelled.
- `partial-coverage` — added whenever coverage is below 100%.
- `sales-revenue-historical-average` — added when sales are extrapolated.
- `recurring-expense-derivation` — added when recurring expenses are expanded.
- `opening-balance-unavailable` — added when cash could not be derived.

## 7. Known limitations

1. **Opening cash is a ledger proxy.** There is no bank reconciliation.
2. **No collection behaviour.** Every receivable is assumed to settle on time.
3. **No elasticity, seasonality or growth** in the sales extrapolation: a flat mean.
4. **Forecast metadata is not persisted.** `cash_flow_forecasts` has no column for
   assumptions or coverage, so a forecast reopened from storage reports them through an
   explicit "not persisted" fallback rather than pretending it still knows them. A fresh
   `forecast()` call returns them in full.
5. **The `periods` JSONB is validated on read.** Every field is rebuilt explicitly and a
   malformed row throws rather than poisoning a merchant-facing balance.

## 8. Purity

`domain/engine.ts` and `domain/rules.ts` are pure: no clock, no repository, no I/O, no
randomness. Identical inputs always produce an identical projection. Time enters only
through an injected `Clock` at the application boundary.