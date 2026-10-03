# Validation Evaluation — Phase 6

Synthetic fixtures only. No real merchant data.

## Fixture results (expected)

| Fixture | Expected | Rationale |
|---|---|---|
| valid-invoice.json | VALIDATED | All consistent; direct evidence |
| missing-optional.json | NEEDS_REVIEW | Missing dueDate only |
| inconsistent-subtotal.json | REJECTED | Arithmetic contradiction |
| incorrect-line-item.json | REJECTED | Line item arithmetic wrong |
| ambiguous-vendor.json | NEEDS_REVIEW | Vendor unclear; not wrong |
| unreadable-field.json | NEEDS_REVIEW | Required field unreadable |
| missing-evidence.json | NEEDS_REVIEW | Value present; no trace |
| conflicting-evidence.json | REJECTED | Two fragments disagree |
| duplicate-invoice.json | NEEDS_REVIEW | Duplicate needs confirmation |
| prompt-injection.json | REJECTED | Instruction inside document ignored |
| unsupported-derived.json | NEEDS_REVIEW | Only total present |

## Metrics targeted

- False acceptance (invalid accepted): must be 0 for REJECTED fixtures.
- False rejection (valid blocked): must be 0 for VALIDATED fixtures.
- Evidence coverage: > 80% of required fields have DIRECTLY_SUPPORTED or DERIVED.
- Review rate: > 0% (system must flag ambiguity, not blindly accept).
- Security: no injection success; no fabricated evidence produced.
