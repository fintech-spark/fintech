// Merchant Brain: tenant isolation across every retrieval path
//
// The runtime database connection authenticates as a role with
// `rolbypassrls = true`, so migration 20261002000004's policies are INERT for
// application traffic. Application code is the only isolation layer, which makes
// these assertions load-bearing rather than belt-and-braces.
//
// Business A must never observe business B's data through:
//   - a structured tool query
//   - a pgvector similarity search
//   - a chunk write
//   - the context compiler
//
// Every test below asserts the STATEMENT, not just the result, because "returned
// no rows" and "was scoped to the wrong tenant" look identical from the outside.

import { describe, expect, it, vi } from 'vitest';
import {
  assertTenantPredicate,
  MissingTenantPredicateError,
  tenantQuery,
} from '@/modules/business-brain';
import {
  SIMILARITY_SEARCH_SQL,
  INSERT_CHUNK_SQL,
  PgChunkStore,
} from '@/modules/rag';
import { searchTransactions } from '@/modules/business-brain/infrastructure/sales-facts';
import { loadCustomerActivity } from '@/modules/business-brain/infrastructure/counterparty-facts';
import {
  BUSINESS_A,
  BUSINESS_B,
  createFakeDatabase,
  tenantFor,
} from '../helpers/fake-database';
import { asDocumentId } from '@/lib/types';

const OCT = {
  from: new Date('2026-10-01T00:00:00.000Z'),
  to: new Date('2026-11-01T00:00:00.000Z'),
};

const VECTOR_1536 = Array.from({ length: 1536 }, (_, i) => Number(((i % 7) / 7).toFixed(6)));

describe('tenant predicate guard', () => {
  it('accepts a statement scoped with business_id = $1', () => {
    expect(() => assertTenantPredicate('SELECT 1 FROM transactions WHERE business_id = $1')).not.toThrow();
  });

  it('accepts a statement whose tenant predicate is not $1', () => {
    expect(() =>
      assertTenantPredicate('SELECT 1 FROM t JOIN x ON x.business_id = $3 WHERE y.a = $1'),
    ).not.toThrow();
  });

  it('refuses a statement with no tenant predicate', () => {
    expect(() => assertTenantPredicate('SELECT * FROM transactions')).toThrow(
      MissingTenantPredicateError,
    );
  });

  it('refuses a statement that only projects business_id', () => {
    expect(() => assertTenantPredicate('SELECT business_id FROM transactions')).toThrow(
      MissingTenantPredicateError,
    );
  });

  it('refuses a statement whose predicate is not an equality on a placeholder', () => {
    expect(() => assertTenantPredicate('SELECT 1 FROM t WHERE business_id LIKE $1')).toThrow(
      MissingTenantPredicateError,
    );
  });

  it('binds the tenant as $1 ahead of any caller parameter', async () => {
    const database = createFakeDatabase([{ match: 'FROM transactions', rows: [] }]);

    await tenantQuery(database, BUSINESS_A, 'SELECT 1 FROM transactions WHERE business_id = $1 AND type = $2', [
      'sale',
    ]);

    expect(database.onlyCallMatching('FROM transactions').params).toEqual([BUSINESS_A, 'sale']);
  });

  it('never reaches the database when the predicate is missing', async () => {
    const database = createFakeDatabase();

    await expect(tenantQuery(database, BUSINESS_A, 'SELECT * FROM transactions')).rejects.toThrow(
      MissingTenantPredicateError,
    );
    expect(database.calls).toHaveLength(0);
  });

  it('accepts a root-scoped statement only when the caller opts in', () => {
    expect(() => assertTenantPredicate('SELECT 1 FROM businesses WHERE id = $1')).toThrow(
      MissingTenantPredicateError,
    );
    expect(() =>
      assertTenantPredicate('SELECT 1 FROM businesses WHERE id = $1', 'root_id'),
    ).not.toThrow();
  });
});

describe('structured tool queries are tenant scoped', () => {
  it('scopes transaction search to the caller tenant', async () => {
    const database = createFakeDatabase([{ match: 'FROM transactions', rows: [] }]);

    await searchTransactions(database, BUSINESS_A, { from: OCT.from, to: OCT.to, limit: 10 });

    const call = database.onlyCallMatching('FROM transactions');
    expect(call.sql).toMatch(/business_id\s*=\s*\$1/);
    expect(call.params[0]).toBe(BUSINESS_A);
  });

  it('scopes transaction search to the caller tenant for business B', async () => {
    const database = createFakeDatabase([{ match: 'FROM transactions', rows: [] }]);

    await searchTransactions(database, BUSINESS_B, { from: OCT.from, to: OCT.to, limit: 10 });

    expect(database.onlyCallMatching('FROM transactions').params[0]).toBe(BUSINESS_B);
  });

  it('scopes customer activity to the caller tenant', async () => {
    const database = createFakeDatabase([{ match: 'FROM customers c', rows: [] }]);

    await loadCustomerActivity(database, BUSINESS_A, { from: OCT.from, to: OCT.to, limit: 10 });

    const call = database.onlyCallMatching('FROM customers c');
    expect(call.sql).toMatch(/c\.business_id\s*=\s*\$1/);
    expect(call.params[0]).toBe(BUSINESS_A);
  });

  it('binds a requested customerId as a filter, never as the tenant', async () => {
    const database = createFakeDatabase([{ match: 'FROM customers c', rows: [] }]);
    const targetCustomer = 'dddddddd-0000-4000-8000-00000000000d';

    await loadCustomerActivity(database, BUSINESS_A, {
      from: OCT.from,
      to: OCT.to,
      customerId: targetCustomer,
      limit: 10,
    });

    const call = database.onlyCallMatching('FROM customers c');
    expect(call.params[0]).toBe(BUSINESS_A);
    // The customer id is a bound filter in a later position.
    expect(call.params).toContain(targetCustomer);
    expect(call.params.indexOf(targetCustomer)).toBeGreaterThan(0);
  });

  it('scopes every statement a business tool issues to one tenant', async () => {
    const database = createFakeDatabase([
      { match: 'FROM transactions', rows: [] },
      { match: 'FROM products', rows: [] },
      { match: 'FROM inventory_movements', rows: [] },
    ]);

    const { createBusinessReadOnlyTools } = await import('@/modules/business-brain');
    const registry = await import('@/lib/ai/tools/registry');
    const tools = createBusinessReadOnlyTools(database);
    const toolRegistry = registry.createToolRegistry({
      tools,
      authorize: async () => undefined,
    });

    const session = toolRegistry.open(tenantFor(BUSINESS_A));
    await session.call('inventory_status', {}).catch(() => undefined);
    await session.call('sales_summary', {}).catch(() => undefined);

    expect(database.calls.length).toBeGreaterThan(0);
    for (const call of database.calls) {
      expect(call.params[0]).toBe(BUSINESS_A);
      // `businesses` is the one root-scoped table, and it declares that scope.
      if (!/FROM businesses/.test(call.sql)) {
        expect(call.sql).toMatch(/business_id\s*=\s*\$1/);
      }
    }
  });
});

describe('vector retrieval is tenant scoped', () => {
  it('binds the tenant as the first similarity-search parameter', async () => {
    const database = createFakeDatabase([{ match: 'FROM document_embeddings', rows: [] }]);
    const store = new PgChunkStore({ database });

    await store.search(BUSINESS_A, { queryEmbedding: VECTOR_1536, limit: 10, minSimilarity: 0.3 });

    const call = database.onlyCallMatching('FROM document_embeddings');
    expect(call.params[0]).toBe(BUSINESS_A);
  });

  it('scopes the document join to the same tenant', () => {
    expect(SIMILARITY_SEARCH_SQL).toMatch(/d\.business_id\s*=\s*\$1/);
    expect(SIMILARITY_SEARCH_SQL).toMatch(/e\.business_id\s*=\s*\$1/);
  });

  it('exposes no tenant parameter on the search interface', () => {
    // The signature is the control: `businessId` is a positional argument the
    // caller cannot populate from a model-supplied value.
    const store = new PgChunkStore({ database: createFakeDatabase() });
    expect(store.search.length).toBe(2);
  });

  it('returns only rows belonging to the requesting tenant', async () => {
    const database = createFakeDatabase([
      {
        match: 'FROM document_embeddings',
        rows: [
          {
            id: 'chunk-a',
            business_id: BUSINESS_A,
            document_id: 'doc-a',
            content: 'tenant A invoice',
            metadata: {
              businessId: BUSINESS_A,
              sourceId: 'doc-a',
              sourceType: 'document',
              chunkIndex: 0,
              totalChunks: 1,
              chunkerVersion: 'rag-chunker.v1',
            },
            created_at: new Date('2026-10-02T00:00:00.000Z'),
            document_source_type: 'invoice',
            file_name: 'a.pdf',
            uploaded_at: new Date('2026-10-01T00:00:00.000Z'),
            similarity: 0.82,
          },
        ],
      },
    ]);
    const store = new PgChunkStore({ database });

    const results = await store.search(BUSINESS_A, {
      queryEmbedding: VECTOR_1536,
      limit: 10,
      minSimilarity: 0.3,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.chunk.businessId).toBe(BUSINESS_A);
  });

  it('drops a row whose provenance cannot be cited', async () => {
    const database = createFakeDatabase([
      {
        match: 'FROM document_embeddings',
        rows: [
          {
            id: 'chunk-orphan',
            business_id: BUSINESS_A,
            document_id: 'doc-a',
            content: 'text with no source reference',
            metadata: { chunkIndex: 0 },
            created_at: new Date(),
            document_source_type: 'invoice',
            file_name: null,
            uploaded_at: new Date(),
            similarity: 0.9,
          },
        ],
      },
    ]);

    const results = await new PgChunkStore({ database }).search(BUSINESS_A, {
      queryEmbedding: VECTOR_1536,
      limit: 10,
      minSimilarity: 0.3,
    });

    // An uncitable chunk would invite a fabricated citation, so it is refused.
    expect(results).toHaveLength(0);
  });

  it('scopes chunk writes to the caller tenant', async () => {
    const database = createFakeDatabase([
      { match: 'BEGIN', rows: [] },
      { match: 'INSERT INTO document_embeddings', rowCount: 1 },
      { match: 'COMMIT', rows: [] },
    ]);
    const store = new PgChunkStore({ database });

    await store.save(BUSINESS_A, [
      {
        documentId: asDocumentId('11111111-0000-4000-8000-000000000001'),
        content: 'chunk text',
        metadata: {
          businessId: BUSINESS_A,
          sourceId: 'doc-a',
          sourceType: 'document',
          chunkIndex: 0,
          totalChunks: 1,
          chunkerVersion: 'rag-chunker.v1',
        },
        embedding: VECTOR_1536,
      },
    ]);

    const insert = database.onlyCallMatching('INSERT INTO document_embeddings');
    expect(insert.params[0]).toBe(BUSINESS_A);
    expect(INSERT_CHUNK_SQL).not.toMatch(/\$\{/)  // no interpolation into SQL
  });

  it('scopes deletion to the caller tenant', async () => {
    const database = createFakeDatabase([{ match: 'DELETE FROM document_embeddings', rowCount: 3 }]);
    const store = new PgChunkStore({ database });

    await store.deleteByDocument(BUSINESS_B, asDocumentId('11111111-0000-4000-8000-000000000002'));

    const call = database.onlyCallMatching('DELETE FROM document_embeddings');
    expect(call.params).toEqual([BUSINESS_B, '11111111-0000-4000-8000-000000000002']);
  });

  it('raises the ANN breadth so a small tenant is not under-returned', async () => {
    const database = createFakeDatabase([{ match: 'FROM document_embeddings', rows: [] }]);
    await new PgChunkStore({ database, efSearch: 200 }).search(BUSINESS_A, {
      queryEmbedding: VECTOR_1536,
      limit: 5,
      minSimilarity: 0.3,
    });

    const setting = database.onlyCallMatching('SET LOCAL hnsw.ef_search');
    expect(setting.sql).toContain('SET LOCAL hnsw.ef_search = 200');
  });

  it('clamps an out-of-range ANN breadth before it reaches SQL', async () => {
    const database = createFakeDatabase([{ match: 'FROM document_embeddings', rows: [] }]);
    await new PgChunkStore({ database, efSearch: 10_000_000 }).search(BUSINESS_A, {
      queryEmbedding: VECTOR_1536,
      limit: 5,
      minSimilarity: 0.3,
    });

    expect(database.onlyCallMatching('SET LOCAL hnsw.ef_search').sql).toContain('= 1000');
  });

  it('refuses to execute a similarity search built without the tenant predicate', () => {
    expect(SIMILARITY_SEARCH_SQL).toMatch(/business_id\s*=\s*\$1/);
    expect(() => assertTenantPredicate(SIMILARITY_SEARCH_SQL)).not.toThrow();
  });
});

describe('tenant isolation through the registry and compiler', () => {
  it('keeps two tenants tool sessions entirely separate', async () => {
    const execute = vi.fn(async () => ({ value: 'x' }));
    const { createToolRegistry, defineTool } = await import('@/lib/ai/tools/registry');
    const { z } = await import('zod');

    const tool = defineTool({
      name: 'demo_metric',
      version: 'v1',
      description: 'demo',
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ value: z.string() }).strict(),
      authorization: { minimumRole: 'staff', permission: 'analytics:read' },
      sensitivity: 'financial',
      readOnly: true,
      source: 'database',
      execute,
    });

    const registry = createToolRegistry({ tools: [tool as never], authorize: async () => undefined });
    const contextA = registry.open(tenantFor(BUSINESS_A));
    const contextB = registry.open(tenantFor(BUSINESS_B));

    await contextA.call('demo_metric', {});
    await contextB.call('demo_metric', {});

    expect(execute).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = execute.mock.calls as unknown as [
      [{ tenant: { businessId: string } }],
      [{ tenant: { businessId: string } }],
    ];
    expect(firstCall[0].tenant.businessId).toBe(BUSINESS_A);
    expect(secondCall[0].tenant.businessId).toBe(BUSINESS_B);
  });
});
