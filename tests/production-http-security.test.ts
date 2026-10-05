import { afterEach, describe, expect, it, vi } from 'vitest';
import { allowedApiOrigins, resolveApiOrigin } from '@/lib/api/client';
import { withApi } from '@/lib/http/handler';
import { isDemoMode } from '@/lib/demo';

afterEach(() => vi.unstubAllEnvs());
describe('production HTTP trust boundaries', () => {
  it('never promotes a forged Host to a session forwarding origin', () => {
    const env = { VERCEL_URL: 'preview.example.com', VERCEL_PROJECT_PRODUCTION_URL: 'merchant.example.com' };
    expect(allowedApiOrigins(env)).not.toContain('https://evil.invalid');
    expect(resolveApiOrigin(env, 'https://evil.invalid')).toBe('https://merchant.example.com');
    expect(resolveApiOrigin(env, 'https://merchant.example.com')).toBe('https://merchant.example.com');
  });
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('rejects cross-site %s before the handler', async (method) => {
    const handler = vi.fn(async () => ({ data: { changed: true } }));
    const response = await withApi(handler)(new Request('https://merchant.example.com/api/businesses', {
      method, headers: { origin: 'https://evil.invalid', cookie: 'sb-access-token=synthetic' },
    }), { params: Promise.resolve({}) });
    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });
  it('disables anonymous demo access unless explicitly configured', () => {
    vi.stubEnv('DEMO_MODE', undefined); expect(isDemoMode()).toBe(false);
    vi.stubEnv('DEMO_MODE', 'false'); expect(isDemoMode()).toBe(false);
    vi.stubEnv('DEMO_MODE', 'true'); expect(isDemoMode()).toBe(true);
  });
});
