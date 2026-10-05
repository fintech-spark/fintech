import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorizationError, AuthenticationError } from '@/lib/errors';
import { asBusinessId, asUserId } from '@/lib/types';
import { POST as upload } from '@/app/api/businesses/[businessId]/documents/route';
import { POST as approve } from '@/app/api/businesses/[businessId]/documents/[id]/approve/route';
import { PATCH as status } from '@/app/api/businesses/[businessId]/documents/[id]/status/route';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), upload: vi.fn(), promote: vi.fn(), process: vi.fn(), update: vi.fn() }));
vi.mock('@/lib/http/auth-context', async (original) => ({ ...await original<object>(), resolveTenantContext: mocks.resolve }));
vi.mock('@/lib/http/documents', () => ({ wireProductionDocuments: () => ({ documents: { uploadBytes: mocks.upload, process: mocks.process } }) }));
vi.mock('@/modules/documents/application/promotion', () => ({ promoteReviewedDocument: mocks.promote }));
vi.mock('@/lib/http/wiring', () => ({ wireClient: () => ({ documents: { updateStatus: mocks.update } }) }));
const biz = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const route = { params: Promise.resolve({ businessId: biz, id }) };
const ctx = { businessId: asBusinessId(biz), userId: asUserId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), role: 'owner', correlationId: 'synthetic' };
const reviewed = { kind:'expense',reviewed:true,extractionId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',date:'2026-10-05',reference:'SYN-1',currency:'INR',category:'supplies',description:'Synthetic',vendor:'Synthetic Vendor',amountMinor:12345 };
const json = (path: string, values: unknown, method = 'POST') => new Request(`http://localhost${path}`, { method, headers: { 'Content-Type':'application/json' }, body:JSON.stringify(values) });
describe('production document route contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.resolve.mockResolvedValue({ ctx, db:{} }); mocks.upload.mockResolvedValue({ id,status:'review_required' });
    mocks.promote.mockResolvedValue({ id,status:'approved' }); mocks.process.mockResolvedValue({ id,status:'review_required' });
  });
  function multipart() {
    const form = new FormData(); form.set('file', new File(['%PDF-1.7 synthetic'], 'invoice.pdf', { type:'application/pdf' })); form.set('sourceType','invoice');
    return new Request('http://localhost/api/documents', { method:'POST',body:form });
  }
  it('returns 201 and forwards real bytes, never a storagePath', async () => {
    const response = await upload(multipart(),route);
    expect(response.status).toBe(201); expect(await response.json()).toEqual({ data:{ id,status:'review_required' } });
    expect(mocks.upload).toHaveBeenCalledWith(ctx,expect.objectContaining({ fileData:Buffer.from('%PDF-1.7 synthetic') }));
    expect(mocks.upload.mock.calls[0][1]).not.toHaveProperty('storagePath');
  });
  it.each([[new AuthenticationError('Authentication required'),401],[new AuthorizationError('Wrong tenant'),403]])('rejects missing auth and unauthorized tenant before upload', async (error, code) => {
    mocks.resolve.mockRejectedValue(error); expect((await upload(multipart(),route)).status).toBe(code); expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('rejects cross-site multipart before any storage call', async () => {
    const request = multipart(); request.headers.set('origin','https://evil.invalid');
    expect((await upload(request,route)).status).toBe(401); expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('rejects metadata-only JSON instead of fabricating a document', async () => {
    expect((await upload(json('/upload',{ storagePath:`${biz}/fake.pdf` }),route)).status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('returns a saved failed state honestly rather than reporting extraction success', async () => {
    mocks.upload.mockResolvedValue({ id,status:'failed' }); expect((await (await upload(multipart(),route)).json()).data.status).toBe('failed');
  });
  it('requires complete explicit reviewed values for approval and scopes them to server context', async () => {
    expect((await approve(json('/approve',{}),route)).status).toBe(400); expect(mocks.promote).not.toHaveBeenCalled();
    expect((await approve(json('/approve',{ ...reviewed,businessId:biz }),route)).status).toBe(400);
    const response = await approve(json('/approve',reviewed),route); expect(response.status).toBe(200);
    expect(mocks.promote).toHaveBeenCalledWith({},ctx,id,reviewed);
  });
  it('does not let a caller move a document into processing/approved through status patch', async () => {
    expect((await status(json('/status',{ status:'approved' },'PATCH'),route)).status).toBe(422);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('runs extraction for queued retry instead of changing a label only', async () => {
    expect((await status(json('/status',{ status:'queued' },'PATCH'),route)).status).toBe(200);
    expect(mocks.process).toHaveBeenCalledWith(ctx,id); expect(mocks.update).not.toHaveBeenCalled();
  });
});
