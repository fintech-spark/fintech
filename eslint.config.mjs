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
        note: "Follow DESIGN_SYSTEM.md and prefer semantic design tokens.",
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
    ".agents/**",
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "node_modules/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);
