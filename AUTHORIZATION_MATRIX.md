# Authorization Matrix — Merchant Brain

Authoritative sources of truth:
1. **Application-Layer RBAC**: `lib/http/auth-context.ts` (`hasPermission`, `assertPermission`) and domain rules (`modules/actions/domain/rules.ts`).
2. **Database-Layer RLS**: `supabase/migrations/20261002000004_rls_tenant_isolation.sql` through `20261002000012_audit_immutability_and_rag_search_path.sql`.

> **Enforcement rule:** Both layers must pass. Application-layer `assertPermission(ctx, permission)` executes before route handlers query the database. RLS validates row-level tenant containment on PostgreSQL queries.

---

## 1. Application-Layer Permission Matrix (`lib/http/auth-context.ts`)

| Domain / Permission | `owner` | `admin` | `manager` | `accountant` | `staff` |
|---|:---:|:---:|:---:|:---:|:---:|
| `transactions:read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `transactions:create` / `update` / `delete` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `inventory:read` | ✅ | ✅ | ✅ | ❌ | ✅ |
| `inventory:create` / `update` / `delete` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `expenses:read` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `expenses:create` / `update` / `delete` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `customers:read` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `customers:create` / `update` / `delete` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `suppliers:read` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `suppliers:create` / `update` / `delete` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `documents:read` | ✅ | ✅ | ✅ | ❌ | ✅ |
| `documents:create` / `update` / `delete` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `analytics:read` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `actions:read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `actions:approve` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `actions:execute` | ✅ | ❌ *(owner-only)* | ❌ | ❌ | ❌ |
| `business:read` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `business:update` / `members:*` | ✅ | ✅ *(no owner-grant)* | ❌ | ❌ | ❌ |

### Key Application Invariants
- **`actions:execute` is strictly owner-only**: Neither `admin`, `manager`, `accountant`, nor `staff` can execute actions (`lib/http/auth-context.ts:217`; `modules/actions/domain/rules.ts:68`).
- **Segregation of duties**: The action proposer cannot be the executor (`domain/rules.ts`), and AI-recommended actions always require a human approval.
- **Fail-closed verification**: `assertPermission` throws `AuthorizationError` (HTTP 403) on missing permissions. Tenant membership is checked via `auth_user_businesses()`.

---

## 2. Database-Layer RLS Matrix (`supabase/migrations/`)

| Role | Business Scope | Operations | Notes |
|---|---|---|---|
| `anon` | None | SELECT denied on all tenant tables | Can access only public/auth endpoints; RLS yields empty set |
| `authenticated` | Own active memberships only (`auth_user_businesses()`, status='active') | SELECT/INSERT/UPDATE/DELETE on own business rows; child tables via parent EXISTS; self-only on users | No `users` DELETE policy; `users.id` immutable; `users.email` immutable (0006) |
| `authenticated` on `business_members` (self) | Own row + same business | SELECT self or same-biz; admin-only INSERT/UPDATE/DELETE | `business_id` and `user_id` immutable |
| `authenticated` admin (`auth_user_admin_businesses()`) | Businesses where role = owner/admin | INSERT/UPDATE/DELETE on `business_members`; UPDATE/DELETE `businesses`; INSERT `businesses` unrestricted (`WITH CHECK (true)`) | Role escalation prevented by `prevent_membership_role_escalation()` |
| `authenticated` owner (`auth_user_owner_businesses()`) | Same as admin + can grant `owner` to others | Can INSERT `business_members` with `role='owner'`; can UPDATE `business_members` for any member; can UPDATE/DELETE `businesses` | `prevent_membership_role_escalation()` requires owner for UPDATE/INSERT of owner role |
| `service_role` (admin client) | All businesses | All operations, RLS bypassed | Only via `lib/supabase/admin-client.ts`; `import 'server-only';` enforced; key must not be in `NEXT_PUBLIC_*`; requires `{ bypassRowLevelSecurity: true }` |

## 3. Access Controls Enforced at DB Layer
- **Tenant isolation**: `business_id IN (SELECT auth_user_businesses())` (plain tables) or `EXISTS (SELECT 1 FROM parent WHERE ...)` (child tables).
- **Ownership immutability**: `prevent_business_id_mutation()` + `prevent_parent_id_mutation()` triggers on every affected table.
- **Membership immutability**: `business_members.user_id` frozen; `users.id` frozen.
- **Audit append-only**: `audit_logs` has SELECT only for clients. Migration 00012 attaches `prevent_audit_log_mutation()` trigger raising EXCEPTION on any UPDATE or DELETE.
- **Search path security**: Migration 00012 pins `search_path = public, pg_catalog` on `match_document_embeddings` and security definer functions.
- **Email immutability**: `users.email` frozen (0006 trigger).
