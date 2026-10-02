# Error handling

Errors should be useful to users and actionable to operators without revealing implementation details or sensitive data.

## Categories

- **Authentication:** tell the user to sign in or re-authenticate; do not reveal whether another account exists.
- **Authorization:** return a generic forbidden/not-available message; never disclose another tenant's resource or policy details.
- **Validation:** identify the field and safe correction; preserve recoverable input; use Zod error mapping at the boundary.
- **AI/provider:** distinguish unavailable, timeout, rate limit, malformed output, policy refusal, and insufficient evidence. Never fill a gap with a guess.
- **Extraction:** show which fields need review, retain the original source, and identify unsupported/conflicting fields.
- **Database/integration:** return a safe retry/reference message; log a redacted correlation ID and operational details server-side.
- **Upload:** explain rejected type/size/scan/processing state without exposing scanner internals.
- **Rate limit/timeout:** show safe retry timing when available; use bounded backoff and idempotency.
- **Malformed model output:** quarantine raw output, record schema/prompt/model metadata safely, and return a reviewable failure state.

## Response rules

- Use stable public error codes, safe messages, and request/correlation IDs.
- Do not expose stack traces, SQL, filesystem paths, provider credentials, prompts containing sensitive data, or internal service names.
- Do not log raw documents, financial payloads, auth tokens, or personal data by default.
- Centralize error translation; route handlers should not invent incompatible error shapes.
- Error, loading, empty, and success states are part of the UI acceptance criteria.

## Recovery

Every recoverable failure should state whether retrying is safe, whether user input is preserved, and what action the user can take. Irreversible actions require an explicit result and audit reference; a timeout must not imply success.
