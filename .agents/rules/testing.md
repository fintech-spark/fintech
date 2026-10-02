# Testing & Verification Rules

This rule outlines testing principles and verification loops for Merchant Brain.

## Test Strategy

1. **Test-Driven Development (TDD)**:
   - For domain rules and pure calculations, write failing tests first (Red), implement minimum code to pass (Green), and refactor with tests passing.
   - Test business invariants and observable behavior, not internal implementation details.

2. **Test Levels**:
   - **Unit Tests (`tests/*.test.ts`)**: Fast, deterministic in-memory tests verifying pure rules, branded ID behaviors, Result monad transformations, and architectural boundaries.
   - **Integration Tests**: Verify module interaction via the `EventBus` and `ModuleRegistry` in a synthetic environment.
   - **E2E Tests (`tests/e2e/*.spec.ts`)**: Playwright automation testing critical user flows, authentication guards, and page rendering.

3. **Synthetic Data Policy**:
   - Use ONLY synthetic fixtures for testing. NEVER commit real merchant records, customer PII, live API tokens, or actual bank data.

4. **Mandatory Verification Loop**:
   Before merging or declaring any task done, run the complete verification pipeline:
   ```bash
   npm run lint && npm run typecheck && npm test && npm run build
   ```
   Report the exact command and terminal output. Never claim verification passed without executing it.
