# Contributing

Merchant Brain is prepared for focused, reviewable work. Product implementation begins only after the requirements and UI flows are approved.

## Branches

Use one of:

- `feature/<short-name>`
- `fix/<short-name>`
- `refactor/<short-name>`
- `test/<short-name>`
- `security/<short-name>`
- `docs/<short-name>`

## Pull requests

- Keep a PR focused and explain the user/engineering outcome.
- Inspect and reuse existing code before adding files or dependencies.
- Review AI-generated code, prompts, schemas, and workflow changes as carefully as human code.
- Include tests, security impact, UI/accessibility review, and documentation updates where relevant.
- Do not commit secrets, real personal/financial data, generated build output, or provider payloads.
- Do not bypass CI, disable security checks, or force-merge a failing check.

## Before requesting review

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e       # when browser dependencies are installed and UI changed
npm run security:audit # when dependency/security scope changed
```

Report skipped checks and required credentials explicitly. Never describe a check as passed unless it ran successfully.

## Commit hygiene

Use clear imperative messages, keep commits focused, and avoid mixing dependency upgrades with unrelated product changes. Keep the lockfile synchronized with `package.json`.
