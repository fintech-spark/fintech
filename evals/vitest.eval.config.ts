import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Evaluation config — deliberately separate from `vitest.config.ts`.
//
// `npm test` is the fast unit gate. `npm run eval` is the AI evaluation gate:
// deterministic, offline, and it never contacts a model provider, so it needs no
// API key, no budget approval and no network. That separation is what lets the
// evaluation suite run in CI today.
//
// Live provider calls run only through evals/vitest.live.config.ts with an
// explicit AI_EVAL_LIVE=1 opt-in. They are excluded from this offline gate.

const root = path.resolve(import.meta.dirname, '..');

export default defineConfig({
  resolve: {
    alias: {
      '@': root,
      'server-only': path.resolve(root, './tests/stubs/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['evals/**/*.eval.test.ts'],
    testTimeout: 20000,
    reporters: ['default'],
  },
});
