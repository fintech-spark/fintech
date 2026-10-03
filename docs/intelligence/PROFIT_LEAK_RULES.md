# Profit-Leak Rules

Every rule, threshold and formula the detector set uses, plus what was deliberately not
implemented and why.

---

## 1. A leak is a measurement

Every detected leak carries:

| Field | Purpose |
|---|---|
| `calculation.rule` | Stable machine id, matches `LeakCategory`. |
| `calculation.ruleDescription` | The rule in words, including its threshold. |
| `calculation.formula` | The arithmetic, as a string, for the "Why am I seeing this?" panel. |
| `calculation.inputs` | Every figure the rule was applied to. |
| `calculation.observedValue` / `baselineValue` / `deviation` | The comparison, with its unit. |
| `calculation.periodStart` … `comparisonPeriodEnd` | Both windows, so the claim is attributable. |
| `evidence[]` | Typed source references. At least one per leak; three for aggregate claims. |
| `relatedRecordIds[]` | Distinct ids the evidence cites, for deep links. |
| `suggestedInvestigation` | Where to look next. A pointer, never an instruction to act. |

"Sales look bad" is not an acceptable leak.

## 2. False-positive control

Every detector is gated by `suppressionReason`. A detector that stays quiet reports **why**,
in `suppressed[]`. Silence is never presented as "no problem found".

| Gate | Condition | Reason reported |
|---|---|---|
| Baseline sample | `< MIN_BASELINE_SAMPLE_SIZE` (5) | `insufficient_sample_size` |
| Current sample | `< MIN_SAMPLE_SIZE` (5) | `insufficient_sample_size` |
| No baseline | baseline absent | `no_baseline_period` |
| Zero baseline | baseline `= 0` for a proportional rule | `zero_baseline` |
| Below threshold | deviation too small | `threshold_not_met` |
| Threshold not met (secondary) | e.g. discount rate rise too small | `threshold_not_met` |
| Product too new | age `< PRODUCT_MIN_AGE_DAYS` (30) | `recently_created` |
| No source data | no products, sales or receivables to examine | `no_source_data` |

### Threshold comparison is explicitly typed

`ThresholdKind` prevents a mis-comparison that would otherwise fire on every record:

| Kind | Semantics | Example |
|---|---|---|
| `multiple` | `observed >= baseline × threshold` | spend 1.5× its baseline |
| `at_least` | `observed >= threshold` | a 1000 bps discount-rate floor |
| `at_most` | `observed <= threshold` | an absolute ceiling |
| `fall_by_at_least` | `baseline - observed >= threshold` | margin fell ≥ 200 bps |

Inferring the kind from the threshold's numeric value is a bug: `1.5` is a plausible
multiplier *and* a plausible absolute floor.

## 3. Severity bands

Preserved from the module's original published contract, in minor units:

| Severity | Monthly impact | INR equivalent |
|---|---|---|
| `critical` | `>= 5,000,000` | ₹50,000 |
| `high` | `>= 1,000,000` | ₹10,000 |
| `medium` | `>= 200,000` | ₹2,000 |
| `low` | `< 200,000` | under ₹2,000 |

Minimum evidence: **3** items for `margin_compression` and `abnormal_expenses` (aggregate
claims about a whole period), **1** for everything else.

Reported impact is clamped to `MAX_REPORTED_IMPACT_MINOR` (100,000,000).

## 4. The eight detectors

### `margin_compression`

```
rule:     gross margin dropped by >= 200 bps versus the previous equivalent period
gate:     fall_by_at_least, threshold MARGIN_COMPRESSION_BPS = 200
impact:   round(currentRevenue × baselineGrossMarginBps / 10000) - currentGrossProfit
evidence: current margin, baseline margin, COGS comparison  (3 items)
```

### `supplier_cost_increase`

```
rule:     weighted purchase unit price rose by >= 500 bps versus the previous equivalent period
requires: the product was purchased in BOTH periods, so the comparison is like-for-like
impact:   Σ round((currentWeightedUnitPrice - baselineWeightedUnitPrice) × quantitySold)
evidence: current price, baseline price, realised cost  (3 items per product)
```

Uses quantity **actually sold**, so the impact is realised loss rather than hypothetical
stock. Products purchased in only one period are skipped, not guessed.

### `excessive_discounting`

```
rule:     discounts exceed 10% of gross revenue AND the discount rate rose by >= 500 bps
requires: BOTH conditions. A merchant who always discounts heavily has a pricing
          strategy; one who has started discounting more heavily has a leak.
impact:   currentDiscount - round(currentGrossRevenue × baselineDiscountRateBps / 10000)
```

### `abnormal_expenses`

```
rule:     a category total exceeds 1.5x its baseline AND rises by at least 200,000 minor units
impact:   Σ max(0, currentCategoryTotal - baselineCategoryTotal)
evidence: current + baseline per affected category, plus a settlement item  (>= 3 items)
```

A category with no baseline must exceed the absolute minimum on its own, so a brand-new
expense line cannot fire as an "anomaly".

### `low_margin_products`

```
rule:     a product with recorded sales earns < 500 bps gross margin (LOW_MARGIN_FLOOR_BPS)
requires: the product is at least PRODUCT_MIN_AGE_DAYS old
impact:   Σ round((floorMarginPerUnit - unitMargin) × quantitySold)
```

Computed per product so high-volume thin-margin items are fully represented rather than
averaged away.

### `dead_inventory`

```
rule:     active stock with no sale in 90 days and at-cost value >= 200,000 minor units
requires: status = 'active', current_stock > 0, product older than 30 days
impact:   Σ round(costPrice × currentStock)
```

"Sold recently" is defined by one shared 90-day window (`DEAD_STOCK_LOOKBACK_DAYS`) so
every caller agrees on the meaning.

### `overdue_receivables`

```
rule:     open receivables exceed the business overdue threshold in days
requires: status IN ('pending','partial','overdue') AND daysOverdue > businesses threshold
impact:   Σ open balances
```

The threshold is the merchant's own `overdue_threshold_days` (default 30), not a
hardcoded constant, so a merchant who expects 60-day terms is not alarmed.

### `high_payment_fees` — declared unavailable

```
status:   UNAVAILABLE, reported in detectorsUnavailable[]
reason:   transactions.payment_method records HOW a customer paid, not WHAT it cost.
          No fee, charge or settlement column exists anywhere in the schema.
required: transactions.payment_fee_minor, plus a reconciliation source
```

Reporting this rather than skipping it is deliberate: an unavailable check must be visible
to the product owner, not look like a clean result. Producing a number here would mean
inventing it.

## 5. Determinism and idempotency

A leak id is derived from `(businessId, category, periodStart, periodEnd, impactMinor)`.
Re-running detection over an unchanged period therefore **updates the same row** instead of
accumulating duplicates. Two scans of identical data produce byte-identical reports.

## 6. Purity

`domain/detectors.ts` and `domain/rules.ts` are pure: no clock, no repository, no I/O.
They receive gathered facts and return either a leak or a suppression. Time enters only
through the injected `Clock` at the application boundary, so a detector's output is
reproducible.

## 7. Integration

Detection publishes one typed `profit_leak.detected` event per leak on the shared event
bus. Notification delivery subscribes to it; neither module imports the other.