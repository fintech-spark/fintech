# AI Engineering & Reliability Rules

This rule governs the implementation and evaluation of AI capabilities within Merchant Brain, ensuring reliable, verifiable, and injection-resistant systems.

## Core Architectural Invariants

1. **Deterministic Arithmetic Over Model Guesses**:
   - Models are NOT authoritative for financial calculations, ledger arithmetic, tax computations, or business rule validation.
   - All financial numbers, totals, profit margins, and metrics MUST be computed by deterministic TypeScript domain logic; models may only explain or interpret verified outputs.

2. **Strict Structured Output with Zod**:
   - Every AI generation intended for programmatic consumption MUST use structured outputs backed by strict Zod schemas.
   - Reject malformed or unvalidated model responses immediately; never silently coerce or guess missing fields.

3. **Prompt Injection Defense**:
   - Always sanitize and isolate untrusted content (uploaded document text, OCR results, user messages).
   - Use delimiter isolation:
     ```text
     <untrusted_content>
     ${untrustedInput}
     </untrusted_content>
     ```
   - Explicitly instruct the model to treat content inside untrusted tags as pure data to analyze, never as operational instructions or system commands.

4. **Version-Controlled Prompts**:
   - Prompts must live in dedicated files under `prompts/`, version-controlled and documented with intended inputs and outputs.
   - Never embed multi-paragraph prompts inline inside React UI components or database repositories.

5. **Synthetic Evaluations**:
   - Any prompt modification must be accompanied by synthetic evaluation fixtures under `evals/`.
   - Measure accuracy, instruction adherence, and injection resistance using Promptfoo or automated test harnesses.

6. **Provider Abstraction**:
   - Access AI capabilities exclusively through centralized provider adapters under `lib/ai/`.
   - Support model fallback mechanisms and telemetry tracking for token usage, latency, and cost.
