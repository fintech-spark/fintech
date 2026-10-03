import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./"),
      // Let server-only modules be imported by unit tests. Next.js
      // still enforces the real boundary at build time; see
      // tests/stubs/server-only.ts.
      "server-only": path.resolve(
        import.meta.dirname,
        "./tests/stubs/server-only.ts",
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
