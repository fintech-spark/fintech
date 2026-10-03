// Test stub for the `server-only` package.
//
// `server-only` is designed to be resolved by the bundler: Next.js
// aliases it to an empty module in server builds and to a throwing
// module in client builds. In a plain Node process (vitest) there is
// no bundler, so the package's default — the throwing entry point —
// is loaded, which makes every server-only module unimportable here.
//
// vitest.config.ts aliases `server-only` to this file so that the
// server-only modules can be unit-tested in Node. The real
// build-time boundary is still enforced by Next.js: a Client
// Component that imports a server-only module fails the production
// build.
export {};