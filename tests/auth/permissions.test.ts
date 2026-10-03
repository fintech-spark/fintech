// Merchant Brain: role → permission matrix (open decision D11).
//
// The matrix in `lib/http/auth-context.ts` is the application-authorization
// layer: RLS decides which rows a session may see, and this decides which
// operations a role may attempt. It was recorded as invented policy awaiting
// owner sign-off precisely because nothing pinned it down — so this file pins
// it down. If a rule here is wrong, changing it should require changing this
// test in the same commit.
//
// Read-only with respect to the implementation: it imports the matrix, it does
// not modify it.

import { describe, expect, it } from 'vitest';
import { hasPermission } from '@/lib/http/auth-context';
import type { Permission } from '@/modules/auth';

const ALL_PERMISSIONS: readonly Permission[] = [
  'transactions:read',
  'transactions:write',
  'inventory:read',
  'inventory:write',
  'expenses:read',
  'expenses:write',
  'customers:read',
  'customers:write',
  'suppliers:read',
  'suppliers:write',
  'documents:read',
  'documents:write',
  'analytics:read',
  'actions:read',
  'actions:approve',
  'actions:execute',
  'settings:read',
  'settings:write',
  'audit:read',
];

const WRITE_LIKE = /:(write|approve|execute)$/;

describe('owner', () => {
  it('holds every permission', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(hasPermission('owner', permission), permission).toBe(true);
    }
  });
});

describe('admin', () => {
  it('holds everything except executing actions', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(hasPermission('admin', permission), permission).toBe(permission !== 'actions:execute');
    }
  });
});

describe('manager', () => {
  it('runs day-to-day operations but cannot configure the account', () => {
    expect(hasPermission('manager', 'transactions:write')).toBe(true);
    expect(hasPermission('manager', 'inventory:write')).toBe(true);
    expect(hasPermission('manager', 'expenses:write')).toBe(true);
    expect(hasPermission('manager', 'customers:write')).toBe(true);
    expect(hasPermission('manager', 'suppliers:write')).toBe(true);
    expect(hasPermission('manager', 'documents:write')).toBe(true);
    expect(hasPermission('manager', 'actions:approve')).toBe(true);
  });

  it('cannot execute actions, change settings, or read the audit trail', () => {
    expect(hasPermission('manager', 'actions:execute')).toBe(false);
    expect(hasPermission('manager', 'settings:read')).toBe(false);
    expect(hasPermission('manager', 'settings:write')).toBe(false);
    expect(hasPermission('manager', 'audit:read')).toBe(false);
  });
});

describe('accountant', () => {
  it('reads and writes money records but never inventory or documents', () => {
    expect(hasPermission('accountant', 'transactions:write')).toBe(true);
    expect(hasPermission('accountant', 'expenses:write')).toBe(true);
    expect(hasPermission('accountant', 'analytics:read')).toBe(true);

    expect(hasPermission('accountant', 'inventory:write')).toBe(false);
    expect(hasPermission('accountant', 'documents:write')).toBe(false);
    expect(hasPermission('accountant', 'actions:approve')).toBe(false);
    expect(hasPermission('accountant', 'settings:write')).toBe(false);
  });
});

describe('staff', () => {
  it('is read-only across the board', () => {
    for (const permission of ALL_PERMISSIONS) {
      if (WRITE_LIKE.test(permission)) {
        expect(hasPermission('staff', permission), permission).toBe(false);
      }
    }
  });

  it('holds only the four read permissions it needs to work', () => {
    const granted = ALL_PERMISSIONS.filter((permission) => hasPermission('staff', permission));
    expect(granted.sort()).toEqual(
      ['actions:read', 'documents:read', 'inventory:read', 'transactions:read'].sort(),
    );
  });
});

describe('matrix integrity', () => {
  it('grants every declared permission to at least one role', () => {
    for (const permission of ALL_PERMISSIONS) {
      const heldBySomeRole = (['owner', 'admin', 'manager', 'accountant', 'staff'] as const).some(
        (role) => hasPermission(role, permission),
      );
      expect(heldBySomeRole, permission).toBe(true);
    }
  });

  it('never grants more to a lower role than to owner', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(hasPermission('owner', permission), permission).toBe(true);
    }
  });
});
