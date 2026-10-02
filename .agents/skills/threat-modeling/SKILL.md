---
name: threat-modeling
description: Systematic threat modeling using the STRIDE methodology. Use when designing new architecture, adding third-party integrations, designing database schemas, or evaluating tenant isolation boundaries.
---

# Threat Modeling Skill (STRIDE)

This skill guides engineers through systematic threat modeling to identify and mitigate vulnerabilities early in the design phase.

## When to Activate

- Designing a new domain module or service architecture
- Adding third-party integrations (payment processors, bank aggregators, SMS gateways)
- Changing authentication, authorization, or session management
- Implementing file ingestion or external data pipelines
- Reviewing multi-tenant database isolation

## STRIDE Framework Matrix

| Threat Category | Property Violated | Merchant Brain Risk Context | Primary Mitigation |
| :--- | :--- | :--- | :--- |
| **Spoofing** | Authenticity | Illegitimate user pretending to be merchant admin | Multi-factor auth, verified server sessions, cryptographically signed tokens |
| **Tampering** | Integrity | Manipulating transaction ledger entries or cash calculations | Immutable audit trail, integer minor-unit money types, parameterized SQL |
| **Repudiation** | Non-repudiation | Merchant claims they never authorized an expense or payout | Append-only audit log with verified user ID, IP address, and timestamp |
| **Information Disclosure** | Confidentiality | PII, competitor transaction data, or API keys leaked | Multi-tenant query isolation (`WHERE business_id = $1`), secret manager, redaction in logs |
| **Denial of Service** | Availability | Ingestion endpoint flooded with gigabytes of dummy receipts | Strict payload size limits, token bucket rate limiting, async job queuing |
| **Elevation of Privilege** | Authorization | Read-only clerk executing payout or accessing other tenant data | Role-based access control (RBAC), tenant context scoping at service layer |

## Threat Modeling Steps

1. **Deconstruct the Application**:
   - Trace data flow from Client Browser -> Next.js Route Handler -> Domain Application Service -> Database / AI Provider.
2. **Identify Trust Boundaries**:
   - External Web (Untrusted) | Next.js Edge/Server (Trusted)
   - Next.js Server (Trusted) | PostgreSQL Database (Isolated)
   - Next.js Server (Trusted) | AI Model Provider (Third-party)
3. **Apply STRIDE to Each Element**:
   - Check every data store for tampering and information disclosure.
   - Check every data flow across trust boundaries for spoofing and eavesdropping.
4. **Define Mitigations & Residual Risk**:
   - Map mitigations to code artifacts (e.g. Zod validators, session guards, database filters).
   - Document any accepted residual risk in `docs/ADR.md`.
