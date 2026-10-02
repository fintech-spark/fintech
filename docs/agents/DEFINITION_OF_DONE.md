# Definition of Done

A future feature is complete only when the applicable items below are true. Setup-only changes must explicitly say which product criteria do not apply.

## Behavior and code

- [ ] The approved user outcome and acceptance criteria are implemented.
- [ ] Existing code was inspected and reused; no unnecessary rewrite or dependency exists.
- [ ] Types pass with strict TypeScript.
- [ ] Lint passes with Next.js and shadcn/lint rules.
- [ ] Unit and integration tests cover behavior, boundaries, and failure paths.
- [ ] Playwright covers the critical user journey when the feature is user-facing.

## UI and accessibility

- [ ] The change follows `docs/product/DESIGN_SYSTEM.md`, shadcn conventions, and current Vercel Web Interface Guidelines.
- [ ] Responsive layout, keyboard behavior, focus, labels, semantics, and contrast were reviewed.
- [ ] Loading, error, empty, success, disabled, and destructive states exist where applicable.
- [ ] Generated UI was reviewed by a human/agent against the design system, not accepted from a screenshot alone.

## AI and data

- [ ] AI behavior follows `docs/ai/AI_RULES.md`, `docs/ai/AI_EVIDENCE_RULES.md`, and `docs/ai/AI_ACTION_POLICY.md`.
- [ ] Important outputs are schema-validated and deterministic arithmetic is tested outside the model.
- [ ] Evidence, conflicts, freshness, and insufficient-data behavior are visible.
- [ ] Relevant Promptfoo/synthetic evals pass, with model/prompt versions recorded.
- [ ] Cost, latency, privacy, rate, and fallback behavior are bounded.

## Security and operations

- [ ] Authentication, authorization, tenant isolation, input validation, upload rules, and logging were reviewed.
- [ ] Secrets are not exposed; security tooling and dependency changes were checked.
- [ ] Errors are safe and actionable; telemetry is redacted and documented.
- [ ] Documentation, env names, runbooks, and contribution notes are updated.

## Verification record

The PR records exact commands, working directory, dates, pass/fail/skip status, and any missing credentials or external services. A failed, skipped, or unrun check is not a pass.
