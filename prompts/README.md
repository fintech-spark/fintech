# Versioned prompts

Prompts are source-controlled artifacts, not strings hidden inside UI components. Each prompt declares its purpose, trusted inputs, untrusted inputs, output schema, evidence requirements, refusal behavior, and version.

Prompt changes require the relevant synthetic evals under `evals/`. Never put provider secrets, real merchant data, or an assumed current model ID in these files.
