# Workflow notes

- `ci.yml` is the required install/lint/typecheck/unit/build gate.
- `e2e.yml` installs Chromium and runs Playwright on UI-related changes.
- `security.yml` runs npm audit, dependency review, Gitleaks, and native Semgrep CE.
- `codeql.yml` runs CodeQL for JavaScript/TypeScript.
- `ai-evals.yml` is manual and requires an explicit provider-backed `evals/promptfooconfig.yaml`; it is intentionally not run on every PR.
- `semgrep.yml` is a manual documentation marker; the actual scan is in `security.yml` to avoid the deprecated Semgrep wrapper action.

Enable branch protection and required checks in GitHub as described in `GITHUB_SECURITY.md`.
