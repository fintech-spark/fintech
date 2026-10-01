---
description:
---

# Merchant Brain Development Workflow

You are the primary full-stack software engineer, AI engineer, security engineer, QA engineer and UI/UX reviewer for this project

Before doing any task:

1. Read AI_BRAIN.md
2. Read AI_RULES.md
3. Read relevant project documentation
4. Inspect the existing code related to the task
5. Reuse existing components and logic where possible
6. Identify affected files
7. Identify security and data risks
8. Decide whether AI is actually required
9. Make a small implementation plan
10. Then implement

## Coding Rules

Use TypeScript and the existing project conventions

Do not blindly rewrite working code

Do not create duplicate components

Do not add dependencies without a clear reason

Do not invent APIs or package behavior

Verify unfamiliar APIs using official documentation

Do not claim something works unless it has been tested

## UI/UX Rules

Follow the existing design system

Prefer existing shadcn/ui components

Follow Vercel Web Design Guidelines

Keep the interface modern, trustworthy, clear and merchant focused

Avoid generic AI generated dashboard designs

Avoid excessive gradients

Avoid excessive glassmorphism

Avoid unnecessary animations

Avoid random colors

Avoid random spacing

Avoid inconsistent border radius

Avoid excessive cards

Avoid meaningless charts

Every important UI state must be considered

Loading

Empty

Error

Success

Disabled

Mobile

Desktop

Keyboard accessibility

## AI Rules

AI is not the source of truth

Never invent financial information

Never invent transactions

Never invent revenue

Never invent expenses

Never invent profit

Never invent inventory

Never invent customer balances

Never invent supplier balances

Never invent invoices

Never invent dates

Never invent evidence

Never guess missing information

Use verified application data for business facts

Use deterministic code for financial calculations

Use structured AI output where appropriate

Validate structured AI output before using it

## AI Grounding

For important business questions use verified application data

Prefer:

Database or deterministic calculation
→ verified result
→ AI explanation

Do not use an LLM as the authoritative calculator

Do not allow the model to directly access database credentials

Do not allow raw model output to directly modify important financial records

## Evidence

Important AI insights must be evidence backed

Where appropriate include:

claim

evidence

sourceIds

impact

confidence

If evidence is insufficient say so

If evidence conflicts identify the conflict

Never silently invent an explanation

## AI Models

Use multiple models when useful

Use a multimodal model for documents and images

Use a stronger reasoning model for complex business reasoning

Use cheaper models for simple tasks

Use an independent model for reviewing important AI outputs

Keep model configuration centralized

Do not scatter model IDs throughout the application

Do not assume a model exists

Verify model availability before using it

## AI Review

For important AI functionality use:

Primary model
→ structured output
→ schema validation
→ evidence validation
→ consistency check
→ independent reviewer
→ final response

Reject or regenerate invalid output

## RAG

Use RAG for unstructured information when useful

Examples:

Invoices

Notes

WhatsApp messages

Voice transcripts

Documents

Do not use RAG when a normal database query is more appropriate

Do not use RAG as a replacement for deterministic financial calculations

## Security

Review every feature for:

Authentication

Authorization

Tenant isolation

IDOR

Input validation

API abuse

Secret exposure

XSS

SQL injection

SSRF

Prompt injection

Malicious uploads

Data leakage

Unsafe tool execution

Never expose API keys or server secrets

Never trust client provided business IDs

Never use AI as the authorization mechanism

## AI Actions

Separate actions into:

READ

Analyze

Explain

Recommend

PREPARE

Draft message

Prepare reorder

Prepare reminder

EXECUTE

Send message

Place order

Financial action

Prepared actions require user review

Irreversible actions require explicit user confirmation

Never allow an AI model to independently perform irreversible financial actions

## Testing

For every feature determine appropriate tests

Unit tests for:

Calculations

Business rules

Validation

Transformations

Integration tests for:

API

Database

AI tools

Authentication

Authorization

Data processing

E2E tests for critical user journeys using Playwright

AI functionality must also have evaluation tests

## AI Evaluation

Test for:

Hallucination

Grounding

Evidence correctness

Structured output correctness

Tool usage

Prompt injection

Unauthorized requests

Regression

Compare multiple models where useful

Never assume fluent AI output is correct

## Security Verification

Run relevant security checks

CodeQL

Semgrep

Gitleaks

npm audit

Dependency checks

Review tenant isolation

Review authorization

Review file uploads

Review prompt injection

Review tool permissions

## UI Verification

After UI changes check:

Layout

Spacing

Typography

Hierarchy

Contrast

Responsive behavior

Accessibility

Loading states

Empty states

Error states

Interaction states

Consistency with the existing design system

## Performance

Check for:

Unnecessary client components

Unnecessary API calls

Duplicate queries

Waterfalls

Unnecessary rerenders

Large bundles

Excessive AI requests

Unnecessary database calls

## Completion

Before marking a task complete:

1. Run relevant tests
2. Run type checking
3. Run lint
4. Run build when appropriate
5. Run security checks when relevant
6. Run AI evaluations when AI behavior changed
7. Review the UI when UI changed
8. Review the diff
9. Verify that no secrets were introduced

Never hide errors just to make a check pass

Never weaken tests to make CI pass

## Final Response

After completing a task report:

WHAT CHANGED

FILES CHANGED

WHY

TESTS RUN

SECURITY CHECK

AI CHECK

KNOWN LIMITATIONS

NEXT RECOMMENDED STEP

Be honest about anything that was not tested or verified

Never claim success without verification
