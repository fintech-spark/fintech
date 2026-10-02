// The root route is served by the marketing group so `/` and `/overview` have
// clearly different owners: one is public, one is inside the authenticated
// application shell.
export { default, metadata } from "@/app/(marketing)/page";
