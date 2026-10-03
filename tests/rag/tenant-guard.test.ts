// Merchant Brain: chunk store tenant guard
//
// The similarity query already filters on `business_id`. These tests pin the
// two things that keep that true: the tenant is bound as a parameter rather
// than interpolated, and a row that arrives with the wrong tenant is dropped
// on the way out regardless of what the SQL claimed.
//
// No database is contacted — the store is driven through a recording client.

import { describe, expect, it, vi } from 'vitest';
import {
  DELETE_BY_DOCUMENT_SQL,
  INSERT_CHUNK_SQL,
  PgChunkStore,
  SIMILARITY_SEARCH_SQL,
} from '@/modules/rag';
import type { DatabaseClient } from '@/lib/database/client';
import { asBusinessId, asDocumentId } from '@/lib/types';

const TENANT = asBusinessId('aaaaaaaa-0000-4000-8000-00000000000a');
const OTHER_TENANT = asBusinessId('cccccccc-0000-4000-8000-00000000000c');

interface Row {
  readonly id: string;
  readonly business_id: string;
  readonly document_id: string;
  readonly content: string;
  readonly metadata: Record<string, unknown> | null;
  readonly created_at: Date;
  readonly document_source_type: string;
  readonly file_name: string | null;
  readonly uploaded_at: Date;
  readonly similarity: number;
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'chunk-1',
    business_id: TENANT,
    document_id: '11111111-0000-4000-8000-000000000001',
    content: 'Synthetic invoice line',
    metadata: { sourceId: 'doc-1', chunkIndex: 0, businessId: TENANT },
    created_at: new Date('2026-01-15T00:00:00.000Z'),
    document_source_type: 'invoice',
    file_name: 'invoice.pdf',
    uploaded_at: new Date('2026-01-15T00:00:00.000Z'),
    similarity: 0.9,
    ...overrides,
  };
}

function clientReturning(rows: readonly Row[]) {
  const queries: { sql: string; params: readonly unknown[] }[] = [];
  const executes: { sql: string; params: readonly unknown[] }[] = [];

  const tx = {
    id: 'tx-1',
    query: vi.fn(async (sql: string, params?: readonly unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return rows;
    }),
    execute: vi.fn(async (sql: string, params?: readonly unknown[]) => {
      executes.push({ sql, params: params ?? [] });
      return 1;
    }),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
  };

  const database = {
    query: vi.fn(async () => rows),
    execute: vi.fn(async (sql: string, params?: readonly unknown[]) => {
      executes.push({ sql, params: params ?? [] });
      return 1;
    }),
    transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    forTenant: vi.fn(),
  } as unknown as DatabaseClient;

  return { database, queries, executes };
}

describe('PgChunkStore tenant guard', () => {
  it('binds the caller tenant as a parameter on the similarity query', async () => {
    const { database, queries } = clientReturning([row()]);
    const store = new PgChunkStore({ database });

    await store.search(TENANT, {
      queryEmbedding: [0.1, 0.2, 0.3],
      limit: 5,
      minSimilarity: 0.3,
    });

    expect(queries).toHaveLength(1);
    expect(queries[0]?.sql).toBe(SIMILARITY_SEARCH_SQL);
    // Both sides of the join are scoped, not just the embeddings table.
    expect(SIMILARITY_SEARCH_SQL).toContain('e.business_id = $1');
    expect(SIMILARITY_SEARCH_SQL).toContain('d.business_id = $1');
    expect(queries[0]?.params[0]).toBe(TENANT);
  });

  it('drops a row whose business_id is not the caller tenant', async () => {
    const { database } = clientReturning([
      row({ id: 'mine', business_id: TENANT }),
      row({ id: 'theirs', business_id: OTHER_TENANT }),
    ]);
    const store = new PgChunkStore({ database });

    const found = await store.search(TENANT, {
      queryEmbedding: [0.1, 0.2, 0.3],
      limit: 5,
      minSimilarity: 0.3,
    });

    expect(found.map((hit) => hit.chunk.id)).toEqual(['mine']);
  });

  it('returns nothing when every arriving row belongs to another tenant', async () => {
    const { database } = clientReturning([
      row({ id: 'theirs-1', business_id: OTHER_TENANT }),
      row({ id: 'theirs-2', business_id: OTHER_TENANT }),
    ]);
    const store = new PgChunkStore({ database });

    const found = await store.search(TENANT, {
      queryEmbedding: [0.1, 0.2, 0.3],
      limit: 5,
      minSimilarity: 0.3,
    });

    expect(found).toEqual([]);
  });

  it('binds the tenant on write and delete as well', async () => {
    const { database, queries, executes } = clientReturning([]);
    const store = new PgChunkStore({ database });

    await store.save(TENANT, [
      {
        documentId: asDocumentId('11111111-0000-4000-8000-000000000001'),
        content: 'chunk text',
        metadata: {
          businessId: TENANT,
          sourceId: 'doc-1',
          sourceType: 'document',
          chunkIndex: 0,
          totalChunks: 1,
          chunkerVersion: 'v1',
        },
        embedding: [0.1, 0.2, 0.3],
      },
    ]);
    await store.deleteByDocument(TENANT, asDocumentId('11111111-0000-4000-8000-000000000001'));

    // Writes go through execute(), not query(): assert the bound parameters.
    expect(executes).toHaveLength(2);
    expect(executes[0]?.sql).toBe(INSERT_CHUNK_SQL);
    expect(executes[0]?.params[0]).toBe(TENANT);
    expect(executes[1]?.sql).toBe(DELETE_BY_DOCUMENT_SQL);
    expect(executes[1]?.params[0]).toBe(TENANT);
    expect(queries).toHaveLength(0);
  });
});
