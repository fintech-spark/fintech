import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Evaluation config — deliberately separate from `vitest.config.ts`.
//
// `npm test` is the fast unit gate. `npm run eval` is the AI evaluation gate:
// deterministic, offline, and it never contacts a model provider, so it needs no
// API key, no budget approval and no network. That separation is what lets the
// evaluation suite run in CI today.
//
// Provider-backed evals (extraction accuracy, grounding, hallucination rate,
// multi-model agreement) are NOT wired here: they need a model, a budget and an
// approved secret policy. `evals/promptfooconfig.yaml` stays the placeholder for
// those. See `evals/README.md`.

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