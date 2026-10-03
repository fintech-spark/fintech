-- Merchant Brain: Intelligence-owned detail columns
-- Migration 0004: columns the intelligence and actions repositories persist but
-- migration 0001 never created.
--
-- Found by live database verification against PostgreSQL 16 (mb-verify): every
-- read and write in modules/profit-leaks, modules/simulator and modules/actions
-- failed with pgCode 42703 (undefined_column) because these columns were absent.
-- Static inspection of the SQL could not catch it; only executing the statements did.
--
-- `detail` is an additive jsonb envelope. It carries fields that belong to the
-- owning module but have no column of their own:
--   profit_leaks.detail -> calculation, suggestedInvestigation, relatedRecordIds
--   scenarios.detail    -> currency, periodStart, periodEnd, assumptions,
--                          rejections, quality, cashTiming
--   actions.detail      -> relatedLeakId, relatedRiskId, parametersHash
--
-- `actions.currency` is promoted to a real column because money is stored in
-- minor units and a currency is a fact about the amount, not metadata.
--
-- All additions are defaulted, so existing rows stay valid and the repositories'
-- own placeholder fallbacks (asDetail / asOptionalDate) cover rows written before
-- this migration.

-- ============================================================================
-- profit_leaks.detail — detection provenance and the exact calculation
-- ============================================================================
ALTER TABLE profit_leaks
  ADD COLUMN IF NOT EXISTS detail jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN profit_leaks.detail IS
  'Detection provenance: calculation (rule/formula/inputs/periods), suggestedInvestigation, relatedRecordIds.';

-- ============================================================================
-- scenarios.detail — projection metadata that is not part of the three snapshots
-- ============================================================================
ALTER TABLE scenarios
  ADD COLUMN IF NOT EXISTS detail jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN scenarios.detail IS
  'Projection metadata: currency, periodStart, periodEnd, assumptions, rejections, quality, cashTiming.';

-- ============================================================================
-- actions.currency — reporting currency for the action amount
-- ============================================================================
ALTER TABLE actions
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'INR';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_actions_currency') THEN
    ALTER TABLE actions
      ADD CONSTRAINT chk_actions_currency
      CHECK (currency IN ('INR','USD','EUR','GBP'));
  END IF;
END $$;

-- ============================================================================
-- actions.detail — links back to the intelligence record that caused the action,
-- plus the parameter hash recorded at approval time for tamper detection.
-- ============================================================================
ALTER TABLE actions
  ADD COLUMN IF NOT EXISTS detail jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN actions.detail IS
  'relatedLeakId, relatedRiskId, and parametersHash captured at approval for tamper detection.';

-- The approval-time parameter hash is read on every execution precondition check,
-- so it needs an index to stay a single-row lookup.
CREATE INDEX IF NOT EXISTS idx_actions_parameters_hash
  ON actions (business_id, ((detail->>'parametersHash')))
  WHERE detail->>'parametersHash' IS NOT NULL;

-- ============================================================================
-- action_logs — the audit trail was never writable
--
-- Migration 0001 created action_logs as (id, action_id, status, message,
-- metadata, created_at). The action repository writes a 16-column row
-- describing WHO moved an action from WHICH state to WHICH state, under WHICH
-- authorisation, and with WHICH parameter hash. Twelve of those columns did not
-- exist, and `status` was NOT NULL with no default, so every insert failed.
-- Verified on mb-verify: `action_logs` was empty, so nothing is lost here.
--
-- This is not a convenience change. `AI_CONTEXT.md` requires the sequence
-- proposal -> authorization -> approval -> execution -> audit, and the audit
-- half of that sequence could not execute at all.
--
-- `business_id` is ADDED deliberately. The row now carries its own tenant, so
-- RLS can scope the audit trail directly instead of relying on a join through
-- `actions`. That is strictly stronger isolation than inheriting the tenant via
-- the parent foreign key, and it makes `listAudit(business_id, action_id)` a
-- single-table tenant-scoped read.
--
-- `reason` and `outcome` are constrained so a denial cannot be recorded as a
-- success, and `parameters_hash` is required because tamper detection compares
-- it against a recomputed hash on every execution.
-- ============================================================================
ALTER TABLE action_logs
  ADD COLUMN IF NOT EXISTS business_id      uuid REFERENCES businesses(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS from_status      text,
  ADD COLUMN IF NOT EXISTS to_status        text,
  ADD COLUMN IF NOT EXISTS outcome          text,
  ADD COLUMN IF NOT EXISTS actor_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actor_role       text,
  ADD COLUMN IF NOT EXISTS actor_is_machine boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reason           text,
  ADD COLUMN IF NOT EXISTS parameters_hash  text,
  ADD COLUMN IF NOT EXISTS executor_id      text,
  ADD COLUMN IF NOT EXISTS idempotency_key  text,
  ADD COLUMN IF NOT EXISTS correlation_id   text;

-- Every existing row predates this migration and has no tenant recorded, so the
-- column becomes NOT NULL only after the backfill below.
UPDATE action_logs
   SET business_id = a.business_id
  FROM actions a
 WHERE action_logs.action_id = a.id
   AND action_logs.business_id IS NULL;

DELETE FROM action_logs WHERE business_id IS NULL;

ALTER TABLE action_logs
  ALTER COLUMN business_id SET NOT NULL,
  ALTER COLUMN to_status SET NOT NULL,
  ALTER COLUMN outcome SET NOT NULL,
  ALTER COLUMN actor_role SET NOT NULL,
  ALTER COLUMN parameters_hash SET NOT NULL,
  ALTER COLUMN correlation_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_action_logs_outcome') THEN
    ALTER TABLE action_logs
      ADD CONSTRAINT chk_action_logs_outcome
      CHECK (outcome IN ('allowed', 'denied'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_action_logs_statuses') THEN
    ALTER TABLE action_logs
      ADD CONSTRAINT chk_action_logs_statuses
      CHECK (
        (from_status IS NULL OR from_status IN
          ('proposed','drafted','awaiting_approval','approved','executing','completed','failed','cancelled'))
        AND to_status IN
          ('proposed','drafted','awaiting_approval','approved','executing','completed','failed','cancelled')
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_action_logs_machine_actor') THEN
    ALTER TABLE action_logs
      ADD CONSTRAINT chk_action_logs_machine_actor
      CHECK (NOT actor_is_machine OR actor_id IS NULL);
  END IF;
END $$;

-- `status` and `metadata` are vestigial: nothing in modules/ reads either, and
-- `status` being NOT NULL with no default is precisely what blocked every
-- insert. `metadata` is left in place because it is nullable and harmless;
-- `status` must go for the trail to be writable at all.
ALTER TABLE action_logs DROP COLUMN IF EXISTS status;

COMMENT ON TABLE action_logs IS
  'Append-only action audit trail. One row per state transition or denial. Never updated, never deleted.';

CREATE INDEX IF NOT EXISTS idx_action_logs_business_created
  ON action_logs (business_id, created_at DESC, id ASC);

CREATE INDEX IF NOT EXISTS idx_action_logs_parameters_hash
  ON action_logs (action_id, parameters_hash)
  WHERE parameters_hash IS NOT NULL;