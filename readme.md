# Merchant Brain

Merchant Brain is an AI-powered business-brain concept for small merchants. This repository is currently a **development foundation only**: product routes, business logic, production data, and AI responses have intentionally not been built.

## Foundation

- Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4
- shadcn/ui preparation with Radix primitives and Lucide icons
- Vercel AI SDK provider packages for future model integration
- Zod, React Hook Form, Recharts, Vitest, and Playwright
- Project-wide agent, design, AI reliability, security, evaluation, and contribution rules
- CI, CodeQL, Semgrep, Gitleaks, Dependabot, and Promptfoo preparation
- Next.js DevTools MCP configuration for runtime-aware coding agents

## Checks

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e:install
npm run test:e2e
```

Read `SETUP_AUDIT.md` for the baseline audit and `AGENTS.md` before making changes. Do not start product implementation until the requirements and UI flows are approved.
