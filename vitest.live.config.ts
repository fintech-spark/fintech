import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

// Live-database test configuration.
//
// Selects only `tests/intelligence/live-db/`, which the default config excludes.
// Files run sequentially (`fileParallelism: false`) because both suites seed and
// clean the same two synthetic tenants; in parallel they would delete each
// other's fixtures mid-run.
//
// This config refuses to start without DATABASE_URL. Failing here is deliberate:
// a live-database suite that quietly passes because it never connected would be
// worse than no suite at all.
//
//   DATABASE_URL=postgresql://postgres:postgres@localhost:55432/merchant_brain \
//     npm run test:db:live
const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.trim() === "") {
  throw new Error(
    [
      'DATABASE_URL is required to run the live database suite.',
      '',
      'These tests execute the real analytics, cash-flow, profit-leak, simulator',
      'and action repositories against a real PostgreSQL server. They cannot run',
      'without one, and they will not be skipped.',
      '',
      'Start the verify container and run:',
      '  docker run -d --name mb-verify -p 55432:5432 \\',
      '    -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=merchant_brain pgvector/pgvector:pg16',
      '  npm run db:migrate',
      '  DATABASE_URL=postgresql://postgres:postgres@localhost:55432/merchant_brain \\',
      '    npm run test:db:live',
    ].join('\n'),
  );
}

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./"),
      "server-only": path.resolve(
        import.meta.dirname,
        "./tests/stubs/server-only.ts",
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/intelligence/live-db/**/*.test.ts"],
    exclude: [...configDefaults.exclude],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});