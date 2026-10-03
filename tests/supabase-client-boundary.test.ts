import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Regression tests for the Model 3 red-team finding that the
// repository had no Supabase client at all, while the runtime
// Postgres client connected with a role that has rolbypassrls =
// true. The fix introduced a privilege-split client boundary:
//
//   createBrowserClient()  anon key, RLS-enforced, browser-safe
//   createServerClient()   user JWT, RLS-enforced, server-only
//   createAdminClient()    service role, BYPASSES RLS, server-only
//
// These tests are pure unit tests: they never reach a database.
// They assert the privilege split holds at construction time, which
// is the last line of defence before a key can reach a bundle.

import {
  createBrowserClient,
  createServerClient,
  createAdminClient,
  FORBIDDEN_ADMIN_ENV_NAMES,
} from '../lib/supabase';

const SENSITIVE = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  ...FORBIDDEN_ADMIN_ENV_NAMES,
];

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of SENSITIVE) saved[name] = process.env[name];
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  for (const name of FORBIDDEN_ADMIN_ENV_NAMES) delete process.env[name];
});

afterEach(() => {
  for (const name of SENSITIVE) {
    const value = saved[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('createAdminClient (service role — bypasses RLS)', () => {
  it('requires an explicit bypassRowLevelSecurity acknowledgement', () => {
    expect(() =>
      // @ts-expect-error deliberately omitted acknowledgement
      createAdminClient(),
    ).toThrow(/bypassRowLevelSecurity/);
  });

  it('constructs when acknowledged and the server-side key is present', () => {
    expect(() =>
      createAdminClient({ bypassRowLevelSecurity: true }),
    ).not.toThrow();
  });

  it('refuses to construct without SUPABASE_SERVICE_ROLE_KEY', () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() =>
      createAdminClient({ bypassRowLevelSecurity: true }),
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it.each(FORBIDDEN_ADMIN_ENV_NAMES)(
    'refuses to construct when a service role leaks through %s',
    (name) => {
      process.env[name] = 'leaked-service-role-key';
      expect(() =>
        createAdminClient({ bypassRowLevelSecurity: true }),
      ).toThrow(new RegExp(name));
    },
  );

  it('never reads the service role from a NEXT_PUBLIC_ variable', () => {
    // Even when a public variable is populated, construction must fail
    // rather than silently use it — the key would be inlined into the
    // browser bundle at build time.
    process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY = 'leaked';
    let threw = false;
    try {
      createAdminClient({ bypassRowLevelSecurity: true });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

describe('createBrowserClient (anon key — RLS enforced)', () => {
  it('constructs with the anon key and no service role', () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => createBrowserClient()).not.toThrow();
  });

  it('does not require SUPABASE_SERVICE_ROLE_KEY', () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => createBrowserClient()).not.toThrow();
  });
});

describe('createServerClient (user JWT — RLS enforced)', () => {
  it('constructs anonymously when no access token is supplied', () => {
    expect(() => createServerClient()).not.toThrow();
  });

  it('constructs for a user when an access token is supplied', () => {
    expect(() =>
      createServerClient({ accessToken: 'user-access-token' }),
    ).not.toThrow();
  });
});