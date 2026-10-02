# GitHub security settings

These settings must be enabled in the GitHub repository/organization; workflow files alone do not enable them.

## Repository controls

- Protect the production/default branch: no direct pushes, force pushes, or branch deletion.
- Require pull requests, at least one human review, resolved conversations, and the CI, E2E, CodeQL, security, and relevant AI-eval checks before merge.
- Require branches to be up to date before merge; use squash or another agreed focused history policy.
- Restrict workflow permissions to the minimum required and keep `contents: read` by default.
- Require signed commits if the organization policy supports it.

## Advanced security

- Enable CodeQL default/setup analysis for JavaScript/TypeScript.
- Enable Dependabot version updates and security updates using `.github/dependabot.yml`.
- Enable dependency review on pull requests.
- Enable secret scanning and push protection where the repository plan supports it.
- Review Semgrep and Gitleaks results as blocking findings for high-confidence secrets/security issues.
- Protect environments and require reviewers for production deployment/secret access.

## Operational policy

- Rotate any exposed key immediately; removing it from a commit is not sufficient.
- Keep security alerts and dependency updates owned by a team, not an abandoned bot queue.
- Review action sources and major-version changes before accepting Dependabot updates.
- Store provider, Sentry, and deployment credentials in GitHub Environments/Secrets, never workflow YAML.
- Confirm workflow event permissions and fork behavior before allowing untrusted pull-request code to access secrets.

Use the checks documented in `SECURITY.md` and `CONTRIBUTING.md` as the merge baseline.
