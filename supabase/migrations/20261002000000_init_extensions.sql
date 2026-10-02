-- Merchant Brain: Database Foundation — Extensions & Utility Functions
-- Migration 0000: Enable required PostgreSQL extensions
--
-- This migration establishes the foundational PostgreSQL extensions required
-- by the Merchant Brain schema. These extensions are standard in Supabase
-- and any PostgreSQL 14+ environment.

-- pgcrypto: provides gen_random_uuid() for primary key generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- uuid-ossp: provides uuid_generate_v4() as a fallback UUID generator
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- pgvector: required for document_embeddings.embedding column
-- Dimension is set to 1536 (compatible with common embedding models).
-- Adjust if a different model is selected in the future.
CREATE EXTENSION IF NOT EXISTS vector;

-- Utility function: set_updated_at()
-- Automatically updates the updated_at column on any row modification.
-- Individual tables create BEFORE UPDATE triggers referencing this function.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Utility function: gen_uuid()
-- Wrapper around gen_random_uuid() for consistent UUID generation across the schema.
CREATE OR REPLACE FUNCTION gen_uuid()
RETURNS uuid AS $$
  SELECT gen_random_uuid();
$$ LANGUAGE sql;
