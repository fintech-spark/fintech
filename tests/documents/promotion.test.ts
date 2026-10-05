import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { asBusinessId, asUserId, asDocumentId } from '@/lib/types';
import { promoteReviewedDocument } from '@/modules/documents/application/promotion';
import { contentHash } from '@/modules/documents/infrastructure/private-storage';

const biz = asBusinessId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), id = asDocumentId('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
const user = asUserId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const ctx = { businessId:biz,userId:user,role:'owner' as const,correlationId:'synthetic' };
const values = { kind:'expense',reviewed:true,extractionId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',date:'2026-10-05',reference:'SYN-1',currency:'INR',category:'supplies',description:'Synthetic',vendor:'Synthetic Vendor',amountMinor:12345 };
function fixture() {
  const bytes = Buffer.from('%PDF-1.7 synthetic');
  const row = {id,business_id:biz,source_type:'receipt',file_name:'synthetic.pdf',mime_type:'application/pdf',file_size:bytes.length,
    storage_path:`${biz}/${user}/${id}.pdf`,status:'review_required',original_name:'synthetic.pdf',content_hash:contentHash(bytes),
    page_count:null,language:null,extraction_id:values.extractionId,rejection_reason:null,tags:[],uploaded_by:user,uploaded_at:'2026-10-05T00:00:00Z',processed_at:null,updated_at:'2026-10-05T00:00:00Z'};
  const query = { select() {return this;},eq() {return this;},limit() {return this;},then(resolve: (result: object) => unknown) {return Promise.resolve({data:[row],error:null}).then(resolve);} };
  const download = vi.fn(async () => ({data:new Blob([bytes]),error:null}));
  const rpc = vi.fn(async () => {row.status = 'approved';return {data:{},error:null};});
  const db = {from:() => query,storage:{from:() => ({download})},rpc} as unknown as SupabaseClient;
  return {db,row,download,rpc};
}
describe('review promotion source integrity', () => {
  it('checks original bytes before atomic promotion and passes only reviewed values', async () => {
    const f = fixture();expect((await promoteReviewedDocument(f.db,ctx,id,values)).status).toBe('approved');
    expect(f.download).toHaveBeenCalledTimes(1);
    expect(f.rpc).toHaveBeenCalledWith('promote_reviewed_document',{p_business_id:biz,p_document_id:id,p_review:values});
  });
  it('does not promote a missing or changed original', async () => {
    const f = fixture();f.download.mockResolvedValue({data:new Blob(['changed synthetic source']),error:null});
    await expect(promoteReviewedDocument(f.db,ctx,id,values)).rejects.toThrow('original no longer matches');expect(f.rpc).not.toHaveBeenCalled();
  });
  it('replays an approved document through the database even if the source is unavailable', async () => {
    const f = fixture();f.row.status='approved';await promoteReviewedDocument(f.db,ctx,id,values);
    expect(f.download).not.toHaveBeenCalled();expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it('denies unauthorized roles and invalid review before any bytes or writes', async () => {
    const f = fixture();await expect(promoteReviewedDocument(f.db,{...ctx,role:'staff'},id,values)).rejects.toThrow('permission');
    await expect(promoteReviewedDocument(f.db,ctx,id,{...values,reviewed:false})).rejects.toThrow('Review values');
    expect(f.download).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();
  });
});
