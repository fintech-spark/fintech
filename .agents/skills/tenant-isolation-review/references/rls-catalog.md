# RLS policy catalog

Source of truth: `supabase/migrations/20261002000004_rls_tenant_isolation.sql`, amended by
`0006`, `0008`, `0009`, `0010`, `0011`. 26 domain tables, all with `ENABLE` + `FORCE ROW LEVEL
SECURITY` (`0004:166-182`, re-asserted `0009:105-134`).

## Tenancy resolution

| Kind | Resolution | Tables |
|---|---|---|
| Tenant root | `id IN (SELECT auth_user_businesses())` | `businesses` |
| Direct tenant | `business_id IN (SELECT auth_user_businesses())` | 18 tables (below) |
| Tenant + owner | `user_id = auth.uid() AND business_id IN (…)` | `chat_sessions`, `notifications` |
| Per-user only | `id = auth.uid()` | `users` |
| Admin-scoped | `id IN (SELECT auth_user_admin_businesses())` | `businesses` UPDATE/DELETE, `business_members` |
| Child (no `business_id`) | `EXISTS (SELECT 1 FROM parent p WHERE p.id = child.parent_id AND p.business_id IN (…))` | `transaction_items`, `action_logs`, `chat_messages` |
| Storage | `storage.foldername(name)[1]` ∩ memberships (`0005:37-40`) | `merchant-files` bucket |

Direct tenant tables (all four policies each, `0004:246-271`): `suppliers`, `customers`, `products`,
`transactions`, `expenses`, `inventory_movements`, `receivables`, `payables`, `supplier_pricing`,
`documents`, `ingestion_jobs`, `document_extractions`, `document_embeddings`, `profit_leaks`,
`cash_flow_forecasts`, `scenarios`, `actions`, `audit_logs`.

## Membership helpers (all SECURITY DEFINER, `search_path = ''`)

| Function | Returns | EXECUTE |
|---|---|---|
| `auth_user_businesses()` | caller's active memberships | `authenticated` only (`0009:88`; PUBLIC revoked `0004:70`) |
| `auth_user_admin_businesses()` | caller is owner/admin | `authenticated` (`0009:89`) |
| `auth_user_owner_businesses()` | caller is owner | `authenticated` (`0009:90`) |
| `match_document_embeddings(...)` | guarded ANN retrieval | `authenticated` (`0010:161-163`) — **`search_path = public, extensions`**, the one unpinned definer |

None accept a user-id parameter. That is the property that makes them safe.

## Immutability triggers

- `prevent_business_id_mutation` on 20 tables (`0004:128-136`).
- `prevent_parent_id_mutation` on 7 (`0004:147-161`), rewritten in `0008:50-75` to compare via
  `to_jsonb(NEW)->col` (fixes a blanket-UPDATE denial).
- `prevent_membership_role_escalation` on INSERT **or** UPDATE (`0008:131-133`) — role/status change
  or granting `owner` requires a pre-existing owner; bypassed when `auth.uid() IS NULL` (service role).
- `prevent_users_email_mutation` (`0006:86`).

## Known holes

- `action_logs` has `_tenant_update` and `_tenant_delete` policies (`0004:327-345`), is **absent**
  from the immutability array (`0004:128-136`), and gained a `business_id` column in `0011:98`
  with no policy validating it against the parent action. Audit rows can be relabelled or deleted.
- `businesses_insert_owner_only` (`0009:58-62`) requires membership of a row that does not exist yet
  — unsatisfiable, so there is no authenticated-only onboarding path. `business_members_insert_admin`
  (`0004:229-231`) has the same shape. Whether the app onboards via service role is UNVERIFIED.
- `_migrations` has **no RLS**; safety rests on one `REVOKE` (`0006:17`, asserted `0009:149-155`).
- `USING (true)` no longer exists: the `businesses_insert_authenticated` instance was dropped in
  `0009:56`.
