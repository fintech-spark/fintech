-- Merchant Brain: Deterministic Development Seed Data
-- File: supabase/seed.sql
--
-- This file is for LOCAL DEVELOPMENT AND TESTING ONLY.
-- It is NOT a migration — run via: npm run db:seed
-- or: supabase db seed
--
-- All data is synthetic. No real merchant names, PII, or financial details.
-- Uses deterministic UUIDs so tests can reference them without lookups.

-- ============================================================================
-- Test business (retail)
-- ============================================================================
INSERT INTO businesses (id, name, type, status, display_name, industry, currency, timezone)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Test Retail Store',
  'retail',
  'active',
  'Test Retail Store',
  'retail',
  'INR',
  'Asia/Kolkata'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Test user (business owner)
-- ============================================================================
INSERT INTO users (id, email, name)
VALUES (
  'b0000000-0000-0000-0000-000000000001',
  'owner@test.example',
  'Test Owner'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Business membership (owner role)
-- ============================================================================
INSERT INTO business_members (id, business_id, user_id, role, status)
VALUES (
  'c0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001',
  'owner',
  'active'
)
ON CONFLICT (business_id, user_id) DO NOTHING;

-- ============================================================================
-- Test supplier
-- ============================================================================
INSERT INTO suppliers (id, business_id, name, contact_name, phone, status, currency)
VALUES (
  'd0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'Test Supplier Co',
  'Test Contact',
  '+919999999999',
  'active',
  'INR'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Test customer
-- ============================================================================
INSERT INTO customers (id, business_id, name, phone, status, currency)
VALUES (
  'e0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'Test Customer',
  '+918888888888',
  'active',
  'INR'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Test products
-- ============================================================================
INSERT INTO products (id, business_id, name, sku, unit, cost_price_minor, selling_price_minor, currency, current_stock, reorder_point, reorder_quantity, status, supplier_id)
VALUES
  (
    'f0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'Test Product A',
    'SKU-001',
    'piece',
    8000,   -- ₹80.00 cost
    12000,  -- ₹120.00 selling
    'INR',
    50,
    10,
    20,
    'active',
    'd0000000-0000-0000-0000-000000000001'
  ),
  (
    'f0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000001',
    'Test Product B',
    'SKU-002',
    'kg',
    5000,   -- ₹50.00 cost
    7500,   -- ₹75.00 selling
    'INR',
    5,      -- below reorder point for low-stock testing
    10,
    15,
    'active',
    NULL
  )
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Test expense
-- ============================================================================
INSERT INTO expenses (id, business_id, category, amount_minor, currency, description, status, expense_date, created_by)
VALUES (
  '10000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'rent',
  2500000,  -- ₹25,000.00
  'INR',
  'Test office rent',
  'approved',
  '2026-10-01T00:00:00+05:30',
  'b0000000-0000-0000-0000-000000000001'
)
ON CONFLICT (id) DO NOTHING;
