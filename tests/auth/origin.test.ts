// Merchant Brain: cross-origin rejection for state-changing auth requests.
//
// The cookie is SameSite=Lax, which already blocks most cross-site POSTs.
// This is the second layer, for the cases Lax does not cover, and it is
// deliberately absent for GETs — a cross-site GET must not be refused on an
// endpoint nobody protects that way.

import { describe, expect, it } from 'vitest';
import { assertTrustedOrigin } from '@/lib/auth/http';
import { AuthenticationError } from '@/lib/errors';

const URL = 'https://merchant.test/api/auth/login';

function post(headers: Record<string, string> = {}): Request {
  return new Request(URL, { method: 'POST', headers });
}

describe('assertTrustedOrigin', () => {
  it('allows a same-origin POST', () => {
    expect(() => assertTrustedOrigin(post({ origin: 'https://merchant.test' }))).not.toThrow();
  });

  it('rejects a POST from another origin', () => {
    expect(() => assertTrustedOrigin(post({ origin: 'https://evil.test' }))).toThrow(
      AuthenticationError,
    );
  });

  it('rejects a POST a browser labels cross-site, even with a matching origin header', () => {
    expect(() =>
      assertTrustedOrigin(post({ origin: 'https://merchant.test', 'sec-fetch-site': 'cross-site' })),
    ).toThrow(AuthenticationError);
  });

  it('allows a request with no Origin (non-browser client, no ambient cookies)', () => {
    expect(() => assertTrustedOrigin(post())).not.toThrow();
  });

  it('leaves GET alone', () => {
    const request = new Request(URL, { headers: { origin: 'https://evil.test' } });
    expect(() => assertTrustedOrigin(request)).not.toThrow();
  });

  it('compares against the origin the request was actually served from', () => {
    const request = new Request('https://app.merchant.test/api/auth/login', {
      method: 'POST',
      headers: { origin: 'https://app.merchant.test' },
    });
    expect(() => assertTrustedOrigin(request)).not.toThrow();
    expect(() =>
      assertTrustedOrigin(
        new Request('https://app.merchant.test/api/auth/login', {
          method: 'POST',
          headers: { origin: 'https://merchant.test' },
        }),
      ),
    ).toThrow(AuthenticationError);
  });
});
