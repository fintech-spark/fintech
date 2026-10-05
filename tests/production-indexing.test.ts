import { beforeEach,describe,expect,it,vi } from 'vitest';
import { indexDocumentContext } from '@/lib/ai/document-indexer';
import { asBusinessId,asDocumentId,asUserId } from '@/lib/types';
import type { SupabaseClient } from '@supabase/supabase-js';
const mocks = vi.hoisted(() => ({document:vi.fn(),candidate:vi.fn(),index:vi.fn(),rpc:vi.fn()}));
vi.mock('@/modules/documents/infrastructure/document-repository',() => ({PostgrestDocumentRepository:class{findById=mocks.document}}));
vi.mock('@/modules/extraction',() => ({PostgrestExtractionRepository:class{findByDocument=mocks.candidate}}));
vi.mock('@/lib/database',() => ({getDatabaseClient:() => ({})}));
vi.mock('@/modules/rag',() => ({DefaultRAGService:class{index=mocks.index},PgChunkStore:class{},ProviderEmbeddingProvider:class{}}));
const businessId=asBusinessId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),id=asDocumentId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const ctx={businessId,userId:asUserId('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),role:'owner' as const,correlationId:'synthetic'};
const db={rpc:mocks.rpc} as unknown as SupabaseClient;
describe('production extraction-to-context indexing',() => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.document.mockResolvedValue({businessId,id,status:'review_required',sourceType:'receipt',fileName:'synthetic.pdf'});
    mocks.candidate.mockResolvedValue({businessId,documentId:id,evidence:[{excerpt:'Synthetic original source excerpt'}],fields:[{value:99999}],extractedAt:new Date('2026-10-05')});
    mocks.index.mockResolvedValue({embeddedCount:1,failedCount:0});
    mocks.rpc.mockResolvedValue({error:null});
  });
  it('indexes cited source text, not candidate figures, then records the actual outcome',async () => {
    expect(await indexDocumentContext(db,ctx,id)).toEqual({status:'indexed',chunkCount:1});
    expect(mocks.index).toHaveBeenCalledWith(ctx,expect.objectContaining({documentId:id,content:'Synthetic original source excerpt'}));
    expect(mocks.rpc).toHaveBeenCalledWith('record_document_index',{p_business_id:businessId,p_document_id:id,p_status:'indexed'});
  });
  it('does not fabricate context when no excerpt exists',async () => {
    mocks.candidate.mockResolvedValue({businessId,documentId:id,evidence:[],extractedAt:new Date()});
    expect(await indexDocumentContext(db,ctx,id)).toEqual({status:'insufficient_evidence',chunkCount:0}); expect(mocks.index).not.toHaveBeenCalled();
  });
  it('records indexing failure without discarding saved extraction',async () => {
    mocks.index.mockRejectedValue(new Error('synthetic provider outage'));
    expect(await indexDocumentContext(db,ctx,id)).toEqual({status:'failed',chunkCount:0});
    expect(mocks.rpc).toHaveBeenCalledWith('record_document_index',expect.objectContaining({p_status:'failed'}));
  });
  it('never reports success if outcome persistence fails',async () => {
    mocks.rpc.mockResolvedValue({error:new Error('synthetic database failure')});
    await expect(indexDocumentContext(db,ctx,id)).rejects.toThrow('synthetic database failure');
  });
  it('denies staff and cross-tenant candidates before any embedding',async () => {
    await expect(indexDocumentContext(db,{...ctx,role:'staff'},id)).rejects.toThrow();
    mocks.candidate.mockResolvedValue({businessId:'other',documentId:id});
    await expect(indexDocumentContext(db,ctx,id)).rejects.toThrow(); expect(mocks.index).not.toHaveBeenCalled();
  });
});
