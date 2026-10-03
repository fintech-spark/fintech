# Analytics Formulas

Authoritative definitions for every financial figure Merchant Brain reports. The
deterministic engine owns these numbers; the model may describe them and must never
recompute them.

Every monetary value is an integer count of **currency minor units** (`Money.amount`).
For INR that is paise: `50000` is ₹500.00. No floating-point arithmetic is used for
authoritative money anywhere in this layer.

---

## 1. Periods

| Rule | Definition |
|---|---|
| Convention | **Half-open**: `from` inclusive, `to` exclusive. `[2026-01-01, 2026-02-01)` is January. |
| Timezone | Business `timezone` column, default `Asia/Kolkata`. A stored zone this runtime does not recognise falls back to the default **and reports `fallback: true`**. |
| Storage | All timestamps are `timestamptz`. No local-time storage. |
| Comparison | Previous **equivalent** period: the window of identical length immediately preceding, derived from exact duration so it is correct across DST. Passing whole calendar months therefore compares whole calendar months. |
| Bucketing | Day / week / month boundaries are computed in the reporting timezone, never the server's. |

`DateRange` is half-open everywhere in the public API. Adjacent periods join without
double counting, which is why no query uses `<=` on an upper bound.

## 2. Recognition: what counts

### Transactions

| Status | Counted | Why |
|---|---|---|
| `completed` | yes | The merchant has performed it. |
| `confirmed` | yes | Committed but not settled; still revenue. |
| `draft` | **no** | Not yet committed. |
| `voided` | **no** | Cancelled. |

### Expenses

| Status | Counted |
|---|---|
| `paid`, `approved` | yes |
| `pending`, `rejected` | no |

### Receivables / payables

Open: `pending`, `partial`, `overdue`. Closed: `paid`, `written_off` (receivables only).
Open balance = `amount_minor - paid_amount_minor`.

### Currency

A period containing more than one currency **cannot be aggregated** and the read throws.
There is no FX rate table in the schema, so adding paise to cents would fabricate a total.

## 3. Revenue

All figures are integer minor units.

```
grossRevenue        = Σ subtotal_minor                (list price, pre-discount, pre-tax)
discounts           = Σ discount_minor
netRevenue          = grossRevenue - discounts        (revenue actually earned, pre-tax)
taxCollected        = Σ tax_minor                     (held for the government, not earned)
totalInvoiced       = netRevenue + taxCollected
refunds             = Σ total_minor  where type = 'refund'   and status recognised
effectiveNetRevenue = netRevenue - refunds
```

**Tax is excluded from revenue.** Sales tax is collected on behalf of the government;
including it would inflate revenue and every margin derived from it.

**Refunds are netted, not reported separately.** The schema has `CHECK (total_minor >= 0)`,
so a refund cannot be a negative sale row. Netting is the only representation that does
not double count. `refunds` is still exposed separately for display.

**A period with no recognised sales reports `insufficient_data`, not zero.** The metric
list `revenue`, `average_order_value` and `refund_rate` appear in
`snapshot.unavailableMetrics`, and `readMetric()` returns `undefined` for them.

## 4. Cost of goods

`transaction_items` has **no cost column**. Cost is derived per line from the product's
current `cost_price_minor`:

```
cogsMinor(line) = round(cost_price_minor × quantity)
cogs            = Σ cogsMinor(line)
```

A line with no linked product, or with no recorded cost, is counted as **uncosted**
rather than as zero cost. Quality degrades honestly:

| Uncosted lines | `quality` |
|---|---|
| 0 of N | `complete` |
| some of N | `partial` |
| all of N, or no sales | `insufficient_data` |

A `partial` or `insufficient_data` COGS puts `cogs`, `gross_profit`, `gross_margin`,
`net_profit` and `net_margin` into `unavailableMetrics`.

> **Known limitation.** Using the *current* cost price means a cost change is applied
> retroactively to the whole period. A historical-cost basis would need a cost snapshot
> per line, which the schema does not store.

## 5. Margins and profit

```
grossProfit = netRevenue - cogs
grossMargin = round(grossProfit / netRevenue × 10000)   bps, undefined when revenue = 0
netProfit   = grossProfit - operatingExpenses
netMargin   = round(netProfit   / netRevenue × 10000)   bps, undefined when revenue = 0
```

Rates are **basis points** (1 bps = 0.01%). A percentage is never stored or summed.

## 6. Other metrics

| Metric | Formula |
|---|---|
| `average_order_value` | `round((grossRevenue - discounts - refunds) / saleCount)`, undefined when `saleCount = 0` |
| `refund_rate` | `round(refunds / grossRevenue × 10000)` bps |
| `inventory_value` | `Σ round(cost_price_minor × current_stock)` |
| `working_capital` | `openReceivables - openPayables`; **undefined** when neither table has any record |
| `cash_position` | `ledgerCash + receivables - payables` |
| `receivables` / `payables` | open balances at the period end |
| `overdue_receivables` | open balances with `due_date < period end` |

### Derived cash

The schema has **no bank or cash-account table**, so cash is derived from the ledger:

```
cash in  = Σ total_minor  where type IN ('sale', 'payment')   and status recognised
cash out = Σ total_minor  where type IN ('purchase', 'refund') and status recognised
         + Σ amount_minor from expenses where status IN ('approved', 'paid')

netMovement  = cash in - cash out
closingCash  = openingCash + netMovement
```

This is a **ledger proxy, not a bank reconciliation**, and is labelled as such. The
scan window is bounded to `MAX_CASH_WINDOW_DAYS` (730).

## 7. Period-over-period change

`MetricDelta.changeBps` is interpreted by the metric's own unit:

| Metric unit | `changeBps` means |
|---|---|
| `ratio_bps` (margins, rates) | **absolute** move in bps. A margin falling 40% → 30% is `-1000`, not `-2500`. Only the absolute figure matches "margin fell 10 points". |
| `minor_units`, `count`, `quantity` | **relative** change, `round((current - previous) / \|previous\| × 10000)`. |

A missing figure or a missing baseline yields `direction: 'unavailable'` and **no**
percentage. A zero baseline yields no percentage either. This is what stops the model
narrating "revenue is unchanged" about a figure that does not exist.

## 8. Safety and query rules

Every analytics query:

- filters `business_id = $1` with the tenant as a bound parameter;
- uses `[from, to)` predicates, never `<= to`;
- is a single grouped statement — no per-row queries, so no N+1;
- is bounded with `LIMIT` set from a constant, not from caller input;
- never interpolates a value into SQL. The `text[]` bind formatter **rejects** any value
  containing a character outside `[A-Za-z0-9_]` rather than escaping it.

The analytics layer holds **no write path at all**. Its repository interface exposes
only reads, which is what structurally prevents a metrics read from mutating data.

## 9. What this layer never does

- It does not accept a `businessId` argument. Tenant identity comes from `TenantContext`.
- It does not return a zero for an unknown figure.
- It does not fabricate a gross/net distinction the merchant did not record.
- It does not ask a model for a number.