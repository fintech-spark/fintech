import {expect,it,vi} from 'vitest';
import {PgChunkStore,DELETE_BY_DOCUMENT_SQL,INSERT_CHUNK_SQL} from '@/modules/rag/infrastructure/chunk-repository';
import type {DatabaseClient,DatabaseTransaction} from '@/lib/database';
import {asBusinessId,asDocumentId} from '@/lib/types';
it('replaces vectors on one transaction and preserves prior vectors on insert failure',async () => {
  const businessId=asBusinessId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),documentId=asDocumentId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  let persisted=['prior vector']; const statements: string[]=[];
  const database={transaction:async (fn:(tx:DatabaseTransaction) => Promise<unknown>) => {
    let working=[...persisted];
    const tx={id:'synthetic-transaction',commit:async () => {},rollback:async () => {},query:async (sql:string,params:readonly unknown[]) => {expect(sql).toContain('FOR UPDATE');expect(params).toEqual([businessId,documentId]);return [{id:documentId}];},execute:async (sql:string,params:readonly unknown[]) => {
      expect(params[0]).toBe(businessId); statements.push(sql);
      if(sql === DELETE_BY_DOCUMENT_SQL){working=[];return 1;}
      if(sql === INSERT_CHUNK_SQL) throw new Error('synthetic persistence outage');
      throw new Error('Unexpected statement');
    }} as DatabaseTransaction;
    const result=await fn(tx);persisted=working;return result;
  },execute:vi.fn(() => {throw new Error('Replacement must not use a standalone delete');})} as unknown as DatabaseClient;
  const store=new PgChunkStore({database});
  await expect(store.replaceByDocument(businessId,documentId,[{documentId,content:'new source',embedding:[1],metadata:{businessId,sourceId:documentId,sourceType:'document',chunkIndex:0,totalChunks:1,chunkerVersion:'synthetic',embeddingModel:'synthetic'}}])).rejects.toThrow('synthetic persistence outage');
  expect(statements).toEqual([DELETE_BY_DOCUMENT_SQL,INSERT_CHUNK_SQL]);expect(persisted).toEqual(['prior vector']);
});
