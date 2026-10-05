import type { NextConfig } from "next";

// Deliberately conservative: every header here is inert for rendering, so it
// cannot break a page someone else is building. A Content-Security-Policy is
// NOT set — a wrong CSP breaks inline scripts across the app, and adding one
// correctly requires a browser pass over every route (see docs note in the
// security report). Add CSP only with that verification in hand.
const baseSecurityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

// HSTS only in production builds: `next build` sets NODE_ENV=production, so
// development never receives a header that would pin a local host to https.
const securityHeaders =
  process.env.NODE_ENV === "production"
    ? [
        ...baseSecurityHeaders,
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains",
        },
      ]
    : baseSecurityHeaders;

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_BUILD_DIR ?? '.next',
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
