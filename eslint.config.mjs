import { defineConfig, globalIgnores } from "eslint/config";
import { plugin as shadcn } from "@shadcn/lint";
import nextTs from "eslint-config-next/typescript";
import nextVitals from "eslint-config-next/core-web-vitals";
import tsParser from "@typescript-eslint/parser";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { shadcn },
    settings: {
      shadcn: {
        ui: "@/components/ui",
        note: "Follow docs/product/DESIGN_SYSTEM.md and prefer semantic design tokens.",
      },
    },
    rules: {
      "shadcn/no-arbitrary-values": "error",
      "shadcn/no-inline-styles": "error",
      "shadcn/no-raw-colors": "error",
    },
  },
  {
    // shadcn-generated primitives own their internal implementation classes.
    // Page and feature code remains subject to the design-system rules above.
    files: ["components/ui/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "shadcn/no-arbitrary-values": "off",
    },
  },
  globalIgnores([
    // Nested git worktrees belonging to other agents on this machine. They
    // are separate projects with their own tsconfigs; linting or typechecking
    // them from here reports their work as our failures.
    "fintech-ai/**",
    "fintech-backend/**",
    "fintech-intelligence/**",
    "fintech-security/**",
    ".obsidian/**",
    ".agents/**",
    ".kilo/**",
    ".next/**",
    ".next-production/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "node_modules/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);
