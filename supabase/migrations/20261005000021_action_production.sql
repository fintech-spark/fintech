-- Action lifecycle is mediated by the authenticated HTTP service over pg.
-- Direct PostgREST mutations would bypass approval/hash/owner authorization.
REVOKE INSERT, UPDATE, DELETE ON public.actions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.action_logs FROM anon, authenticated;

ALTER TABLE public.actions DROP CONSTRAINT IF EXISTS actions_type_check;
ALTER TABLE public.actions ADD CONSTRAINT actions_type_check CHECK (type IN (
  'adjust_price', 'reorder_stock', 'send_reminder', 'change_supplier',
  'reduce_expense', 'create_transaction', 'generate_report', 'custom'
));

-- Caller execution keys are independent of proposal keys. Retain the binding
-- even on failure/timeout so a second action cannot reuse the same request key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_actions_execution_key
  ON public.actions (business_id, ((detail->>'executionKey')))
  WHERE detail->>'executionKey' IS NOT NULL;

ALTER TABLE public.actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.actions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.action_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.action_logs FORCE ROW LEVEL SECURITY;
