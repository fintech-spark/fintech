-- Merchant Brain: Demo Seed for the "Sharma General Store" account
-- File: supabase/seed-demo-sharma-general-store.sql
--
-- This file is NOT a migration and is NOT part of `npm run db:seed`.
-- It populates one real demo business with a small, internally consistent
-- sample of merchant data so the Overview dashboard renders real figures:
-- revenue, COGS, margin, expenses, receivables, payables, inventory value,
-- low stock and documents awaiting review.
--
-- Apply to the linked (remote) project:
--   npx supabase db query --linked --file supabase/seed-demo-sharma-general-store.sql
-- Apply to the local stack:
--   npx supabase db query --local --file supabase/seed-demo-sharma-general-store.sql
--
-- Properties:
--   * Looks the business up by name and skips cleanly (RAISE NOTICE) when the
--     business does not exist, so the same file is safe on any environment.
--   * Uses deterministic UUIDs and `ON CONFLICT DO NOTHING`, so re-running it
--     never duplicates rows and a partial run can simply be repeated.
--   * All money is integer minor units (paise). Every row satisfies the table
--     CHECK constraints, notably:
--       transactions.total = subtotal - discount + tax
--       transaction_items.total = unit_price * quantity - discount + tax
--   * Every sale line links to a product with a cost price, so COGS is fully
--     costed (`quality = complete`) instead of `insufficient_data`.
--   * Sale/expense dates fall inside the last 30 days, which is the default
--     reporting window of GET /analytics/snapshot.
--   * Recognised expense statuses are `approved` and `paid`; `pending` and
--     `rejected` rows are included deliberately so the expense breakdown shows
--     that non-recognised work exists without inflating the total.

DO $seed$
DECLARE
  v_business_id  uuid;
  v_user_id      uuid;
BEGIN
  -- ---------------------------------------------------------------------
  -- 0. Resolve the target business and an acting member.
  -- ---------------------------------------------------------------------
  SELECT b.id INTO v_business_id
  FROM businesses b
  WHERE b.name = 'Sharma General Store';

  IF v_business_id IS NULL THEN
    RAISE NOTICE 'Sharma General Store not found; nothing seeded.';
    RETURN;
  END IF;

  SELECT bm.user_id INTO v_user_id
  FROM business_members bm
  WHERE bm.business_id = v_business_id
  ORDER BY (bm.role = 'owner') DESC, bm.created_at
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Sharma General Store has no member rows; nothing seeded.';
    RETURN;
  END IF;

  -- ---------------------------------------------------------------------
  -- 1. Supplier master
  -- ---------------------------------------------------------------------
  INSERT INTO suppliers (id, business_id, name, contact_name, status, total_purchases_minor, outstanding_payable_minor, currency)
  VALUES
    ('de000000-0000-4000-a000-000000000001', v_business_id, 'Gupta Wholesale Traders',   'Rakesh Gupta',  'active', 0, 0, 'INR'),
    ('de000000-0000-4000-a000-000000000002', v_business_id, 'Aggarwal Snacks Distributors', 'Vinod Aggarwal', 'active', 0, 0, 'INR'),
    ('de000000-0000-4000-a000-000000000003', v_business_id, 'Neelam Beverage Supply',    'Neelam Arora',  'active', 0, 0, 'INR'),
    ('de000000-0000-4000-a000-000000000004', v_business_id, 'Kamlesh Dairy Distributors', 'Kamlesh Yadav', 'active', 0, 0, 'INR')
  ON CONFLICT DO NOTHING;

  -- ---------------------------------------------------------------------
  -- 2. Customer master
  -- ---------------------------------------------------------------------
  INSERT INTO customers (id, business_id, name, status, total_purchases_minor, outstanding_balance_minor, currency)
  VALUES
    ('de000000-0000-4000-a000-000000000011', v_business_id, 'Verma Household',        'active', 0, 0, 'INR'),
    ('de000000-0000-4000-a000-000000000012', v_business_id, 'Singh Grocery Corner',   'active', 0, 0, 'INR'),
    ('de000000-0000-4000-a000-000000000013', v_business_id, 'Khan Tea Stall',         'active', 0, 0, 'INR'),
    ('de000000-0000-4000-a000-000000000014', v_business_id, 'Patel General Store',    'active', 0, 0, 'INR'),
    ('de000000-0000-4000-a000-000000000015', v_business_id, 'Reddy Snacks Parlour',   'active', 0, 0, 'INR'),
    ('de000000-0000-4000-a000-000000000016', v_business_id, 'Iyer Canteen',           'active', 0, 0, 'INR')
  ON CONFLICT DO NOTHING;

  -- ---------------------------------------------------------------------
  -- 3. Product catalogue (cost price < selling price everywhere, so every
  --    sale line is costed and the margin is honest).
  --    MILK-500 and TEA-250 sit at or below their reorder point, which is
  --    what needsReorder() (currentStock <= reorderPoint) keys off.
  -- ---------------------------------------------------------------------
  INSERT INTO products (id, business_id, name, sku, category, unit, cost_price_minor, selling_price_minor, currency, current_stock, reorder_point, reorder_quantity, status, supplier_id)
  VALUES
    ('de000000-0000-4000-a000-000000000021', v_business_id, 'Aashirvaad Atta 5kg',      'ATTA-5',   'Staples',       'piece', 23000, 25500, 'INR', 120,  40, 60,  'active', 'de000000-0000-4000-a000-000000000001'),
    ('de000000-0000-4000-a000-000000000022', v_business_id, 'Tata Salt 1kg',            'SALT-1',   'Staples',       'piece', 2400,  2800,  'INR', 200,  50, 100, 'active', 'de000000-0000-4000-a000-000000000001'),
    ('de000000-0000-4000-a000-000000000023', v_business_id, 'Amul Milk 500ml',          'MILK-500', 'Dairy',         'piece', 2600,  3000,  'INR', 90,   120, 120, 'active', 'de000000-0000-4000-a000-000000000004'),
    ('de000000-0000-4000-a000-000000000024', v_business_id, 'Fortune Sunflower Oil 1L', 'OIL-1L',   'Staples',       'piece', 13800, 15800, 'INR', 60,   25, 40,  'active', 'de000000-0000-4000-a000-000000000001'),
    ('de000000-0000-4000-a000-000000000025', v_business_id, 'Parle-G Biscuit 12-pack',  'PG-12',    'Snacks',        'box',   9600,  11000, 'INR', 80,   30, 60,  'active', 'de000000-0000-4000-a000-000000000002'),
    ('de000000-0000-4000-a000-000000000026', v_business_id, 'Tata Tea Gold 250g',       'TEA-250',  'Beverages',     'piece', 14500, 16800, 'INR', 50,   60, 60,  'active', 'de000000-0000-4000-a000-000000000003'),
    ('de000000-0000-4000-a000-000000000027', v_business_id, 'Colgate Toothpaste 100g',  'COL-100',  'Personal Care', 'piece', 5200,  6500,  'INR', 100,  40, 60,  'active', 'de000000-0000-4000-a000-000000000001'),
    ('de000000-0000-4000-a000-000000000028', v_business_id, 'Surf Excel 1kg',           'SURF-1K',  'Home Care',     'piece', 11500, 13500, 'INR', 70,   30, 50,  'active', 'de000000-0000-4000-a000-000000000001'),
    ('de000000-0000-4000-a000-000000000029', v_business_id, 'Maggi Noodles 7-pack',     'MAG-7',    'Snacks',        'box',   7800,  9500,  'INR', 90,   30, 60,  'active', 'de000000-0000-4000-a000-000000000002'),
    ('de000000-0000-4000-a000-000000000030', v_business_id, 'Bisleri Water 1L',         'BIS-1L',   'Beverages',     'piece', 1800,  2400,  'INR', 300,  100, 200, 'active', 'de000000-0000-4000-a000-000000000003')
  ON CONFLICT DO NOTHING;

  -- ---------------------------------------------------------------------
  -- 4. Restock purchases (cost prices on the line items)
  -- ---------------------------------------------------------------------
  INSERT INTO transactions (id, business_id, type, status, counterparty_type, counterparty_id, subtotal_minor, discount_minor, tax_minor, total_minor, currency, payment_method, reference, transaction_date, created_by)
  VALUES
    ('de000000-0000-4000-a000-000000000041', v_business_id, 'purchase', 'completed', 'supplier', 'de000000-0000-4000-a000-000000000001',
     1334000, 0, 0, 1334000, 'INR', 'bank_transfer', 'PO-2026-0906', '2026-09-06T10:00:00+05:30', v_user_id),
    ('de000000-0000-4000-a000-000000000042', v_business_id, 'purchase', 'completed', 'supplier', 'de000000-0000-4000-a000-000000000004',
     260000, 0, 0, 260000, 'INR', 'upi', 'PO-2026-0909', '2026-09-09T09:30:00+05:30', v_user_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO transaction_items (id, transaction_id, product_id, product_name, quantity, unit_price_minor, discount_minor, tax_minor, total_minor)
  VALUES
    ('de000000-0000-4000-a000-000000000061', 'de000000-0000-4000-a000-000000000041', 'de000000-0000-4000-a000-000000000021', 'Aashirvaad Atta 5kg',      40, 23000, 0, 0, 920000),
    ('de000000-0000-4000-a000-000000000062', 'de000000-0000-4000-a000-000000000041', 'de000000-0000-4000-a000-000000000024', 'Fortune Sunflower Oil 1L', 30, 13800, 0, 0, 414000),
    ('de000000-0000-4000-a000-000000000063', 'de000000-0000-4000-a000-000000000042', 'de000000-0000-4000-a000-000000000023', 'Amul Milk 500ml',         100, 2600,  0, 0, 260000)
  ON CONFLICT DO NOTHING;

  -- ---------------------------------------------------------------------
  -- 5. Sales over the last 30 days (status `completed` is a recognised
  --    status; `confirmed` would work equally). Totals satisfy
  --    total = subtotal - discount + tax.
  -- ---------------------------------------------------------------------
  INSERT INTO transactions (id, business_id, type, status, counterparty_type, counterparty_id, subtotal_minor, discount_minor, tax_minor, total_minor, currency, payment_method, reference, transaction_date, created_by)
  VALUES
    ('de000000-0000-4000-a000-000000000043', v_business_id, 'sale', 'completed', 'customer', 'de000000-0000-4000-a000-000000000011',
     130000, 0, 0, 130000, 'INR', 'cash',   'INV-2026-0908', '2026-09-08T11:00:00+05:30', v_user_id),
    ('de000000-0000-4000-a000-000000000044', v_business_id, 'sale', 'completed', 'customer', 'de000000-0000-4000-a000-000000000016',
     320500, 0, 0, 320500, 'INR', 'upi',    'INV-2026-0911', '2026-09-11T12:30:00+05:30', v_user_id),
    ('de000000-0000-4000-a000-000000000045', v_business_id, 'sale', 'completed', 'customer', 'de000000-0000-4000-a000-000000000012',
     300000, 0, 0, 300000, 'INR', 'credit', 'INV-2026-0914', '2026-09-14T10:45:00+05:30', v_user_id),
    ('de000000-0000-4000-a000-000000000046', v_business_id, 'sale', 'completed', 'customer', 'de000000-0000-4000-a000-000000000013',
     432000, 0, 0, 432000, 'INR', 'upi',    'INV-2026-0917', '2026-09-17T17:15:00+05:30', v_user_id),
    ('de000000-0000-4000-a000-000000000047', v_business_id, 'sale', 'completed', 'customer', 'de000000-0000-4000-a000-000000000014',
     460000, 0, 0, 460000, 'INR', 'cash',   'INV-2026-0919', '2026-09-19T16:00:00+05:30', v_user_id),
    ('de000000-0000-4000-a000-000000000048', v_business_id, 'sale', 'completed', 'customer', 'de000000-0000-4000-a000-000000000011',
     183500, 2000, 0, 181500, 'INR', 'upi',  'INV-2026-0921', '2026-09-21T12:00:00+05:30', v_user_id),
    ('de000000-0000-4000-a000-000000000049', v_business_id, 'sale', 'completed', 'customer', 'de000000-0000-4000-a000-000000000015',
     710000, 0, 0, 710000, 'INR', 'credit', 'INV-2026-0924', '2026-09-24T15:30:00+05:30', v_user_id),
    ('de000000-0000-4000-a000-000000000050', v_business_id, 'sale', 'completed', 'customer', 'de000000-0000-4000-a000-000000000014',
     435000, 0, 0, 435000, 'INR', 'cash',   'INV-2026-0927', '2026-09-27T11:20:00+05:30', v_user_id),
    ('de000000-0000-4000-a000-000000000051', v_business_id, 'sale', 'completed', 'customer', 'de000000-0000-4000-a000-000000000016',
     414500, 0, 20725, 435225, 'INR', 'upi', 'INV-2026-0930', '2026-09-30T18:00:00+05:30', v_user_id),
    ('de000000-0000-4000-a000-000000000052', v_business_id, 'sale', 'completed', 'customer', 'de000000-0000-4000-a000-000000000011',
     432400, 0, 0, 432400, 'INR', 'upi',    'INV-2026-1002', '2026-10-02T13:10:00+05:30', v_user_id),
    ('de000000-0000-4000-a000-000000000053', v_business_id, 'sale', 'completed', 'customer', 'de000000-0000-4000-a000-000000000013',
     477500, 0, 0, 477500, 'INR', 'credit', 'INV-2026-1003', '2026-10-03T17:45:00+05:30', v_user_id),
    ('de000000-0000-4000-a000-000000000054', v_business_id, 'sale', 'completed', 'customer', 'de000000-0000-4000-a000-000000000015',
     635000, 0, 0, 635000, 'INR', 'cash',   'INV-2026-1004', '2026-10-04T19:00:00+05:30', v_user_id)
  ON CONFLICT DO NOTHING;

  -- Sale line items (selling prices; each line links to a product so COGS
  -- can be costed from cost_price_minor).
  INSERT INTO transaction_items (id, transaction_id, product_id, product_name, quantity, unit_price_minor, discount_minor, tax_minor, total_minor)
  VALUES
    ('de000000-0000-4000-a000-000000000064', 'de000000-0000-4000-a000-000000000043', 'de000000-0000-4000-a000-000000000021', 'Aashirvaad Atta 5kg',      4, 25500, 0, 0, 102000),
    ('de000000-0000-4000-a000-000000000065', 'de000000-0000-4000-a000-000000000043', 'de000000-0000-4000-a000-000000000022', 'Tata Salt 1kg',            10, 2800,  0, 0, 28000),
    ('de000000-0000-4000-a000-000000000066', 'de000000-0000-4000-a000-000000000044', 'de000000-0000-4000-a000-000000000024', 'Fortune Sunflower Oil 1L', 10, 15800, 0, 0, 158000),
    ('de000000-0000-4000-a000-000000000067', 'de000000-0000-4000-a000-000000000044', 'de000000-0000-4000-a000-000000000029', 'Maggi Noodles 7-pack',     10, 9500,  0, 0, 95000),
    ('de000000-0000-4000-a000-000000000068', 'de000000-0000-4000-a000-000000000044', 'de000000-0000-4000-a000-000000000028', 'Surf Excel 1kg',           5, 13500, 0, 0, 67500),
    ('de000000-0000-4000-a000-000000000069', 'de000000-0000-4000-a000-000000000045', 'de000000-0000-4000-a000-000000000023', 'Amul Milk 500ml',         60, 3000,  0, 0, 180000),
    ('de000000-0000-4000-a000-000000000070', 'de000000-0000-4000-a000-000000000045', 'de000000-0000-4000-a000-000000000030', 'Bisleri Water 1L',        50, 2400,  0, 0, 120000),
    ('de000000-0000-4000-a000-000000000071', 'de000000-0000-4000-a000-000000000046', 'de000000-0000-4000-a000-000000000026', 'Tata Tea Gold 250g',      20, 16800, 0, 0, 336000),
    ('de000000-0000-4000-a000-000000000072', 'de000000-0000-4000-a000-000000000046', 'de000000-0000-4000-a000-000000000030', 'Bisleri Water 1L',        40, 2400,  0, 0, 96000),
    ('de000000-0000-4000-a000-000000000073', 'de000000-0000-4000-a000-000000000047', 'de000000-0000-4000-a000-000000000025', 'Parle-G Biscuit 12-pack', 30, 11000, 0, 0, 330000),
    ('de000000-0000-4000-a000-000000000074', 'de000000-0000-4000-a000-000000000047', 'de000000-0000-4000-a000-000000000027', 'Colgate Toothpaste 100g', 20, 6500,  0, 0, 130000),
    ('de000000-0000-4000-a000-000000000075', 'de000000-0000-4000-a000-000000000048', 'de000000-0000-4000-a000-000000000021', 'Aashirvaad Atta 5kg',      5, 25500, 0, 0, 127500),
    ('de000000-0000-4000-a000-000000000076', 'de000000-0000-4000-a000-000000000048', 'de000000-0000-4000-a000-000000000022', 'Tata Salt 1kg',            20, 2800,  0, 0, 56000),
    ('de000000-0000-4000-a000-000000000077', 'de000000-0000-4000-a000-000000000049', 'de000000-0000-4000-a000-000000000028', 'Surf Excel 1kg',          20, 13500, 0, 0, 270000),
    ('de000000-0000-4000-a000-000000000078', 'de000000-0000-4000-a000-000000000049', 'de000000-0000-4000-a000-000000000025', 'Parle-G Biscuit 12-pack', 40, 11000, 0, 0, 440000),
    ('de000000-0000-4000-a000-000000000079', 'de000000-0000-4000-a000-000000000050', 'de000000-0000-4000-a000-000000000023', 'Amul Milk 500ml',         50, 3000,  0, 0, 150000),
    ('de000000-0000-4000-a000-000000000080', 'de000000-0000-4000-a000-000000000050', 'de000000-0000-4000-a000-000000000029', 'Maggi Noodles 7-pack',    30, 9500,  0, 0, 285000),
    ('de000000-0000-4000-a000-000000000081', 'de000000-0000-4000-a000-000000000051', 'de000000-0000-4000-a000-000000000026', 'Tata Tea Gold 250g',      15, 16800, 0, 0, 252000),
    ('de000000-0000-4000-a000-000000000082', 'de000000-0000-4000-a000-000000000051', 'de000000-0000-4000-a000-000000000027', 'Colgate Toothpaste 100g', 25, 6500,  0, 0, 162500),
    ('de000000-0000-4000-a000-000000000083', 'de000000-0000-4000-a000-000000000052', 'de000000-0000-4000-a000-000000000021', 'Aashirvaad Atta 5kg',     12, 25500, 0, 0, 306000),
    ('de000000-0000-4000-a000-000000000084', 'de000000-0000-4000-a000-000000000052', 'de000000-0000-4000-a000-000000000024', 'Fortune Sunflower Oil 1L', 8, 15800, 0, 0, 126400),
    ('de000000-0000-4000-a000-000000000085', 'de000000-0000-4000-a000-000000000053', 'de000000-0000-4000-a000-000000000022', 'Tata Salt 1kg',            50, 2800,  0, 0, 140000),
    ('de000000-0000-4000-a000-000000000086', 'de000000-0000-4000-a000-000000000053', 'de000000-0000-4000-a000-000000000028', 'Surf Excel 1kg',          25, 13500, 0, 0, 337500),
    ('de000000-0000-4000-a000-000000000087', 'de000000-0000-4000-a000-000000000054', 'de000000-0000-4000-a000-000000000023', 'Amul Milk 500ml',         40, 3000,  0, 0, 120000),
    ('de000000-0000-4000-a000-000000000088', 'de000000-0000-4000-a000-000000000054', 'de000000-0000-4000-a000-000000000030', 'Bisleri Water 1L',       100, 2400,  0, 0, 240000),
    ('de000000-0000-4000-a000-000000000089', 'de000000-0000-4000-a000-000000000054', 'de000000-0000-4000-a000-000000000025', 'Parle-G Biscuit 12-pack', 25, 11000, 0, 0, 275000)
  ON CONFLICT DO NOTHING;

  -- ---------------------------------------------------------------------
  -- 6. Expense ledger. Recognised (approved/paid) total = 600000 paise.
  --    The pending and rejected rows exist to prove they are excluded.
  -- ---------------------------------------------------------------------
  INSERT INTO expenses (id, business_id, category, amount_minor, currency, description, vendor, status, expense_date, is_recurring, recurring_frequency, recurring_next_due_date, created_by)
  VALUES
    ('de000000-0000-4000-a000-000000000091', v_business_id, 'rent',          350000, 'INR', 'Shop rent for September 2026',              'Property owner',        'paid',    '2026-09-10T10:00:00+05:30', true,  'monthly', '2026-10-10', v_user_id),
    ('de000000-0000-4000-a000-000000000092', v_business_id, 'supplies',       22000, 'INR', 'Counter supplies, carry bags and packing tape', 'Local stationers',   'approved','2026-09-12T09:00:00+05:30', false, NULL, NULL, v_user_id),
    ('de000000-0000-4000-a000-000000000093', v_business_id, 'transportation', 15000, 'INR', 'Stock delivery tempo charges',               'Sharma Transport',      'paid',    '2026-09-15T18:00:00+05:30', false, NULL, NULL, v_user_id),
    ('de000000-0000-4000-a000-000000000094', v_business_id, 'utilities',      48000, 'INR', 'Electricity bill for September 2026',        'State electricity board','approved','2026-09-18T20:00:00+05:30', false, NULL, NULL, v_user_id),
    ('de000000-0000-4000-a000-000000000095', v_business_id, 'other',          30000, 'INR', 'Festival decoration advance',                'Event decorator',       'rejected','2026-09-20T12:00:00+05:30', false, NULL, NULL, v_user_id),
    ('de000000-0000-4000-a000-000000000096', v_business_id, 'marketing',      10000, 'INR', 'WhatsApp catalogue printing',                'Local printer',         'paid',    '2026-09-25T11:00:00+05:30', false, NULL, NULL, v_user_id),
    ('de000000-0000-4000-a000-000000000097', v_business_id, 'maintenance',    45000, 'INR', 'Shutter spring repair quote',                'Ironworks',             'pending', '2026-09-28T14:00:00+05:30', false, NULL, NULL, v_user_id),
    ('de000000-0000-4000-a000-000000000098', v_business_id, 'salaries',      150000, 'INR', 'Shop assistant salary for September 2026',   NULL,                    'paid',    '2026-10-01T10:00:00+05:30', false, NULL, NULL, v_user_id),
    ('de000000-0000-4000-a000-000000000099', v_business_id, 'fees',            5000, 'INR', 'UPI merchant transaction charges',           'Payment gateway',       'paid',    '2026-10-03T21:00:00+05:30', false, NULL, NULL, v_user_id)
  ON CONFLICT DO NOTHING;

  -- ---------------------------------------------------------------------
  -- 7. Receivables raised by the three credit sales (one already overdue).
  -- ---------------------------------------------------------------------
  INSERT INTO receivables (id, business_id, customer_id, transaction_id, amount_minor, paid_amount_minor, currency, due_date, status)
  VALUES
    ('de000000-0000-4000-a000-000000000101', v_business_id, 'de000000-0000-4000-a000-000000000012', 'de000000-0000-4000-a000-000000000045', 300000, 0, 'INR', '2026-10-14T00:00:00+05:30', 'pending'),
    ('de000000-0000-4000-a000-000000000102', v_business_id, 'de000000-0000-4000-a000-000000000015', 'de000000-0000-4000-a000-000000000049', 710000, 0, 'INR', '2026-10-03T00:00:00+05:30', 'overdue'),
    ('de000000-0000-4000-a000-000000000103', v_business_id, 'de000000-0000-4000-a000-000000000013', 'de000000-0000-4000-a000-000000000053', 477500, 0, 'INR', '2026-11-02T00:00:00+05:30', 'pending')
  ON CONFLICT DO NOTHING;

  -- ---------------------------------------------------------------------
  -- 8. Payables against the two restock purchases (one part paid, one
  --    overdue).
  -- ---------------------------------------------------------------------
  INSERT INTO payables (id, business_id, supplier_id, transaction_id, amount_minor, paid_amount_minor, currency, due_date, status)
  VALUES
    ('de000000-0000-4000-a000-000000000111', v_business_id, 'de000000-0000-4000-a000-000000000001', 'de000000-0000-4000-a000-000000000041', 1334000, 900000, 'INR', '2026-10-18T00:00:00+05:30', 'partial'),
    ('de000000-0000-4000-a000-000000000112', v_business_id, 'de000000-0000-4000-a000-000000000004', 'de000000-0000-4000-a000-000000000042',  260000,      0, 'INR', '2026-09-30T00:00:00+05:30', 'overdue')
  ON CONFLICT DO NOTHING;

  -- ---------------------------------------------------------------------
  -- 9. Two documents waiting for review, which is what the Overview
  --    "needs review" card queries for (status = review_required).
  --    No application code reads the storage path, so the demo rows are
  --    metadata only and cannot 404 anywhere.
  -- ---------------------------------------------------------------------
  INSERT INTO documents (id, business_id, source_type, file_name, mime_type, file_size, storage_path, status, original_name, page_count, language, uploaded_by, uploaded_at, processed_at)
  VALUES
    ('de000000-0000-4000-a000-000000000121', v_business_id, 'invoice', 'gupta-wholesale-invoice-2026-09-06.pdf', 'application/pdf', 184320,
     'demo/gupta-wholesale-invoice-2026-09-06.pdf', 'review_required', 'gupta-wholesale-invoice-2026-09-06.pdf', 1, 'en', v_user_id, '2026-09-06T10:05:00+05:30', '2026-09-06T10:06:00+05:30'),
    ('de000000-0000-4000-a000-000000000122', v_business_id, 'upi_screenshot', 'reddy-snacks-payment-2026-09-24.png', 'image/png', 96000,
     'demo/reddy-snacks-payment-2026-09-24.png', 'review_required', 'reddy-snacks-payment-2026-09-24.png', NULL, 'en', v_user_id, '2026-09-24T15:35:00+05:30', NULL)
  ON CONFLICT DO NOTHING;

  -- ---------------------------------------------------------------------
  -- 10. Recompute the denormalised customer/supplier running totals from
  --     the ledgers, so the customers and suppliers pages agree with the
  --     receivable/payable and sales tables. Recomputed from source every
  --     run, which keeps the whole script idempotent.
  -- ---------------------------------------------------------------------
  UPDATE customers c SET
    total_purchases_minor = COALESCE((
      SELECT SUM(t.total_minor) FROM transactions t
      WHERE t.business_id = c.business_id
        AND t.type = 'sale'
        AND t.status IN ('completed', 'confirmed')
        AND t.counterparty_type = 'customer'
        AND t.counterparty_id = c.id::text
    ), 0),
    outstanding_balance_minor = COALESCE((
      SELECT SUM(r.amount_minor - r.paid_amount_minor) FROM receivables r
      WHERE r.business_id = c.business_id AND r.customer_id = c.id
    ), 0),
    last_transaction_date = (
      SELECT MAX(t.transaction_date) FROM transactions t
      WHERE t.business_id = c.business_id
        AND t.counterparty_type = 'customer'
        AND t.counterparty_id = c.id::text
    ),
    updated_at = now()
  WHERE c.business_id = v_business_id;

  UPDATE suppliers s SET
    total_purchases_minor = COALESCE((
      SELECT SUM(t.total_minor) FROM transactions t
      WHERE t.business_id = s.business_id
        AND t.type = 'purchase'
        AND t.status IN ('completed', 'confirmed')
        AND t.counterparty_type = 'supplier'
        AND t.counterparty_id = s.id::text
    ), 0),
    outstanding_payable_minor = COALESCE((
      SELECT SUM(p.amount_minor - p.paid_amount_minor) FROM payables p
      WHERE p.business_id = s.business_id AND p.supplier_id = s.id
    ), 0),
    last_transaction_date = (
      SELECT MAX(t.transaction_date) FROM transactions t
      WHERE t.business_id = s.business_id
        AND t.counterparty_type = 'supplier'
        AND t.counterparty_id = s.id::text
    ),
    updated_at = now()
  WHERE s.business_id = v_business_id;

  RAISE NOTICE 'Demo data seeded for business %', v_business_id;
END $seed$;
