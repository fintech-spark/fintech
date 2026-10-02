# Code Review Standards

This rule governs automated and peer code review standards across the repository.

## Mandatory Review Triggers

- After writing or modifying domain services, schemas, or API endpoints.
- Before committing any security-sensitive logic (auth, database access, AI prompts).
- When altering shared kernel types (`lib/types.ts`) or architectural boundaries (`lib/boundaries.ts`).
- Before opening or merging pull requests.

## Review Checklist

- [ ] **Type Safety**: TypeScript strict mode compliant; zero usage of `any`; narrow domain unions.
- [ ] **Security**: Zero hardcoded secrets; Zod input validation on all inputs; parameterized SQL; tenant isolation.
- [ ] **Code Simplicity**: Functions focused on a single concern (<50 lines); files under the 800-line maintainability ceiling.
- [ ] **Error Handling**: Uses `Result<T, E>` monad for predictable domain failures; structured `AppError` subclasses.
- [ ] **Testing**: Unit tests verify happy paths and boundary failure conditions; test coverage >= 80%.
- [ ] **Multi-Tenancy**: Every database query and business service enforces `TenantContext` (`businessId`).

## Severity Levels

| Level | Definition | Enforcement |
| :--- | :--- | :--- |
| **CRITICAL** | Security flaw, data loss risk, or tenant isolation breach | **BLOCK** — Must fix immediately before merge |
| **HIGH** | Functional defect, broken architectural boundary, missing tests | **BLOCK** — Must resolve before merge |
| **MEDIUM** | Maintainability issue, dead code, poor naming, unoptimized query | **WARN** — Resolve or document technical debt |
| **LOW** | Minor stylistic or formatting suggestion | **INFO** — Optional polish |
