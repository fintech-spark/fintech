-- Merchant Brain: Database Security — Storage Isolation
-- Migration 0005: private merchant-file bucket + folder-scoped RLS policies.
--
-- Object name convention (enforced by policy):
--   <business_id>/<user_id>/<file_uuid>-<sanitized_name>
-- The first path segment MUST be a business id the caller is an active
-- member of. This blocks cross-tenant access, guessed-filename access,
-- manipulated folder paths, and unauthorized upload/download/delete.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'merchant-files',
  'merchant-files',
  false,
  52428800,
  ARRAY[
    'image/jpeg','image/png','image/webp',
    'application/pdf',
    'audio/mpeg','audio/wav','audio/ogg',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO UPDATE SET public = false;

-- storage.objects already has RLS enabled in Supabase; ensure policies are
-- the only access path. DROP first for idempotency on local reruns.
DROP POLICY IF EXISTS merchant_files_select ON storage.objects;
DROP POLICY IF EXISTS merchant_files_insert ON storage.objects;
DROP POLICY IF EXISTS merchant_files_update ON storage.objects;
DROP POLICY IF EXISTS merchant_files_delete ON storage.objects;

CREATE POLICY merchant_files_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'merchant-files'
    AND (storage.foldername(name))[1] IN (
      SELECT b.id::text FROM public.businesses b
      WHERE b.id IN (SELECT public.auth_user_businesses())
    )
  );

CREATE POLICY merchant_files_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'merchant-files'
    AND (storage.foldername(name))[1] IN (
      SELECT b.id::text FROM public.businesses b
      WHERE b.id IN (SELECT public.auth_user_businesses())
    )
  );

CREATE POLICY merchant_files_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'merchant-files'
    AND (storage.foldername(name))[1] IN (
      SELECT b.id::text FROM public.businesses b
      WHERE b.id IN (SELECT public.auth_user_businesses())
    )
  )
  WITH CHECK (
    bucket_id = 'merchant-files'
    AND (storage.foldername(name))[1] IN (
      SELECT b.id::text FROM public.businesses b
      WHERE b.id IN (SELECT public.auth_user_businesses())
    )
  );

CREATE POLICY merchant_files_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'merchant-files'
    AND (storage.foldername(name))[1] IN (
      SELECT b.id::text FROM public.businesses b
      WHERE b.id IN (SELECT public.auth_user_businesses())
    )
  );
