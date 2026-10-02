# Merchant Brain product specification

This is a product direction document for future planning. It does not authorize implementation or finalize architecture.

## Problem

Small merchants often have business truth spread across invoices, receipts, UPI screenshots, expenses, WhatsApp orders, voice notes, CSV/Excel files, sales, inventory, customers, receivables, suppliers, and payables. Existing software asks merchants to become data-entry operators and often hides why a number or recommendation exists.

## Target merchant

A small merchant or owner-operator with limited time, mixed digital/physical records, uneven bookkeeping discipline, and a need for plain-language answers about cash, profit, stock, customers, and suppliers. The first target segment, geography, language, and compliance needs remain product decisions.

## Philosophy and USP

**"Don't make the merchant learn software. Make the software understand the merchant."**

Merchant Brain should turn messy business data into a trustworthy business understanding: detect a problem, explain why with evidence, simulate a choice, and prepare a safe next action. It should reduce entry burden without hiding uncertainty or taking authority away from the merchant.

## Future feature directions

- Zero-entry ingestion across documents, screenshots, audio, messages, CSV, and Excel.
- Business Brain that describes verified business state and data quality.
- Profit Leak Radar, Cash-Flow Rescue, and What-If Simulator.
- AI Action Center for reviewed drafts and confirmed actions.
- Business Assistant with evidence-backed answers.
- Inventory, customer receivables, and supplier intelligence.
- Evidence and “Why am I seeing this?” for material claims.

## MVP candidates

The MVP should be narrowed and approved before implementation. Candidates are:

1. Merchant context and consent-driven onboarding.
2. A limited, explicit ingestion path with extraction review before use.
3. Verified business summary with freshness, gaps, conflicts, and evidence.
4. One high-value insight workflow, likely a narrowly scoped profit or cash-flow problem.
5. Evidence inspection and safe recommendation/draft behavior.
6. Basic evaluation, monitoring, and correction feedback.

These are candidates, not committed scope. The exact input types, supported currency/language, role permissions, and success criteria require approval.

## Stretch features

Voice and multilingual inputs, WhatsApp integration, richer inventory forecasting, supplier/customer messaging, scenario comparison, recurring data sync, more provider routing, and action execution with stronger approvals.

## User flow themes

- **Understand:** user sees what data is verified, incomplete, stale, or conflicting.
- **Inspect:** user opens the source records behind a claim.
- **Correct:** user reviews/corrects extracted values before downstream analysis.
- **Decide:** user compares a transparent scenario or recommendation.
- **Prepare:** user edits a proposed message/order/reminder.
- **Confirm:** user explicitly approves an allowed action and receives an audit result.

## Success metrics

Measure time to first useful verified insight, extraction correction rate, evidence inspection/usefulness, unsupported-claim rate, task completion, recommendation follow-through, merchant-reported confidence, retention, latency, cost per useful insight, and critical error/security rates. Baselines and targets are not yet approved.

## Explicitly excluded from MVP

- Autonomous financial actions, payments, purchases, or message sending.
- Unsupported accounting/tax/legal advice or guaranteed profit forecasts.
- A broad ERP replacement, full bookkeeping suite, or multi-country compliance promise.
- Production-grade integrations before consent, authorization, rate, privacy, and failure behavior are designed.
- Fake dashboards, fake AI answers, or unverified business facts used to make a demo look complete.
