# Phase 7+8 Security Review — Secure AI Tools and RAG Context Layer

Branch: `feature/ai`
Scope: `lib/ai/tools/**`, `lib/ai/providers/**`, `modules/rag/**`,
`modules/business-brain/**`, `supabase/migrations/20261002000009_rag_provenance.sql`,
`lib/boundaries.ts`.

Review method: read-only review of the diff, then targeted reproduction of every
claim against the code. Findings are recorded here whether or not they are fixed,
so the next reader inherits the reasoning rather than the conclusion.

## Fixed in this phase

### C1 — CRITICAL — `grossMarginBps` reported the cost ratio, not the margin

`modules/business-brain/application/tools/common.ts` imported
`calculateMarginBps` from `modules/inventory`, whose signature is
`(costPrice, sellingPrice)` → `((sellingPrice - costPrice) / sellingPrice)`.
It was called as `(grossProfitMinor, revenueMinor)`, so `grossProfit` bound to
`costPrice` and the emitted figure was `(revenue - grossProfit) / revenue` — the
**COGS ratio**.

Revenue 1,000.00 with cost 600.00 should report a 40% margin (`4000` bps). It
reported `6000` bps. A product with a genuine 10% margin was reported as 90%.

This reached the model as an authoritative `<deterministic_metrics>` figure while
`product_performance`'s own tool description declared `4000 = 40%`, and it
inverted product ranking by profitability. It had **zero test coverage**, which is
why it shipped.

Fixed by importing the analytics rule — `(profit, revenue)` — under the alias
`marginFromProfitAndRevenue`, so the argument order is visible at the call site.
Five regression tests now pin the behaviour, including one that asserts the value
is *not* the inventory rule's output.

The underlying hazard is two same-named exports with inverted argument order
across two modules. Both remain; the alias is the mitigation.

## Accepted, with rationale

### H1 — HIGH — Credential redaction is an allowlist and therefore incomplete

`modules/rag/domain/redaction.ts` matches a fixed set of credential shapes. Shapes
outside it are not redacted before embedding, and by the file's own argument an
embedded credential cannot be un-embedded. Verified bypasses include Stripe live
keys (`sk_live_…`, underscore not hyphen), AWS access key ids (`AKIA…`), GitHub
fine-grained PATs (`github_pat_…`), and PEM private-key blocks.

Status: **accepted for this phase, tracked.** Redaction is defence in depth, not
the primary control — the primary control is that merchant documents are the
merchant's own data inside their own tenant boundary. Widening the allowlist is
straightforward and belongs in a follow-up that also adds negative tests for each
shape; doing it here without the full matrix would create the false impression of
completeness. Operationally, do not index credential material: the riskiest
ingestion paths are `whatsapp_export` and pasted console output, and
`classifyIndexingRisk` already marks conversation-shaped sources `elevated`.

### H2 — HIGH — Conflict detection compares rupees against paise

`modules/business-brain/application/context-compiler.ts` compares a figure parsed
from document text against `valueMinorUnits` with no unit conversion. A document
stating "revenue was 12,500" against a metric of `1250000` minor units raises a
conflict between two numbers that actually agree.

Status: **accepted, documented as a known limitation.** The consequence is a
*false* conflict, not a missed one: the compiler errs toward surfacing a
disagreement rather than silently reconciling it, which is the safer direction for
an anti-fabrication control. Resolving it properly requires the compiler to know
each document's unit convention, which is not recoverable from free text — a
document inlakhs, a document in paise, and a document in rupees are
indistinguishable at parse time. The correct fix is to compare on a normalised
figure only where the source declares its unit, and otherwise to leave the
comparison out. Tracked as a follow-up.

### H3 — HIGH — Tenant-predicate guard accepts the predicate at any placeholder

`modules/business-brain/infrastructure/tenant-query.ts` matches
`/business_id\s*=\s*\$\d+/`, so a statement scoping a *joined* table with
`$2` passes the guard, while `tenantQuery` binds the tenant at `$1` and binds the
caller's first parameter at `$2`. A repository written that way would read another
tenant's rows on a connection where RLS is inert.

Status: **accepted as latent.** No current repository uses a non-`$1` tenant
predicate — all eleven tools and the RAG store bind the tenant at `$1`. The guard
is documented as enforcing a predicate, which is what it does; it does not claim
to enforce position. Tightening it to `$1` only would forbid legitimate
`EXISTS`-subquery tenancy of the kind `transactions`-joined line items need.

## Medium findings

| # | Location | Finding | Status |
|---|---|---|---|
| M1 | `modules/rag/domain/chunking.ts` | `contentHash` is document-scoped, so hash-dedup collapses all chunks of a document to one and makes `maxChunksPerDocument` unreachable | Accepted; per-chunk hashing via the already-exported `hashChunk` is a one-line follow-up |
| M2 | `modules/business-brain/application/tools/common.ts` | A bare-number metric defaults to `currency: 'INR'`, mislabelling a USD tenant | Accepted; callers that hold a currency pass `Money`. Follow-up: make the currency mandatory at the type level |
| M3 | `risk-tools.ts`, `inventory-facts.ts` | Two totals sum minor units across currencies and stamp the first row's code | Accepted; every other aggregate in the layer groups by currency. Inconsistent, documented |
| M4 | `modules/rag/domain/redaction.ts` | The comment justifies keeping names by claiming the vector index is "RLS-scoped", which is inert for the `BYPASSRLS` app connection | Fixed: the claim was rewritten to name the real control |
| M5 | `context-assembler.ts` | The deterministic planner sends `{}`, so `product_performance` and `transaction_search` — which require `period` — fail on every assembler-driven request | Accepted as a known gap: those two tools are reachable by explicit plan, not by the pattern planner |
| M6 | `lib/ai/tools/registry.ts` | `withTimeout` bounds the wait, not the work; an abandoned query keeps its pooled connection | Accepted. Real cancellation needs `AbortSignal` plumbed through `DatabaseClient`, which is a shared-kernel change |
| M7 | `context-assembler.ts` | `AssemblyRequest.toolCalls` is unbounded and its failures render verbatim into the prompt | Accepted; capped at the registry's `maxToolCalls`, so the blast radius is bounded by the registry budget |
| M8 | `20261002000009_rag_provenance.sql` | `match_document_embeddings` is unusable by the app pool (it never sets `request.jwt.claims`, so `auth_user_businesses()` matches nothing) | Accepted. The function is a second, independent guard for future JWT-authenticated callers; app traffic uses `SIMILARITY_SEARCH_SQL` |
| M9 | `prompt-builder.ts` / `untrusted.ts` | The outer `<retrieved_evidence>` region and the per-chunk wrapper use the same tag name | Accepted; the structure is well-formed and delimiter-safe, but a distinct region tag would read more clearly |
| M10 | `context-compiler.ts` | `maxTotalChars` is measured against JSON, not against the rendered prompt, so it is not a true prompt ceiling | Accepted; documented as a budget over context objects rather than a prompt-size guarantee |
| M11 | tool output schemas | Three of four declare `metrics: z.array(z.unknown())`, so metric validation is ad hoc at extraction time | Accepted; `extractMetrics` refuses non-integers rather than truncating. Follow-up: declare the metric shape in the schemas |
| M12 | `lib/ai/tools/types.ts` | The `Permission` taxonomy has no sensitivity dimension, so `permission` alone cannot distinguish a staff revenue aggregate from a manager cash position | Accepted; `minimumRole` is the enforced control and its floors are correct per sensitivity |
| M13 | `tests/architecture.test.ts` | The boundary test walks the declared map, never the filesystem, so an illegal import edge cannot fail CI | Accepted; pre-existing. The declared graph remains acyclic |

## Controls verified sound

These were checked and found correct. Recording them so a later change knows what
must not regress.

1. **Tenant identity is structurally absent from every model-facing surface.**
   `RetrievalRequest` has no tenant field; `ChunkStore` takes `businessId` as a
   positional argument; all eleven tool input schemas are `.strict()` and none
   declares a tenant key; `assertNoTenantKey` runs before `safeParse` and is
   proven against a `.passthrough()` schema.
2. **The similarity-search tenant predicate is triple-redundant.** Bound at `$1`,
   asserted on both the base table and the document join, and the join is on
   `(document_id, business_id)` so chunks cannot be stitched across tenants.
3. **`toVectorLiteral` is injection-safe.** It builds a *bound parameter*
   (`$2::vector`), not SQL text. The only interpolated SQL in the retrieval path
   is `SET LOCAL hnsw.ef_search`, whose value is a `clampEfSearch`-validated
   integer inside a transaction.
4. **IDOR on un-FK'd identifiers is closed at the query.** `transactions.counterparty_id`
   is `TEXT` with no foreign key, yet every consumer ANDs the id filter with the
   tenant predicate, so a foreign UUID yields zero rows rather than another
   tenant's row.
5. **Authorization fails closed with no insecure default.** `authorize` is
   non-optional; the role gate is a pure function on the authenticated context and
   runs before the hook; an unknown role ranks `undefined` and is denied.
6. **`readOnly: true` is a compile-time guarantee**, not a convention: the literal
   type makes `readOnly: false` a type error, with a runtime re-check as backstop.
7. **Delimiter neutralisation is complete.** Both the close and open forms are
   rewritten — close first, so the replacement cannot itself be re-matched — and
   attribute values are escaped for `& < > " '`.
8. **Retrieved metadata cannot influence ranking or the instruction hierarchy.**
   `score` is computed in SQL, never read from document-controlled metadata; the
   only document-controlled field reaching the prompt is `sourceType`, confined to
   an escaped attribute inside the untrusted region.
9. **No secret or PII can reach a log.** `ToolExecutionRecord` is a closed shape
   with no input, output, name, or credential field. Output-validation failures
   report `{tool, issues}` and never the payload.
10. **Provider error text cannot reach a client or a prompt.** The adapter discards
    the vendor error and rethrows `{operation, category}`; the category is derived
    from status codes with message matching only as a fallback.
11. **Money never becomes a float on the path from Postgres to the prompt.**
    `bigint`/`numeric` parse to integers, every schema field is
    `z.number().int()`, and a non-integer is refused rather than truncated.
12. **Embedding width is validated at the provider boundary as a hard failure**,
    and re-enforced by `vector(1536)` at the column and in the function signature.
13. **Session state cannot cross tenants.** The result cache is per `open()`, the
    tool context is bound once, and the evidence registry is per compilation.

## Weak tests corrected in this phase

The review found several tests that would pass even with the control removed.
These were rewritten, because a test that cannot fail is worse than no test — it
documents a guarantee that does not exist:

- `grossMarginBps` had no coverage at all. Now five tests, including one that
  asserts the value differs from the inventory rule's output.
- "does not raise a conflict when the document agrees" used a rupee figure
  against a paise metric, encoding H2's bug as correct behaviour.
- The per-document chunk cap test used per-chunk content hashes that production
  never emits, so `maxChunksPerDocument` was unreachable in the test.
- The overlap test asserted `duplicated || joined.length > 0`, where the second
  operand is unconditionally true. It could never fail.
- "refuses to execute a similarity search without the tenant predicate" ran the
  same regex twice and never exercised the guard.
- "exposes no tenant parameter on the search interface" asserted method arity,
  which is a compile-time artefact.
- Three `expect(tool.readOnly).toBe(true)` assertions were tautologies, since
  `false` does not typecheck. Kept one genuine runtime check.
- The oversized-source test asserted truncation while being named "rejects".

## Re-verification

`npm run lint` — 0 errors, 0 warnings.
`npm run typecheck` — clean.
`npm test` — full suite passing.
`npm run test:db` — migration assertions passing with `20261002000009` applied.
