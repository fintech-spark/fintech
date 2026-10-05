import { defineConfig } from "vitest/config";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
if (process.env.AI_EVAL_LIVE !== "1") throw new Error("Live evals require explicit AI_EVAL_LIVE=1 opt-in.");
for (const file of [".env.local", ".env"]) {
  try { process.loadEnvFile(path.join(root, file)); }
  catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw new Error("Evaluation environment could not be loaded."); }
}
const provider = process.env.AI_EVAL_PROVIDER ?? process.env.AI_PROVIDER ?? "google";
const configured = provider === "google" ? Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY) : provider === "openai" ? Boolean(process.env.OPENAI_API_KEY) : provider === "anthropic" ? Boolean(process.env.ANTHROPIC_API_KEY) : false;
if (!configured) throw new Error("Selected evaluation provider has no configured server credentials.");
process.env.AI_EVAL_PROVIDER = provider;

export default defineConfig({
  resolve: { alias: { "@": root, "server-only": path.join(root, "tests/stubs/server-only.ts") } },
  test: { environment: "node", include: ["evals/provider/*.live.test.ts"], testTimeout: 60000, fileParallelism: false, reporters: ["default"] },
});
