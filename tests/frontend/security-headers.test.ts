// Merchant Brain: security response headers.
//
// Pinned against next.config.ts so a routine config edit cannot silently drop
// them. Only rendering-inert headers are asserted — see the note in
// next.config.ts for why Content-Security-Policy is deliberately absent.

import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';

async function configuredHeaders(): Promise<Record<string, string>> {
  const rules = await nextConfig.headers!();
  const all = rules.flatMap((rule) => rule.headers);
  return Object.fromEntries(all.map((header) => [header.key, header.value]));
}

describe('security headers', () => {
  it('applies to every route', async () => {
    const rules = await nextConfig.headers!();
    expect(rules.map((rule) => rule.source)).toContain('/(.*)');
  });

  it('sets the inert hardening headers', async () => {
    const headers = await configuredHeaders();

    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(headers['Permissions-Policy']).toMatch(/camera=\(\)/);
    expect(headers['Permissions-Policy']).toMatch(/geolocation=\(\)/);
  });

  it('never serves the framework fingerprint', async () => {
    // poweredByHeader: false removes X-Powered-By; absence is the assertion.
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it('sends HSTS only in production builds, with a sane max-age', async () => {
    const headers = await configuredHeaders();
    const hsts = headers['Strict-Transport-Security'];

    if (process.env.NODE_ENV === 'production') {
      expect(hsts).toMatch(/^max-age=\d+; includeSubDomains$/);
      expect(Number(/max-age=(\d+)/.exec(hsts)![1])).toBeGreaterThanOrEqual(15552000);
    } else {
      expect(hsts).toBeUndefined();
    }
  });
});
