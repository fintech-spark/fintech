-- Merchant Brain: Database Foundation — Secondary Indexes
-- Migration 0002: Indexes optimized for tenant-scoped access patterns
--
-- Every business-owned table gets a composite index on (business_id, ...)
-- to support the TenantDatabaseClient's tenant-scoped queries.
-- Partial unique indexes support idempotency and deduplication.

-- ============================================================================
-- business_members
-- ============================================================================
CREATE INDEX idx_bm_business_id ON business_members (business_id);
CREATE INDEX idx_bm_user_id ON business_members (user_id);

-- ============================================================================
-- suppliers — tenant-scoped list + status filter
-- ============================================================================
CREATE INDEX idx_suppliers_biz_status ON suppliers (business_id, status);
CREATE INDEX idx_suppliers_biz_name ON suppliers (business_id, name);

-- ============================================================================
-- customers — tenant-scoped list + status + search
-- ============================================================================
CREATE INDEX idx_customers_biz_status ON customers (business_id, status);
CREATE INDEX idx_customers_biz_name ON customers (business_id, name);
CREATE INDEX idx_customers_biz_phone ON customers (business_id, phone);

-- ============================================================================
-- products — tenant-scoped list + status + low-stock + supplier
-- ============================================================================
CREATE INDEX idx_products_biz_status ON products (business_id, status);
CREATE INDEX idx_products_biz_category ON products (business_id, category);
CREATE INDEX idx_products_biz_supplier ON products (business_id, supplier_id);
-- Partial index for low-stock queries: WHERE current_stock <= reorder_point AND status = 'active'
CREATE INDEX idx_products_low_stock ON products (business_id)
  WHERE current_stock <= reorder_point AND status = 'active';

-- ============================================================================
-- transactions — tenant-scoped list + date + counterparty + status
-- ============================================================================
CREATE INDEX idx_transactions_biz_date ON transactions (business_id, transaction_date DESC);
CREATE INDEX idx_transactions_biz_status ON transactions (business_id, status);
CREATE INDEX idx_transactions_biz_counterparty ON transactions (business_id, counterparty_id);
CREATE INDEX idx_transactions_biz_type ON transactions (business_id, type);
-- Idempotency: unique within business, only when key provided
CREATE UNIQUE INDEX idx_transactions_idempotency ON transactions (business_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ============================================================================
-- transaction_items — by transaction
-- ============================================================================
CREATE INDEX idx_tx_items_transaction_id ON transaction_items (transaction_id);
CREATE INDEX idx_tx_items_product_id ON transaction_items (product_id);

-- ============================================================================
-- expenses — tenant-scoped list + category + date + status
-- ============================================================================
CREATE INDEX idx_expenses_biz_date ON expenses (business_id, expense_date DESC);
CREATE INDEX idx_expenses_biz_category ON expenses (business_id, category);
CREATE INDEX idx_expenses_biz_status ON expenses (business_id, status);
CREATE UNIQUE INDEX idx_expenses_idempotency ON expenses (business_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ============================================================================
-- inventory_movements — by product (within tenant)
-- ============================================================================
CREATE INDEX idx_inv_movements_biz_product ON inventory_movements (business_id, product_id);
CREATE INDEX idx_inv_movements_biz_created ON inventory_movements (business_id, created_at DESC);
CREATE INDEX idx_inv_movements_product_id ON inventory_movements (product_id);

-- ============================================================================
-- receivables — by customer + status + due date
-- ============================================================================
CREATE INDEX idx_receivables_biz_customer ON receivables (business_id, customer_id);
CREATE INDEX idx_receivables_biz_status ON receivables (business_id, status);
CREATE INDEX idx_receivables_biz_due_date ON receivables (business_id, due_date);

-- ============================================================================
-- payables — by supplier + status + due date
-- ============================================================================
CREATE INDEX idx_payables_biz_supplier ON payables (business_id, supplier_id);
CREATE INDEX idx_payables_biz_status ON payables (business_id, status);
CREATE INDEX idx_payables_biz_due_date ON payables (business_id, due_date);

-- ============================================================================
-- supplier_pricing — by product (reverse lookup)
-- ============================================================================
CREATE INDEX idx_supplier_pricing_biz_product ON supplier_pricing (business_id, product_id);

-- ============================================================================
-- documents — by status + source_type + content_hash dedup
-- ============================================================================
CREATE INDEX idx_documents_biz_status ON documents (business_id, status);
CREATE INDEX idx_documents_biz_source ON documents (business_id, source_type);
CREATE INDEX idx_documents_biz_uploaded ON documents (business_id, uploaded_at DESC);
CREATE UNIQUE INDEX idx_documents_content_hash ON documents (business_id, content_hash)
  WHERE content_hash IS NOT NULL;

-- ============================================================================
-- ingestion_jobs — by document
-- ============================================================================
CREATE INDEX idx_ingestion_biz_document ON ingestion_jobs (business_id, document_id);
CREATE INDEX idx_ingestion_biz_state ON ingestion_jobs (business_id, state);
CREATE INDEX idx_ingestion_document_id ON ingestion_jobs (document_id);

-- ============================================================================
-- document_extractions — by document
-- ============================================================================
CREATE INDEX idx_extractions_biz_document ON document_extractions (business_id, document_id);
CREATE INDEX idx_extractions_document_id ON document_extractions (document_id);
CREATE INDEX idx_extractions_biz_status ON document_extractions (business_id, status);

-- ============================================================================
-- document_embeddings — vector similarity search (HNSW) + tenant filter
-- ============================================================================
-- HNSW index for fast approximate nearest neighbor search.
-- Uses vector_cosine_ops for cosine similarity (standard for embeddings).
CREATE INDEX idx_embeddings_embedding_hnsw ON document_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
CREATE INDEX idx_embeddings_biz_document ON document_embeddings (business_id, document_id);
CREATE INDEX idx_embeddings_document_id ON document_embeddings (document_id);

-- ============================================================================
-- profit_leaks — by status + category + severity
-- ============================================================================
CREATE INDEX idx_profit_leaks_biz_status ON profit_leaks (business_id, status);
CREATE INDEX idx_profit_leaks_biz_category ON profit_leaks (business_id, category);
CREATE INDEX idx_profit_leaks_biz_severity ON profit_leaks (business_id, severity);

-- ============================================================================
-- cash_flow_forecasts — latest by business
-- ============================================================================
CREATE INDEX idx_cash_flow_biz_calculated ON cash_flow_forecasts (business_id, calculated_at DESC);

-- ============================================================================
-- scenarios — by status
-- ============================================================================
CREATE INDEX idx_scenarios_biz_status ON scenarios (business_id, status);
CREATE INDEX idx_scenarios_biz_created ON scenarios (business_id, created_at DESC);

-- ============================================================================
-- actions — by status + pending approval + idempotency
-- ============================================================================
CREATE INDEX idx_actions_biz_status ON actions (business_id, status);
CREATE INDEX idx_actions_biz_source ON actions (business_id, source);
CREATE INDEX idx_actions_biz_created ON actions (business_id, created_at DESC);
CREATE UNIQUE INDEX idx_actions_idempotency ON actions (business_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ============================================================================
-- action_logs — by action
-- ============================================================================
CREATE INDEX idx_action_logs_action_id ON action_logs (action_id);

-- ============================================================================
-- chat_sessions — by business + user
-- ============================================================================
CREATE INDEX idx_chat_sessions_biz_user ON chat_sessions (business_id, user_id);
CREATE INDEX idx_chat_sessions_biz_activity ON chat_sessions (business_id, last_activity_at DESC);

-- ============================================================================
-- chat_messages — by session + created
-- ============================================================================
CREATE INDEX idx_chat_messages_session_id ON chat_messages (session_id);
CREATE INDEX idx_chat_messages_session_created ON chat_messages (session_id, created_at);

-- ============================================================================
-- notifications — by business + user + status (unread query)
-- ============================================================================
CREATE INDEX idx_notifications_biz_user_status ON notifications (business_id, user_id, status);
CREATE INDEX idx_notifications_biz_user_created ON notifications (business_id, user_id, created_at DESC);

-- ============================================================================
-- audit_logs — by resource + action + date
-- ============================================================================
CREATE INDEX idx_audit_biz_resource ON audit_logs (business_id, resource_type, resource_id);
CREATE INDEX idx_audit_biz_user ON audit_logs (business_id, user_id);
CREATE INDEX idx_audit_biz_action ON audit_logs (business_id, action);
CREATE INDEX idx_audit_biz_timestamp ON audit_logs (business_id, timestamp DESC);
