import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

// The live-database suite lives in `tests/intelligence/live-db/` and is EXCLUDED
// from the default run.
//
// The exclusion is deliberate and is not a silent skip. Those tests open a real
// PostgreSQL connection and execute real statements; `npm test` must stay usable
// for a contributor or CI job that has no database. They are run explicitly and
// loudly instead:
//
//   DATABASE_URL=postgresql://... npm run test:db:live
//
// `vitest.live.config.ts` selects that directory, and it FAILS IMMEDIATELY when
// DATABASE_URL is absent rather than quietly passing. So the suite can never
// report success without having talked to a real server.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "tests/intelligence/live-db/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});