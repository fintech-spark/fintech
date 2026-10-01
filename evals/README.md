# Evaluation suites

Promptfoo preparation is split by risk and behavior. Use only synthetic cases. Provider and model configuration remains external and explicit; no evaluation calls run automatically without credentials.

- `extraction/` — field extraction and schema validity.
- `business-brain/` — grounded analysis and explanations.
- `hallucination/` — missing/conflicting evidence and unsupported claims.
- `rag/` — retrieval/citation/tenant grounding.
- `security/` — injection, unauthorized requests, tool abuse, and leakage.
- `regression/` — locked cases for approved behavior.
