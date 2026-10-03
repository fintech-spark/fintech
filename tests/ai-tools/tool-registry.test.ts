// Merchant Brain: AI tool registry — contract and security tests
//
// Coverage split:
//   registry     allowlist, unknown tool, budget, caching, telemetry
//   validation   malformed input, unknown keys, malformed output
//   authorization role gate, authorizer hook, sensitivity floor
//   injection    tenant key smuggling, oversized windows, query-syntax filters
//   limits       row cap, payload cap, timeout

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createToolRegistry, defineTool } from '@/lib/ai/tools/registry';
import { DEFAULT_TOOL_LIMITS } from '@/lib/ai/tools/types';
import {
  AIValidationError,
  AuthorizationError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from '@/lib/errors';
import { createBusinessReadOnlyTools } from '@/modules/business-brain';
import {
  BUSINESS_A,
  BUSINESS_B,
  allowAllAuthorizer,
  createFakeDatabase,
  denyingAuthorizer,
  tenantFor,
} from '../helpers/fake-database';

const metricSchema = z
  .object({
    metric: z.string(),
    valueMinorUnits: z.number().int(),
    currency: z.string(),
    periodStart: z.string(),
    periodEnd: z.string(),
  })
  .strict();

/** The window sits at the top level so a widened span is rejected by the schema. */
const boundedWindow = z
  .object({
    periodStart: z.string().datetime({ offset: true }),
    periodEnd: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, ctx) => {
    const start = Date.parse(value.periodStart);
    const end = Date.parse(value.periodEnd);
    if (end <= start) {
      ctx.addIssue({ code: 'custom', message: 'periodEnd must follow periodStart' });
      return;
    }
    const days = (end - start) / 86_400_000;
    if (days > DEFAULT_TOOL_LIMITS.maxDateWindowDays) {
      ctx.addIssue({ code: 'custom', message: 'window too wide' });
    }
  });

function makeRegistry(options: {
  tools?: ReturnType<typeof defineTool>[];
  authorize?: ReturnType<typeof allowAllAuthorizer>;
  limits?: Partial<typeof DEFAULT_TOOL_LIMITS>;
  onRecord?: (record: unknown) => void;
} = {}) {
  const defaultTool = defineTool({
    name: 'demo_metric',
    version: 'v1',
    description: 'demo',
    inputSchema: boundedWindow,
    outputSchema: z
      .object({
        metrics: z.array(metricSchema),
        periodStart: z.string(),
        periodEnd: z.string(),
      })
      .strict(),
    authorization: { minimumRole: 'staff', permission: 'analytics:read' },
    sensitivity: 'financial',
    readOnly: true,
    source: 'analytics',
    execute: vi.fn(async () => ({
      metrics: [
        {
          metric: 'revenue',
          valueMinorUnits: 1_250_000,
          currency: 'INR',
          periodStart: '2026-10-01T00:00:00.000Z',
          periodEnd: '2026-11-01T00:00:00.000Z',
        },
      ],
      periodStart: '2026-10-01T00:00:00.000Z',
      periodEnd: '2026-11-01T00:00:00.000Z',
    })),
  });

  return createToolRegistry({
    tools: options.tools ?? [defaultTool as never],
    authorize: (options.authorize ?? allowAllAuthorizer()) as never,
    ...(options.limits ? { limits: options.limits } : {}),
    ...(options.onRecord ? { onRecord: options.onRecord as never } : {}),
  });
}

const OCTOBER = {
  periodStart: '2026-10-01T00:00:00.000Z',
  periodEnd: '2026-11-01T00:00:00.000Z',
};

describe('tool registry — allowlist', () => {
  it('accepts a known tool and returns a provenance envelope', async () => {
    const registry = makeRegistry();
    const session = registry.open(tenantFor(BUSINESS_A));

    const envelope = await session.call('demo_metric', OCTOBER);

    expect(envelope.provenance.tool).toBe('demo_metric');
    expect(envelope.provenance.tenantScoped).toBe(true);
    expect(envelope.provenance.reportingPeriod).toEqual({
      start: OCTOBER.periodStart,
      end: OCTOBER.periodEnd,
    });
  });

  it('rejects an unknown tool name', async () => {
    const registry = makeRegistry();
    const session = registry.open(tenantFor(BUSINESS_A));

    await expect(session.call('drop_all_tables', {})).rejects.toBeInstanceOf(NotFoundError);
  });

  it('never advertises a tool outside the allowlist', () => {
    const registry = makeRegistry();
    expect(registry.list().map((tool) => tool.name)).toEqual(['demo_metric']);
    expect(registry.has('drop_all_tables')).toBe(false);
  });

  it('refuses to build a registry containing a duplicate name', () => {
    const tool = defineTool({
      name: 'demo_metric',
      version: 'v1',
      description: 'demo',
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({}).strict(),
      authorization: { minimumRole: 'staff', permission: 'analytics:read' },
      sensitivity: 'financial',
      readOnly: true,
      source: 'database',
      execute: async () => ({}),
    });

    expect(() =>
      createToolRegistry({ tools: [tool as never, tool as never], authorize: allowAllAuthorizer() as never }),
    ).toThrow(/duplicate tool name/);
  });

  it('publishes a JSON Schema for each tool input', () => {
    const registry = makeRegistry();
    const [definition] = registry.definitions();

    expect(definition?.parameters).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
  });
});

describe('tool registry — input validation', () => {
  it('rejects an unknown key in the input object', async () => {
    const registry = makeRegistry();
    const session = registry.open(tenantFor(BUSINESS_A));

    await expect(
      session.call('demo_metric', { ...OCTOBER, sql: 'DROP TABLE transactions' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a non-object argument', async () => {
    const registry = makeRegistry();
    const session = registry.open(tenantFor(BUSINESS_A));

    await expect(session.call('demo_metric', ['not', 'an', 'object'])).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('rejects a reversed reporting window', async () => {
    const registry = makeRegistry();
    const session = registry.open(tenantFor(BUSINESS_A));

    await expect(
      session.call('demo_metric', {
        periodStart: '2026-11-01T00:00:00.000Z',
        periodEnd: '2026-10-01T00:00:00.000Z',
      }),
    ).rejects.toThrow(/periodEnd must follow periodStart/);
  });

  it('rejects a reporting window wider than the configured limit', async () => {
    const registry = makeRegistry();
    const session = registry.open(tenantFor(BUSINESS_A));

    await expect(
      session.call('demo_metric', {
        periodStart: '2000-01-01T00:00:00.000Z',
        periodEnd: '2026-11-01T00:00:00.000Z',
      }),
    ).rejects.toThrow(/window too wide/);
  });

  it('rejects a malformed timestamp', async () => {
    const registry = makeRegistry();
    const session = registry.open(tenantFor(BUSINESS_A));

    await expect(
      session.call('demo_metric', { periodStart: 'yesterday', periodEnd: 'today' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('tool registry — output validation', () => {
  it('rejects a handler that violates its own output schema', async () => {
    const leakyTool = defineTool({
      name: 'demo_metric',
      version: 'v1',
      description: 'demo',
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ total: z.number().int() }).strict(),
      authorization: { minimumRole: 'staff', permission: 'analytics:read' },
      sensitivity: 'financial',
      readOnly: true,
      source: 'analytics',
      // Float money and an unexpected field: both must be refused.
      execute: async () => ({ total: 12.5, secret: 'sk-live-abcdefghijklmnop' }) as never,
    });

    const registry = makeRegistry({ tools: [leakyTool as never] });
    const session = registry.open(tenantFor(BUSINESS_A));

    await expect(session.call('demo_metric', {})).rejects.toBeInstanceOf(AIValidationError);
  });

  it('does not echo the rejected payload into the error', async () => {
    const leakyTool = defineTool({
      name: 'demo_metric',
      version: 'v1',
      description: 'demo',
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ total: z.number().int() }).strict(),
      authorization: { minimumRole: 'staff', permission: 'analytics:read' },
      sensitivity: 'financial',
      readOnly: true,
      source: 'analytics',
      execute: async () => ({ total: 'not-a-number', gstin: 'ABCDE1234F' }) as never,
    });

    const registry = makeRegistry({ tools: [leakyTool as never] });
    const session = registry.open(tenantFor(BUSINESS_A));

    await expect(session.call('demo_metric', {})).rejects.toThrow(/^tool "demo_metric"/);
    await expect(session.call('demo_metric', {})).rejects.not.toThrow(/ABCDE1234F/);
  });
});

describe('tool registry — authorization', () => {
  it('rejects a role below the tool minimum', async () => {
    // customer_context requires `manager`; a staff user must not reach a
    // counterparty balance through the AI surface.
    const registry = makeRegistry({ tools: [restrictedTool()] as never });

    await expect(
      registry.open(tenantFor(BUSINESS_A, { role: 'staff' })).call('demo_metric', OCTOBER),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      registry.open(tenantFor(BUSINESS_A, { role: 'accountant' })).call('demo_metric', OCTOBER),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('accepts a role at or above the tool minimum', async () => {
    const registry = makeRegistry({ tools: [restrictedTool()] as never });

    await registry.open(tenantFor(BUSINESS_A, { role: 'manager' })).call('demo_metric', OCTOBER);
    await registry.open(tenantFor(BUSINESS_A, { role: 'owner' })).call('demo_metric', OCTOBER);
  });

  it('honours a denial from the injected authorizer', async () => {
    const registry = makeRegistry({ authorize: denyingAuthorizer(['demo_metric']) as never });
    const session = registry.open(tenantFor(BUSINESS_A));

    await expect(session.call('demo_metric', OCTOBER)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('passes the declared capability to the authorizer', async () => {
    const authorize = allowAllAuthorizer();
    const registry = makeRegistry({ authorize: authorize as never });

    await registry.open(tenantFor(BUSINESS_A)).call('demo_metric', OCTOBER);

    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: BUSINESS_A }),
      expect.objectContaining({ permission: 'analytics:read', minimumRole: 'staff' }),
    );
  });
});

describe('tool registry — tenant key smuggling', () => {
  const injections: readonly [string, Record<string, unknown>][] = [
    ['businessId', { ...OCTOBER, businessId: BUSINESS_B }],
    ['business_id', { ...OCTOBER, business_id: BUSINESS_B }],
    ['tenantId', { ...OCTOBER, tenantId: BUSINESS_B }],
    ['orgId', { ...OCTOBER, orgId: BUSINESS_B }],
  ];

  it.each(injections)('rejects an injected %s', async (_label, payload) => {
    const registry = makeRegistry();
    const session = registry.open(tenantFor(BUSINESS_A));

    await expect(session.call('demo_metric', payload)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a tenant key nested inside an array argument', async () => {
    const registry = makeRegistry();
    const session = registry.open(tenantFor(BUSINESS_A));

    await expect(
      session.call('demo_metric', { ...OCTOBER, filters: [{ businessId: BUSINESS_B }] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('never calls the handler when a tenant key is present', async () => {
    const handler = vi.fn(async () => ({ metrics: [], periodStart: 'a', periodEnd: 'b' }));
    const tool = defineTool({
      name: 'demo_metric',
      version: 'v1',
      description: 'demo',
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.object({}).passthrough(),
      authorization: { minimumRole: 'staff', permission: 'analytics:read' },
      sensitivity: 'financial',
      readOnly: true,
      source: 'analytics',
      execute: handler,
    });

    // `.passthrough()` is the worst case: a schema that would happily accept the
    // tenant key. The registry's scan must still stop it.
    const registry = makeRegistry({ tools: [tool as never] });
    await expect(
      registry.open(tenantFor(BUSINESS_A)).call('demo_metric', { businessId: BUSINESS_B }),
    ).rejects.toThrow(/tenant key/i);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('tool registry — resource limits', () => {
  it('stops a session once the tool-call budget is spent', async () => {
    const registry = makeRegistry({ limits: { maxToolCalls: 3 } });
    const session = registry.open(tenantFor(BUSINESS_A));

    await session.call('demo_metric', OCTOBER);
    await session.call('demo_metric', { ...OCTOBER, periodEnd: '2026-11-02T00:00:00.000Z' });
    await session.call('demo_metric', { ...OCTOBER, periodEnd: '2026-11-03T00:00:00.000Z' });

    await expect(
      session.call('demo_metric', { ...OCTOBER, periodEnd: '2026-11-04T00:00:00.000Z' }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it('rejects a payload above the byte ceiling', async () => {
    const bulkyTool = defineTool({
      name: 'demo_metric',
      version: 'v1',
      description: 'demo',
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ blob: z.string() }).strict(),
      authorization: { minimumRole: 'staff', permission: 'analytics:read' },
      sensitivity: 'financial',
      readOnly: true,
      source: 'database',
      execute: async () => ({ blob: 'x'.repeat(200_000) }),
    });

    const registry = makeRegistry({ tools: [bulkyTool as never] });
    await expect(
      registry.open(tenantFor(BUSINESS_A)).call('demo_metric', {}),
    ).rejects.toThrow(/above the .* byte limit/);
  });

  it('aborts a handler that exceeds the wall clock', async () => {
    const slowTool = defineTool({
      name: 'demo_metric',
      version: 'v1',
      description: 'demo',
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({}).strict(),
      authorization: { minimumRole: 'staff', permission: 'analytics:read' },
      sensitivity: 'financial',
      readOnly: true,
      source: 'database',
      execute: () => new Promise(() => undefined) as Promise<never>,
    });

    const registry = makeRegistry({ tools: [slowTool as never], limits: { timeoutMs: 20 } });
    await expect(
      registry.open(tenantFor(BUSINESS_A)).call('demo_metric', {}),
    ).rejects.toThrow(/exceeded its 20ms budget/);
  });

  it('serves an identical repeat call from cache instead of re-querying', async () => {
    const handler = vi.fn(async () => ({
      metrics: [],
      periodStart: OCTOBER.periodStart,
      periodEnd: OCTOBER.periodEnd,
    }));
    const tool = defineTool({
      name: 'demo_metric',
      version: 'v1',
      description: 'demo',
      inputSchema: z.object({}).strict(),
      outputSchema: z
        .object({ metrics: z.array(z.unknown()), periodStart: z.string(), periodEnd: z.string() })
        .strict(),
      authorization: { minimumRole: 'staff', permission: 'analytics:read' },
      sensitivity: 'financial',
      readOnly: true,
      source: 'analytics',
      execute: handler,
    });

    const registry = makeRegistry({ tools: [tool as never] });
    const session = registry.open(tenantFor(BUSINESS_A));

    await session.call('demo_metric', {});
    await session.call('demo_metric', {});

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not share a cache between tenants', async () => {
    const handler = vi.fn(async () => ({
      metrics: [],
      periodStart: OCTOBER.periodStart,
      periodEnd: OCTOBER.periodEnd,
    }));
    const tool = defineTool({
      name: 'demo_metric',
      version: 'v1',
      description: 'demo',
      inputSchema: z.object({}).strict(),
      outputSchema: z
        .object({ metrics: z.array(z.unknown()), periodStart: z.string(), periodEnd: z.string() })
        .strict(),
      authorization: { minimumRole: 'staff', permission: 'analytics:read' },
      sensitivity: 'financial',
      readOnly: true,
      source: 'analytics',
      execute: handler,
    });

    const registry = makeRegistry({ tools: [tool as never] });

    await registry.open(tenantFor(BUSINESS_A)).call('demo_metric', {});
    await registry.open(tenantFor(BUSINESS_B)).call('demo_metric', {});

    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe('tool registry — observability', () => {
  it('records a successful call without logging input or output values', async () => {
    const records: Record<string, unknown>[] = [];
    const registry = makeRegistry({
      onRecord: (record: unknown) => records.push(record as Record<string, unknown>),
    });

    await registry.open(tenantFor(BUSINESS_A)).call('demo_metric', OCTOBER);

    expect(records).toHaveLength(1);
    const record = records[0] as Record<string, unknown>;
    expect(record.tool).toBe('demo_metric');
    expect(record.success).toBe(true);
    expect(record.businessId).toBe(BUSINESS_A);
    expect(record.correlationId).toBe('corr-test-1');
    expect(JSON.stringify(record)).not.toContain('1250000');
    expect(JSON.stringify(record)).not.toContain('periodStart');
  });

  it('records a failure with its error code', async () => {
    const records: Record<string, unknown>[] = [];
    const registry = makeRegistry({
      onRecord: (record: unknown) => records.push(record as Record<string, unknown>),
    });

    await expect(registry.open(tenantFor(BUSINESS_A)).call('nope', {})).rejects.toThrow();

    const failure = records.at(-1) as Record<string, unknown>;
    expect(failure.success).toBe(false);
    expect(failure.failureCode).toBe('NOT_FOUND');
  });
});

describe('tool registry — read-only guarantee', () => {
  it('refuses to construct with a tool that declares itself writable', () => {
    const writable = {
      name: 'create_transaction',
      version: 'v1',
      description: 'writes',
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({}).strict(),
      authorization: { minimumRole: 'owner', permission: 'transactions:write' },
      sensitivity: 'financial',
      readOnly: false,
      source: 'database',
      execute: async () => ({}),
    };

    expect(() =>
      createToolRegistry({ tools: [writable as never], authorize: allowAllAuthorizer() as never }),
    ).toThrow(/not read-only/);
  });

  it('refuses a tool name that leaks an internal path', () => {
    const badlyNamed = defineTool({
      name: 'modules/business-brain/infrastructure/sales-facts',
      version: 'v1',
      description: 'x',
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({}).strict(),
      authorization: { minimumRole: 'staff', permission: 'analytics:read' },
      sensitivity: 'financial',
      readOnly: true,
      source: 'database',
      execute: async () => ({}),
    });

    expect(() =>
      createToolRegistry({
        tools: [badlyNamed as never],
        authorize: allowAllAuthorizer() as never,
      }),
    ).toThrow(/lower snake_case/);
  });
});

/** A tool whose capability floor is `manager`, mirroring customer_context. */
function restrictedTool() {
  return defineTool({
    name: 'demo_metric',
    version: 'v1',
    description: 'demo',
    inputSchema: boundedWindow,
    outputSchema: z
      .object({
        metrics: z.array(z.unknown()),
        periodStart: z.string(),
        periodEnd: z.string(),
      })
      .strict(),
    authorization: { minimumRole: 'manager', permission: 'customers:read' },
    sensitivity: 'customer_pii',
    readOnly: true,
    source: 'analytics',
    execute: async () => ({
      metrics: [],
      periodStart: OCTOBER.periodStart,
      periodEnd: OCTOBER.periodEnd,
    }),
  });
}

describe('tool registry — catalog', () => {
  it('exposes the eleven approved read-only business tools', () => {
    // The catalog is assembled independently of any live query.
    const tools = createBusinessReadOnlyTools(createFakeDatabase());

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'business_overview',
      'cash_flow_summary',
      'context_coverage',
      'customer_context',
      'expense_summary',
      'inventory_status',
      'product_performance',
      'profit_leak_findings',
      'sales_summary',
      'supplier_context',
      'transaction_search',
    ]);
    expect(tools.every((tool) => tool.readOnly)).toBe(true);
  });

  it('keeps every tool name free of internal implementation detail', () => {
    for (const tool of createBusinessReadOnlyTools(createFakeDatabase())) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(tool.name).not.toContain('modules');
      expect(tool.name).not.toContain('repository');
      expect(tool.name).not.toContain('sql');
    }
  });
});

describe('deterministic margin arithmetic', () => {
  it('reports gross margin, not the cost ratio', async () => {
    const { profitAndMargin } = await import(
      '@/modules/business-brain/application/tools/common'
    );

    // Revenue 1,000.00, cost 600.00 -> gross profit 400.00 -> margin 40% = 4000 bps.
    const result = profitAndMargin(1_000_00, 600_00, 'INR');

    expect(result.grossProfitMinor).toBe(400_00);
    expect(result.grossMarginBps).toBe(4000);
  });

  it('reports a thin margin as a small number, not a large one', async () => {
    const { profitAndMargin } = await import(
      '@/modules/business-brain/application/tools/common'
    );

    // Revenue 1,000.00, cost 900.00 -> gross profit 100.00 -> margin 10% = 1000 bps.
    // The inverted rule would have produced 9000 here.
    const result = profitAndMargin(1_000_00, 900_00, 'INR');

    expect(result.grossMarginBps).toBe(1000);
  });

  it('returns zero margin rather than dividing by zero', async () => {
    const { profitAndMargin } = await import(
      '@/modules/business-brain/application/tools/common'
    );

    expect(profitAndMargin(0, 0, 'INR').grossMarginBps).toBe(0);
  });

  it('agrees with the analytics margin rule it delegates to', async () => {
    const { profitAndMargin } = await import(
      '@/modules/business-brain/application/tools/common'
    );
    const { calculateGrossProfit, calculateMarginBps } = await import('@/modules/analytics');

    const revenue = 3_333_33;
    const cost = 1_111_11;
    const result = profitAndMargin(revenue, cost, 'INR');

    expect(result.grossMarginBps).toBe(
      calculateMarginBps(calculateGrossProfit(revenue, cost), revenue),
    );
  });

  it('is not the inventory module cost-margin rule with swapped arguments', async () => {
    const { profitAndMargin } = await import(
      '@/modules/business-brain/application/tools/common'
    );
    const { calculateMarginBps: inventoryMargin } = await import('@/modules/inventory');

    const revenue = 1_000_00;
    const cost = 600_00;
    const result = profitAndMargin(revenue, cost, 'INR');

    // Guard against regressing to the inventory rule, which computes
    // (sellingPrice - costPrice) / sellingPrice and is the wrong function here.
    expect(result.grossMarginBps).not.toBe(inventoryMargin(result.grossProfitMinor, revenue));
  });
});
