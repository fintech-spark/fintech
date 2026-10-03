# Authorization Matrix (Merchant Brain Phase 2)

Source of truth: RLS policies in `supabase/migrations/20261002000004_rls_tenant_isolation.sql`.
No invented permissions.

| Role | Business Scope | Operations | Notes |
|---|---|---|---|
| `anon` | None | SELECT denied on all tenant tables | Can access only public/auth endpoints; RLS gives empty set |
| `authenticated` | Own active memberships only (`auth_user_businesses()`, status='active') | SELECT/INSERT/UPDATE/DELETE on own business rows; child tables via parent EXISTS; self-only on users | No `users` DELETE policy; `users.id` immutable; `users.email` immutable (0006) |
| `authenticated` on `business_members` (self) | Own row + same business | SELECT self or same-biz; admin-only INSERT/UPDATE/DELETE | `business_id` and `user_id` immutable |
| `authenticated` admin (`auth_user_admin_businesses()`) | Businesses where role = owner/admin | INSERT/UPDATE/DELETE on `business_members`; UPDATE/DELETE `businesses`; INSERT `businesses` unrestricted (`WITH CHECK (true)`) | `businesses` insert allows any authenticated user to create a business; onboarding owner assignment is manual (documented limitation) |
| `authenticated` owner (`auth_user_owner_businesses()`) | Same as admin + can grant `owner` to others | Can INSERT `business_members` with `role='owner'`; can UPDATE `business_members` for any member; can UPDATE/DELETE `businesses` | `prevent_membership_role_escalation()` requires owner for UPDATE and INSERT of owner |
| `service_role` (admin client) | All businesses | All operations, RLS bypassed | Only via `lib/supabase/admin-client.ts`; `import 'server-only';` enforced; key must not be in `NEXT_PUBLIC_*`; requires `{ bypassRowLevelSecurity: true }` |

## Access Controls Enforced at DB Layer
- Tenant isolation: `business_id IN (SELECT auth_user_businesses())` (plain tables) or `EXISTS (SELECT 1 FROM parent WHERE ...)` (child tables).
- Ownership immutability: `prevent_business_id_mutation()` + `prevent_parent_id_mutation()` triggers on every affected table.
- Membership immutability: `business_members.user_id` frozen; `users.id` frozen.
- Audit append-only: `audit_logs` has SELECT only (insert/update/delete revoked from `authenticated` in 0006).
- Email immutability: `users.email` frozen (0006 trigger).
