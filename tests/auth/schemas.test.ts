// Merchant Brain: authentication boundary schemas.
//
// The schema is shared by the browser form and the route handler, so these
// assertions are the single specification of what a credential payload must
// look like — including the keys it must NOT carry.

import { describe, expect, it } from 'vitest';
import { loginSchema, signupSchema, MIN_PASSWORD_LENGTH } from '@/lib/auth/schemas';

describe('loginSchema', () => {
  it('accepts a valid email and password', () => {
    const result = loginSchema.safeParse({ email: 'ravi@example.com', password: 'correct horse battery' });
    expect(result.success).toBe(true);
  });

  it('lower-cases and trims the email so accounts cannot fork on case', () => {
    const result = loginSchema.parse({ email: '  Ravi@Example.COM ', password: 'x' });
    expect(result.email).toBe('ravi@example.com');
  });

  it('rejects an unknown key instead of ignoring it', () => {
    const result = loginSchema.safeParse({
      email: 'ravi@example.com',
      password: 'correct horse battery',
      businessId: 'someone-elses-tenant',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed email', () => {
    expect(loginSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
  });

  it('rejects an empty password', () => {
    expect(loginSchema.safeParse({ email: 'ravi@example.com', password: '' }).success).toBe(false);
  });
});

describe('signupSchema', () => {
  const valid = {
    name: 'Ravi Kumar',
    email: 'ravi@example.com',
    password: 'a-perfectly-adequate-passphrase',
  };

  it('accepts a complete sign-up', () => {
    expect(signupSchema.safeParse(valid).success).toBe(true);
  });

  it(`rejects a password shorter than ${MIN_PASSWORD_LENGTH} characters`, () => {
    const result = signupSchema.safeParse({ ...valid, password: 'short' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('password'))).toBe(true);
    }
  });

  it('rejects a password longer than the hashing work ceiling', () => {
    const result = signupSchema.safeParse({ ...valid, password: 'a'.repeat(500) });
    expect(result.success).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(signupSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    const result = signupSchema.safeParse({ ...valid, role: 'owner' });
    expect(result.success).toBe(false);
  });
});
