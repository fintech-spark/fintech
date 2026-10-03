# Secure Action Execution

The security contract for the module that turns a machine-proposed intent into a real
change to a merchant's business. Read this before calling anything in
`@/modules/actions`.

---

## 1. The lifecycle

```
proposed -> drafted -> awaiting_approval -> approved -> executing -> completed
                 |            |                                      |
                 v            v                                      v
             cancelled    cancelled                                 failed
                                                                         |
                                                                         v
                                                                      drafted
```

`ACTION_STATUS_TRANSITIONS` is the single source of truth:

| From | Permitted next |
|---|---|
| `proposed` | `drafted`, `cancelled` |
| `drafted` | `awaiting_approval`, `cancelled` |
| `awaiting_approval` | `approved`, `cancelled` |
| `approved` | `executing` |
| `executing` | `completed`, `failed` |
| `completed` | — terminal |
| `failed` | `drafted` |
| `cancelled` | — terminal |

Deliberate consequences:

- **No path from `approved` back to `cancelled`.** An approved action must run or fail.
  Silently reversing it would break the audit trail.
- **`completed` and `cancelled` are terminal.**
- An **unrecognised status fails closed**: `canTransitionActionTo` returns `false` rather
  than throwing, so a malformed request cannot crash a transition.

## 2. Approval is a server-side state

The AI can call `propose` and **nothing beyond it**. Everything after approval is gated by
checks in `domain/rules.ts`, which run in the application layer — not in a prompt. A prompt
is not a control.

### Who may do what

| Operation | Roles |
|---|---|
| Propose / draft / request approval | `owner`, `admin`, `manager`, `accountant`, `staff` |
| **Approve** | `owner`, `admin`, `manager` |
| **Execute** | `owner`, `admin`, `manager`, `accountant` |

### Segregation of duties

`requiresDistinctApprover` is **true for every action type today**, because
`AUTO_EXECUTABLE_ACTION_TYPES` is empty and every action type either spends money, changes
a financial record, or communicates externally. Additionally, anything with
`source: 'ai_recommendation'` always requires a second pair of eyes, regardless of policy.

> **Product decision required.** This means a business with a single owner and no admin or
> manager cannot approve *any* action, including a manual stock reorder. That is the safe
> posture, and the policy is constructor-injected (`ApprovalPolicy`) so a deployment can
> relax it deliberately — with a record of who chose to. It is deliberately **not** a
> runtime toggle a route handler can flip.

### The proposer may not execute

At execution time the check compares the executor against **`createdBy`**, not
`approvedBy`. Comparing against the approver would forbid the approver from carrying out
what they just authorised, which is the normal flow and would leave a consequential action
with nobody able to run it.

## 3. Approval freshness

`APPROVAL_TTL_MS` = **15 minutes**, matching the requirement for "explicit, fresh user
confirmation immediately before execution".

| Situation | Denial reason |
|---|---|
| `now - approved_at > TTL` | `approval_expired` |
| `approved_at` in the future | `approval_replay` |
| No approval recorded | `approval_required` |

Without this window, an approval granted in the morning could be executed in the evening
against data that has since changed — which is exactly what a replay attack targets.

## 4. Exactly-once execution

`ActionRepository.claimForExecution` is **one conditional UPDATE**:

```sql
UPDATE actions
SET status = 'executing', updated_at = $3
WHERE business_id = $1 AND id = $2 AND status = 'approved'
```

The precondition lives inside the statement, so the **database** picks the single winner.
Concurrent requests produce exactly one `rowCount === 1`; every other call matches zero
rows and is refused as `concurrent_claim`. There is no read-then-write window to lose.

Order of operations in `execute()` is security-relevant:

1. Load the action, scoped to the tenant.
2. Evaluate every precondition against the **loaded record**, not the request.
3. Atomically claim the action.
4. Only then invoke an allowlisted executor.

`recordApproval` is likewise conditional on `status = 'awaiting_approval'`, so a duplicated
or replayed approval matches zero rows and the original approver is preserved.

### Idempotency

| Layer | Mechanism |
|---|---|
| Proposal | `actions.idempotency_key` with the partial unique index `(business_id, idempotency_key)`. One key → one action per tenant. A unique violation is translated into a read of the existing row. |
| Execution | `executionIdempotencyKey(actionId, requestKey)` derives a stable key, and the single-winner claim collapses repeats. |
| Replay after completion | The action is no longer `approved`, so a repeat is refused as `already_executed` with no side effect. |

## 5. Executor allowlist

Execution capability lives behind `ActionExecutorRegistry`, keyed by action type.

- An unregistered type **fails closed** with `no_registered_executor`.
- `freeze()` makes `register` throw afterwards, so no request path can add a capability at
  runtime — a plausible route to "the model picks its own executor" is closed structurally.
- A dedicated executor may **not** claim the `custom` type; custom actions require an
  explicit per-deployment executor so their behaviour is always reviewable.
- Two executors may not claim the same type.

There is **no** dynamic dispatch: no `eval`, no `new Function`, no string module
resolution, no shell, no HTTP fetch driven by an action's parameters.
`tests/intelligence/sql-and-boundaries.test.ts` fails the build if any of these appear.

### The module has no sibling dependencies

`MODULE_DEPENDENCIES` declares `actions: []`. The actions module imports **no** other
domain module — not analytics, not the database client. Consequences:

- Executors receive a narrow `ExecutorContext`, never a database handle. An executor that
  genuinely must write to a ledger table belongs to that table's module and is wired in by
  the composition root.
- Integer checks use `Number.isSafeInteger` directly rather than importing a shared helper,
  because importing one would be a forbidden dependency. Duplicating a one-line language
  builtin is acceptable; duplicating a domain abstraction would not be.

## 6. Parameter validation and tamper detection

Parameters originate from a model proposal, an extracted document field, or a merchant's
free text. They are treated as hostile.

`ACTION_PARAMETER_SPECS` declares, per action type, an allowlist of keys with kinds and
bounds. `validateActionParameters` rejects:

- any **undeclared** key;
- `__proto__`, `constructor`, `prototype`;
- a missing required parameter;
- non-integer or negative money, and amounts beyond `MAX_MONEY_MINOR`;
- non-integer or negative quantities, and days beyond 365;
- values outside a declared enum;
- unparseable timestamps;
- strings longer than the declared maximum.

A reserved `idempotencyKey` parameter is accepted for every type: it is a transport
concern stored in its own column and never handed to an executor.

**Tamper detection.** `hashActionParameters` hashes the type plus a canonicalised,
key-sorted parameter set. The hash is recorded at approval (in `actions.detail`) and
re-verified at execution. Any edit in between is refused as `parameter_tampering`. Key
order does not affect the hash, so a harmless re-serialisation is not a false positive.

## 7. Tenant isolation

No method accepts a business id. Every operation derives it from `TenantContext`, and every
repository query filters `business_id = $1`. An id belonging to another tenant produces
`NotFoundError` — not a partial result, and not a different status code, so a caller cannot
probe for the existence of another merchant's action.

Idempotency keys are scoped per tenant, so two businesses may legitimately use the same key.

## 8. Audit

Every transition appends an entry to `action_logs` (append-only, `ON DELETE CASCADE` from
`actions`). Each entry records: action id, business id, actor, actor role, previous state,
new state, outcome (`allowed` / `denied`), denial reason, executor id, idempotency key,
correlation id, timestamp, and the **parameter hash**.

**What is deliberately absent:** parameters themselves, message bodies, customer names,
amounts and idempotency keys from unrelated entries. Only the hash travels. `action_logs`
`metadata` carries no hidden prompt, no model output and no credential.

A state transition and its audit entry must both land. The repository exposes
`appendAuditInTransaction` for callers that need the pair atomic.

## 9. Denial reasons

| Reason | Meaning |
|---|---|
| `cross_tenant` | The action does not belong to the requesting business. |
| `insufficient_role` | The actor's role may not perform this operation. |
| `approval_required` | No recorded approval. |
| `approval_expired` | The approval is older than `APPROVAL_TTL_MS`. |
| `approval_replay` | The approval timestamp is in the future. |
| `self_approval_forbidden` | The proposer tried to approve or execute their own consequential action. |
| `parameter_tampering` | Parameters changed after approval. |
| `no_registered_executor` | The action type has no allowlisted executor. |
| `unknown_action_type` | The type is not in the schema's `CHECK` constraint. |
| `already_executed` | The action is already `executing` or `completed`. |
| `concurrent_claim` | Another request won the execution claim. |
| `idempotency_conflict` | The key is bound to a different action. |
| `invalid_state_transition` | The transition is not permitted. |

Every denial is audited **before** the result is returned.

## 10. Failure handling

An executor that throws is captured as a typed failure, not propagated. An action already
claimed must reach a terminal state; leaving it in `executing` forever would be
indistinguishable from a stuck worker. Failures do not retry indefinitely — a retry is a
new, separately approved transition.

## 11. Red-team coverage

All twelve required attack scenarios are implemented in
`tests/intelligence/actions-security.test.ts`, plus cases for self-approval, role
escalation, double approval, prototype pollution, oversized ids, parameter tampering,
executor failure, and audit-scope isolation.

## 12. Wiring

```ts
const registry = new ActionExecutorRegistry()
  .register(reminderExecutor)
  .register(reorderExecutor)
  .freeze();                      // no runtime registration after this

const actions = new PostgresActionService(
  actionRepository,               // PostgreSQLActionRepository
  registry,
  systemClock,
  eventBus,
  // approvalPolicy: omit for the secure default
);
```

Register the service in `lib/registry.ts` as `actions`. The Business Brain reaches it
through the module registry and can only ever call `propose`.