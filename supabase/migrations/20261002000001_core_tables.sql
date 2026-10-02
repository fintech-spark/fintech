-- Merchant Brain: Database Foundation — Core Schema
-- Migration 0001: All 26 canonical tables with PKs, FKs, CHECK constraints, NOT NULL
--
-- Table creation order respects FK dependencies.
-- Deletion behavior is deliberately chosen per relationship:
--   RESTRICT  — prevent parent deletion when children exist (financial core)
--   CASCADE   — auto-delete children with parent (derived/disposable data)
--   SET NULL  — preserve child but nullify reference (optional links)
--
-- Money is stored as bigint minor units (e.g., paise for INR, cents for USD).
-- Quantities are numeric(20,3) to support fractional units (kg, liter, etc.).
-- Enum-like values use text + CHECK constraints (not PG ENUMs) for flexibility.

-- ============================================================================
-- Migration tracking table (internal)
-- ============================================================================
CREATE TABLE IF NOT EXISTS _migrations (
  id          serial PRIMARY KEY,
  filename    text    NOT NULL,
  checksum    text    NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_migrations_filename ON _migrations (filename);

-- ============================================================================
-- 1. businesses — tenant root; every business-owned record traces here
-- ============================================================================
CREATE TABLE businesses (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  type                  text NOT NULL CHECK (type IN ('retail','wholesale','manufacturing','services','food_beverage','other')),
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  -- BusinessProfile (flattened)
  display_name          text,
  industry              text,
  address               text,
  phone                 text,
  email                 text,
  gstin                 text,
  pan                   text,
  -- BusinessSettings (flattened)
  currency              text NOT NULL DEFAULT 'INR' CHECK (currency IN ('INR','USD','EUR','GBP')),
  fiscal_year_start     integer NOT NULL DEFAULT 1 CHECK (fiscal_year_start BETWEEN 1 AND 12),
  timezone              text NOT NULL DEFAULT 'Asia/Kolkata',
  low_stock_threshold   integer NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  overdue_threshold_days integer NOT NULL DEFAULT 30 CHECK (overdue_threshold_days >= 0),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. users — application-level user profile (Supabase Auth handles credentials)
-- ============================================================================
CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_users_email UNIQUE (email)
);

-- ============================================================================
-- 3. business_members — links users to businesses with role
-- ============================================================================
CREATE TABLE business_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          text NOT NULL CHECK (role IN ('owner','admin','manager','accountant','staff')),
  status        text NOT NULL DEFAULT 'invited' CHECK (status IN ('active','invited','removed')),
  joined_at     timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_business_members_biz_user UNIQUE (business_id, user_id)
);

-- ============================================================================
-- 4. suppliers — vendor master (before products due to FK)
-- ============================================================================
CREATE TABLE suppliers (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id              uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  name                     text NOT NULL,
  contact_name             text,
  phone                    text,
  email                    text,
  address                  text,
  gstin                    text,
  status                   text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  total_purchases_minor    bigint NOT NULL DEFAULT 0 CHECK (total_purchases_minor >= 0),
  outstanding_payable_minor bigint NOT NULL DEFAULT 0,
  currency                 text NOT NULL DEFAULT 'INR' CHECK (currency IN ('INR','USD','EUR','GBP')),
  last_transaction_date    timestamptz,
  version                  integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 5. customers — buyer master
-- ============================================================================
CREATE TABLE customers (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id                uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  name                       text NOT NULL,
  phone                      text,
  email                      text,
  address                    text,
  gstin                      text,
  status                     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  total_purchases_minor      bigint NOT NULL DEFAULT 0 CHECK (total_purchases_minor >= 0),
  outstanding_balance_minor  bigint NOT NULL DEFAULT 0,
  currency                   text NOT NULL DEFAULT 'INR' CHECK (currency IN ('INR','USD','EUR','GBP')),
  last_transaction_date      timestamptz,
  version                    integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 6. products — inventory master
-- ============================================================================
CREATE TABLE products (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  name                 text NOT NULL,
  sku                  text,
  category             text,
  unit                 text NOT NULL CHECK (unit IN ('piece','kg','gram','liter','ml','meter','dozen','box','other')),
  cost_price_minor     bigint NOT NULL CHECK (cost_price_minor >= 0),
  selling_price_minor  bigint NOT NULL CHECK (selling_price_minor >= 0),
  currency             text NOT NULL DEFAULT 'INR' CHECK (currency IN ('INR','USD','EUR','GBP')),
  current_stock        numeric(20,3) NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  reorder_point        numeric(20,3) NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
  reorder_quantity     numeric(20,3) NOT NULL DEFAULT 0 CHECK (reorder_quantity >= 0),
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active','discontinued','out_of_stock')),
  supplier_id          uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  version              integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_products_biz_sku UNIQUE (business_id, sku)
);

-- ============================================================================
-- 7. transactions — sales/purchase/refund ledger
-- ============================================================================
CREATE TABLE transactions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  type                text NOT NULL CHECK (type IN ('sale','purchase','payment','refund')),
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','completed','voided')),
  counterparty_type   text NOT NULL CHECK (counterparty_type IN ('customer','supplier')),
  counterparty_id     text NOT NULL,
  subtotal_minor      bigint NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor      bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_minor           bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor         bigint NOT NULL CHECK (total_minor >= 0),
  currency            text NOT NULL DEFAULT 'INR' CHECK (currency IN ('INR','USD','EUR','GBP')),
  payment_method      text CHECK (payment_method IN ('cash','upi','card','bank_transfer','credit','other')),
  reference           text,
  notes               text,
  idempotency_key     text,
  transaction_date    timestamptz NOT NULL,
  created_by          uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- Financial invariant: total = subtotal - discount + tax
  CONSTRAINT chk_transaction_total CHECK (total_minor = subtotal_minor - discount_minor + tax_minor)
);

-- ============================================================================
-- 8. transaction_items — line items for each transaction
-- ============================================================================
CREATE TABLE transaction_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id   uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  product_id       uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name     text NOT NULL,
  quantity          numeric(20,3) NOT NULL CHECK (quantity > 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  discount_minor   bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_minor         bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor       bigint NOT NULL CHECK (total_minor >= 0),
  -- Line-item invariant: total = unit_price * quantity - discount + tax
  -- (all in minor units, quantity is numeric so multiplication is exact for integers)
  CONSTRAINT chk_transaction_item_total CHECK (
    total_minor = (unit_price_minor * quantity)::bigint - discount_minor + tax_minor
  ),
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 9. expenses — operating expense ledger
-- ============================================================================
CREATE TABLE expenses (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id             uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  category                text NOT NULL CHECK (category IN ('rent','utilities','salaries','supplies','marketing','transportation','insurance','maintenance','taxes','fees','other')),
  amount_minor            bigint NOT NULL CHECK (amount_minor >= 0),
  currency                text NOT NULL DEFAULT 'INR' CHECK (currency IN ('INR','USD','EUR','GBP')),
  description             text NOT NULL,
  vendor                  text,
  reference               text,
  status                  text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','paid')),
  expense_date            timestamptz NOT NULL,
  is_recurring            boolean NOT NULL DEFAULT false,
  recurring_frequency     text CHECK (recurring_frequency IN ('daily','weekly','monthly','quarterly','yearly')),
  recurring_next_due_date timestamptz,
  recurring_end_date      timestamptz,
  idempotency_key         text,
  created_by              uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  -- If recurring, frequency and next due date must be present
  CONSTRAINT chk_expenses_recurring CHECK (
    (NOT is_recurring) OR (recurring_frequency IS NOT NULL AND recurring_next_due_date IS NOT NULL)
  )
);

-- ============================================================================
-- 10. inventory_movements — append-only stock change ledger
-- ============================================================================
CREATE TABLE inventory_movements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  product_id      uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  type            text NOT NULL CHECK (type IN ('purchase','sale','return','adjustment','damage','transfer')),
  quantity        numeric(20,3) NOT NULL CHECK (quantity > 0),
  previous_stock  numeric(20,3) NOT NULL CHECK (previous_stock >= 0),
  new_stock       numeric(20,3) NOT NULL CHECK (new_stock >= 0),
  reference       text,
  reference_type  text CHECK (reference_type IN ('transaction','adjustment','return')),
  reference_id    text,
  created_by      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 11. receivables — outstanding customer payments
-- ============================================================================
CREATE TABLE receivables (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  customer_id        uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  transaction_id     text NOT NULL,
  amount_minor       bigint NOT NULL CHECK (amount_minor >= 0),
  paid_amount_minor  bigint NOT NULL DEFAULT 0 CHECK (paid_amount_minor >= 0),
  currency           text NOT NULL DEFAULT 'INR' CHECK (currency IN ('INR','USD','EUR','GBP')),
  due_date           timestamptz NOT NULL,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','partial','paid','overdue','written_off')),
  paid_date          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- Paid amount cannot exceed total amount
  CONSTRAINT chk_receivables_paid CHECK (paid_amount_minor <= amount_minor)
);

-- ============================================================================
-- 12. payables — outstanding supplier payments
-- ============================================================================
CREATE TABLE payables (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  supplier_id        uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  transaction_id     text NOT NULL,
  amount_minor       bigint NOT NULL CHECK (amount_minor >= 0),
  paid_amount_minor  bigint NOT NULL DEFAULT 0 CHECK (paid_amount_minor >= 0),
  currency           text NOT NULL DEFAULT 'INR' CHECK (currency IN ('INR','USD','EUR','GBP')),
  due_date           timestamptz NOT NULL,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','partial','paid','overdue')),
  paid_date          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_payables_paid CHECK (paid_amount_minor <= amount_minor)
);

-- ============================================================================
-- 13. supplier_pricing — supplier-specific product pricing
-- ============================================================================
CREATE TABLE supplier_pricing (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  supplier_id          uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  product_id           uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_price_minor     bigint NOT NULL CHECK (unit_price_minor >= 0),
  currency             text NOT NULL DEFAULT 'INR' CHECK (currency IN ('INR','USD','EUR','GBP')),
  min_order_quantity   numeric(20,3),
  last_updated         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_supplier_pricing UNIQUE (business_id, supplier_id, product_id)
);

-- ============================================================================
-- 14. documents — uploaded financial document metadata
-- ============================================================================
CREATE TABLE documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  source_type     text NOT NULL CHECK (source_type IN ('invoice','receipt','upi_screenshot','pdf','audio','csv','excel','whatsapp_export','text','image','other')),
  file_name       text NOT NULL,
  mime_type       text NOT NULL,
  file_size       bigint NOT NULL CHECK (file_size > 0),
  storage_path    text NOT NULL,
  status          text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','validating','queued','processing','extracted','review_required','approved','rejected','failed')),
  -- DocumentMetadata (flattened)
  original_name   text,
  content_hash    text,
  page_count      integer,
  language        text,
  extraction_id   text,
  rejection_reason text,
  tags            text[] DEFAULT '{}',
  uploaded_by     uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 15. ingestion_jobs — document processing pipeline state
-- ============================================================================
CREATE TABLE ingestion_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  document_id   uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  state         text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','validating','storing','extracting','normalizing','deduplicating','review','approved','completed','failed')),
  source_type   text NOT NULL,
  steps         jsonb NOT NULL DEFAULT '[]'::jsonb,
  result        jsonb,
  error         text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  created_by    uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT
);

-- ============================================================================
-- 16. document_extractions — structured extraction results
-- ============================================================================
CREATE TABLE document_extractions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  document_id         uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','validated','rejected','failed')),
  fields              jsonb NOT NULL DEFAULT '[]'::jsonb,
  overall_confidence  text CHECK (overall_confidence IN ('high','medium','low')),
  model_used          text NOT NULL,
  raw_output          text,
  extracted_at        timestamptz NOT NULL DEFAULT now(),
  validated_at        timestamptz
);

-- ============================================================================
-- 17. document_embeddings — RAG vector chunks (requires pgvector)
-- ============================================================================
CREATE TABLE document_embeddings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  document_id   uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content       text NOT NULL,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Embedding dimension 1536 (OpenAI text-embedding-3-small / similar).
  -- Update via migration if a different model is selected.
  embedding     vector(1536),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 18. profit_leaks — detected financial leakage points
-- ============================================================================
CREATE TABLE profit_leaks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  category        text NOT NULL CHECK (category IN ('supplier_cost_increase','margin_compression','excessive_discounting','dead_inventory','high_payment_fees','abnormal_expenses','overdue_receivables','low_margin_products')),
  severity        text NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  title           text NOT NULL,
  description     text NOT NULL,
  impact_minor    bigint NOT NULL CHECK (impact_minor >= 0),
  currency        text NOT NULL DEFAULT 'INR' CHECK (currency IN ('INR','USD','EUR','GBP')),
  impact_period   text NOT NULL,
  evidence        jsonb NOT NULL DEFAULT '[]'::jsonb,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','acknowledged','resolved','dismissed')),
  detected_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 19. cash_flow_forecasts — liquidity projections
-- ============================================================================
CREATE TABLE cash_flow_forecasts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  period_start         timestamptz NOT NULL,
  period_end           timestamptz NOT NULL,
  periods              jsonb NOT NULL DEFAULT '[]'::jsonb,
  starting_cash_minor  bigint NOT NULL,
  ending_cash_minor    bigint NOT NULL,
  currency             text NOT NULL DEFAULT 'INR' CHECK (currency IN ('INR','USD','EUR','GBP')),
  risks                jsonb NOT NULL DEFAULT '[]'::jsonb,
  calculated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_cash_flow_period CHECK (period_end > period_start)
);

-- ============================================================================
-- 20. scenarios — what-if simulation results
-- ============================================================================
CREATE TABLE scenarios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  name          text NOT NULL,
  description   text,
  parameters    jsonb NOT NULL DEFAULT '[]'::jsonb,
  baseline      jsonb NOT NULL,
  projected     jsonb NOT NULL,
  comparison    jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','calculated','expired')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 21. actions — proposed remediation actions
-- ============================================================================
CREATE TABLE actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  type            text NOT NULL CHECK (type IN ('adjust_price','reorder_stock','send_reminder','change_supplier','reduce_expense','create_transaction','custom')),
  title           text NOT NULL,
  description     text NOT NULL,
  status          text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','drafted','awaiting_approval','approved','executing','completed','failed','cancelled')),
  source          text NOT NULL CHECK (source IN ('ai_recommendation','profit_leak','cash_flow_risk','manual')),
  parameters      jsonb NOT NULL DEFAULT '{}'::jsonb,
  result          jsonb,
  idempotency_key text,
  created_by      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at     timestamptz,
  executed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 22. action_logs — append-only execution trail for actions
-- ============================================================================
CREATE TABLE action_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id   uuid NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  status      text NOT NULL,
  message     text,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 23. chat_sessions — Business Brain conversation sessions
-- ============================================================================
CREATE TABLE chat_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at        timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 24. chat_messages — individual messages in chat sessions
-- ============================================================================
CREATE TABLE chat_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content     text NOT NULL,
  tools_used  jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence    jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 25. notifications — user-facing alert inbox
-- ============================================================================
CREATE TABLE notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          text NOT NULL CHECK (type IN ('profit_leak_detected','cash_flow_risk','action_proposed','action_completed','document_processed','low_stock_alert','overdue_payment','review_required','system')),
  title         text NOT NULL,
  message       text NOT NULL,
  severity      text NOT NULL CHECK (severity IN ('critical','warning','info','success')),
  status        text NOT NULL DEFAULT 'unread' CHECK (status IN ('unread','read','dismissed')),
  action_url    text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  read_at       timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 26. audit_logs — append-only compliance audit trail
-- ============================================================================
CREATE TABLE audit_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  action          text NOT NULL CHECK (action IN ('create','update','delete','approve','reject','execute','upload','extract','login','view')),
  resource_type   text NOT NULL CHECK (resource_type IN ('transaction','expense','product','customer','supplier','document','action','scenario','business_setting','user','brain_query')),
  resource_id     text NOT NULL,
  before          jsonb,
  after           jsonb,
  metadata        jsonb,
  ip              text,
  user_agent      text,
  timestamp       timestamptz NOT NULL DEFAULT now()
);
