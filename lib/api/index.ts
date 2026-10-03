// Merchant Brain: frontend API barrel — SERVER ONLY.
//
// `lib/api/endpoints.ts` reaches `lib/api/client.ts`, which imports
// `server-only`. Importing this barrel from a Client Component fails the
// build, and that is the intended behaviour: session cookies and tenant
// derivation must never reach the browser.
//
// Client Components import the two modules that are safe on the client
// directly — `@/lib/api/errors` and `@/lib/api/pending`. Neither touches the
// session.

export * from "./contracts";
export * from "./errors";
export * from "./endpoints";
export * from "./pending";
export * from "./context";
export { apiFetch, listQuery, pageFrom, type Page } from "./client";