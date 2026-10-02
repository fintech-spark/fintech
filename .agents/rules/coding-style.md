# Coding Style & TypeScript Rules

This rule enforces code quality, TypeScript strictness, and naming conventions for Merchant Brain.

## TypeScript Standards

1. **Strict Mode Invariants**:
   - Zero tolerance for `any`. Use `unknown` with type narrowing, generics, or branded types.
   - Do not suppress compiler errors using `@ts-ignore` or `@ts-nocheck` without documenting a critical reason and approval.

2. **Domain Modeling & Branded Types**:
   - Use branded IDs (`UserId`, `BusinessId`, `TransactionId`, etc. from `lib/types.ts`) for all entity identifiers to prevent accidental ID swapping.
   - Represent currency strictly as integer minor units (`Money`) with ISO-4217 currency codes. Never store money as floating point numbers.

3. **Error Handling with Result Monad**:
   - Use `Result<T, E>` (`ok()` / `err()`) for expected operational and business rule failures.
   - Reserve thrown exceptions (`AppError`) for unrecoverable system faults or HTTP boundary handlers.

4. **Naming Conventions**:
   - `PascalCase`: React components, TypeScript types, interfaces, and enums.
   - `camelCase`: Variables, functions, methods, and instances.
   - `kebab-case`: File names, route segments, directory names, and document files.
   - `UPPER_SNAKE_CASE`: Global constants and configuration values.
