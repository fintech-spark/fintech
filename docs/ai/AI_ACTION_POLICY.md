# AI action policy

AI capabilities are classified by consequence. The model never grants itself permission and is never an authorization mechanism.

## Read

**Examples:** analyze records, explain a verified calculation, summarize a source, recommend a next step.

- May run only on data the authenticated user is authorized to read.
- Must respect tenant scope, evidence rules, rate limits, and redaction.
- Results are labeled as facts, calculations, interpretations, or recommendations.

## Prepare

**Examples:** draft a payment reminder, draft a supplier message, prepare a reorder suggestion, assemble a review packet.

- Produces a draft or proposed change only.
- Requires user review before any downstream action.
- Shows evidence, affected records, assumptions, and editable content.
- Does not send, place, update, or commit anything as a side effect.

## Execute

**Examples:** send a message, place an order, change a financial record, or trigger a financial action.

- Requires explicit, fresh user confirmation immediately before execution.
- Re-checks authorization, target, scope, amount, and idempotency server-side.
- Presents a clear confirmation summary and a cancellation path.
- Emits an audit event and returns a safe result; failures do not retry indefinitely.
- High-risk or financial actions may require a second approval based on policy.

## Prohibited

- LLM-generated authorization, identity, tenant selection, permission escalation, or security decisions.
- Autonomous irreversible financial actions.
- Sending or placing actions based only on model output, an extracted field that was not reviewed, or unsupported evidence.
- Hidden side effects inside read or prepare operations.
- Treating a draft, preview, simulation, or recommendation as executed state.
