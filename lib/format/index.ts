// Merchant Brain: presentation-layer barrel.
//
// Pure functions only. Nothing in `lib/format` may import from `app`,
// `components`, or a client hook — these run on the server, in tests, and in
// client components alike.

export * from "./money";
export * from "./dates";
export * from "./status";
export * from "./labels";