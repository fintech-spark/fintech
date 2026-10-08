import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockCookieStore = new Map<string, string>();
const mockRedirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      mockCookieStore.has(name) ? { value: mockCookieStore.get(name)! } : undefined,
    has: (name: string) => mockCookieStore.has(name),
  })),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/api/context', () => ({
  resolveMerchantContext: vi.fn(),
}));

import LoginPage from '@/app/(auth)/login/page';
import SignupPage from '@/app/(auth)/signup/page';
import { resolveMerchantContext } from '@/lib/api/context';
import { ACCESS_TOKEN_COOKIE } from '@/lib/auth/session';

describe('LoginPage and SignupPage auth gate', () => {
  beforeEach(() => {
    mockCookieStore.clear();
    mockRedirect.mockClear();
    vi.clearAllMocks();
  });

  describe('LoginPage', () => {
    it('renders form when no access token cookie exists', async () => {
      const element = await LoginPage();
      expect(element).toBeDefined();
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('redirects authenticated user to /overview', async () => {
      mockCookieStore.set(ACCESS_TOKEN_COOKIE, 'valid-token');
      vi.mocked(resolveMerchantContext).mockResolvedValueOnce({
        status: 'authenticated',
      } as never);

      await expect(LoginPage()).rejects.toThrow('REDIRECT:/overview');
      expect(mockRedirect).toHaveBeenCalledWith('/overview');
    });

    it('redirects onboarding user to /overview', async () => {
      mockCookieStore.set(ACCESS_TOKEN_COOKIE, 'valid-token-no-biz');
      vi.mocked(resolveMerchantContext).mockResolvedValueOnce({
        status: 'onboarding',
      } as never);

      await expect(LoginPage()).rejects.toThrow('REDIRECT:/overview');
      expect(mockRedirect).toHaveBeenCalledWith('/overview');
    });

    it('does not redirect and shows form when token is expired/unauthenticated', async () => {
      mockCookieStore.set(ACCESS_TOKEN_COOKIE, 'expired-token');
      vi.mocked(resolveMerchantContext).mockResolvedValueOnce({
        status: 'unauthenticated',
      });

      const element = await LoginPage();
      expect(element).toBeDefined();
      expect(mockRedirect).not.toHaveBeenCalled();
    });
  });

  describe('SignupPage', () => {
    it('renders form when no access token cookie exists', async () => {
      const element = await SignupPage();
      expect(element).toBeDefined();
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('redirects authenticated user to /overview', async () => {
      mockCookieStore.set(ACCESS_TOKEN_COOKIE, 'valid-token');
      vi.mocked(resolveMerchantContext).mockResolvedValueOnce({
        status: 'authenticated',
      } as never);

      await expect(SignupPage()).rejects.toThrow('REDIRECT:/overview');
      expect(mockRedirect).toHaveBeenCalledWith('/overview');
    });

    it('redirects onboarding user to /overview', async () => {
      mockCookieStore.set(ACCESS_TOKEN_COOKIE, 'valid-token');
      vi.mocked(resolveMerchantContext).mockResolvedValueOnce({
        status: 'onboarding',
      } as never);

      await expect(SignupPage()).rejects.toThrow('REDIRECT:/overview');
      expect(mockRedirect).toHaveBeenCalledWith('/overview');
    });

    it('does not redirect and shows form when token is expired/unauthenticated', async () => {
      mockCookieStore.set(ACCESS_TOKEN_COOKIE, 'expired-token');
      vi.mocked(resolveMerchantContext).mockResolvedValueOnce({
        status: 'unauthenticated',
      });

      const element = await SignupPage();
      expect(element).toBeDefined();
      expect(mockRedirect).not.toHaveBeenCalled();
    });
  });
});
