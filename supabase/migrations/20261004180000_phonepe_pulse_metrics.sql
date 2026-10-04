-- PhonePe Pulse public analytics metrics.
--
-- Source: https://github.com/PhonePe/pulse (Q1 2018 – Q2 2026).
-- One row = one metric observation: a quarter, a geography, a dataset kind and
-- an optional breakdown segment. The data is public, national benchmark data —
-- NOT tenant data. There is deliberately no business_id column, and none may
-- be added: tenant isolation applies to merchant records, and mixing a global
-- reference dataset into that model would weaken both.
--
-- NOTE ON 20261004141652_add_phonepe_pulse.sql: that file is 0 bytes and is
-- recorded as applied in the migration history, so it created nothing. It is
-- left byte-identical (editing an applied migration would trip the drift gate
-- in scripts/migrate.mjs). This migration is the real implementation.
--
-- Money: `transaction_amount` is denominated in rupees exactly as the source
-- publishes it (the upstream values carry fractional paise). It is external
-- benchmark data and is intentionally NOT a Merchant Brain `Money` value —
-- merchant ledger money stays integer minor units in bigint `_minor` columns.
-- Nothing in the application ever adds this figure to a merchant's own money.

CREATE TABLE public.phonepe_pulse_metrics (
  source_key        text PRIMARY KEY,
  dataset_type      text NOT NULL,
  category          text NOT NULL,
  scope             text NOT NULL,
  year              smallint NOT NULL,
  quarter           smallint NOT NULL,
  geo_level         text NOT NULL,
  geo_name          text NOT NULL,
  parent_geo_name   text,
  segment           text,
  metric_type       text,
  rank              smallint,
  transaction_count bigint,
  transaction_amount numeric(24, 3),
  registered_count  bigint,
  source_file       text NOT NULL,
  ingested_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phonepe_pulse_metrics_dataset_ck
    CHECK (dataset_type IN ('transaction', 'user', 'merchant')),
  CONSTRAINT phonepe_pulse_metrics_category_ck
    CHECK (category IN ('aggregated', 'map', 'top')),
  CONSTRAINT phonepe_pulse_metrics_scope_ck
    CHECK (scope IN ('country', 'state')),
  CONSTRAINT phonepe_pulse_metrics_year_ck
    CHECK (year >= 2000 AND year <= 2100),
  CONSTRAINT phonepe_pulse_metrics_quarter_ck
    CHECK (quarter BETWEEN 1 AND 4),
  CONSTRAINT phonepe_pulse_metrics_geo_level_ck
    CHECK (geo_level IN ('country', 'state', 'district')),
  CONSTRAINT phonepe_pulse_metrics_rank_ck
    CHECK (rank IS NULL OR rank >= 1),
  CONSTRAINT phonepe_pulse_metrics_transaction_count_ck
    CHECK (transaction_count IS NULL OR transaction_count >= 0),
  CONSTRAINT phonepe_pulse_metrics_transaction_amount_ck
    CHECK (transaction_amount IS NULL OR transaction_amount >= 0),
  CONSTRAINT phonepe_pulse_metrics_registered_count_ck
    CHECK (registered_count IS NULL OR registered_count >= 0),
  CONSTRAINT phonepe_pulse_metrics_metric_present_ck
    CHECK (
      transaction_count IS NOT NULL
      OR transaction_amount IS NOT NULL
      OR registered_count IS NOT NULL
    )
);

-- Period scans (the dashboard always filters by dataset + quarter).
CREATE INDEX idx_phonepe_pulse_metrics_period
  ON public.phonepe_pulse_metrics (dataset_type, year, quarter);

-- Geography scans: state/district ranking and trend lookups.
CREATE INDEX idx_phonepe_pulse_metrics_geo
  ON public.phonepe_pulse_metrics (dataset_type, geo_level, geo_name, year, quarter);

-- Category scans: aggregated vs map vs top breakdowns.
CREATE INDEX idx_phonepe_pulse_metrics_category
  ON public.phonepe_pulse_metrics (category, dataset_type, year, quarter);

-- Parent lookups: roll districts up to their state.
CREATE INDEX idx_phonepe_pulse_metrics_parent
  ON public.phonepe_pulse_metrics (parent_geo_name)
  WHERE parent_geo_name IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Security: read-only for application roles.
--
-- Follows the conventions of 20261002000004_rls_tenant_isolation.sql: enable
-- + FORCE row level security and policy-scoped access. Unlike the tenant
-- tables the policy is `TO authenticated USING (true)` because the rows are
-- global — there is no tenant predicate to express. No INSERT/UPDATE/DELETE
-- policy exists, so RLS denies every write for non-owner roles even if a
-- grant were widened by mistake.
--
-- The importer writes as the table owner (superuser over DATABASE_URL), which
-- RLS does not apply to; FORCE still binds the owner for ordinary roles.
-- ---------------------------------------------------------------------------
ALTER TABLE public.phonepe_pulse_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phonepe_pulse_metrics FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS phonepe_pulse_metrics_select_authenticated
  ON public.phonepe_pulse_metrics;

CREATE POLICY phonepe_pulse_metrics_select_authenticated
  ON public.phonepe_pulse_metrics
  FOR SELECT
  TO authenticated
  USING (true);

-- Least privilege: no role may write through the API roles; only the owner
-- (the migration/importer connection) can modify rows.
REVOKE ALL ON TABLE public.phonepe_pulse_metrics FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.phonepe_pulse_metrics
  FROM authenticated, service_role;
GRANT SELECT ON TABLE public.phonepe_pulse_metrics TO authenticated;
