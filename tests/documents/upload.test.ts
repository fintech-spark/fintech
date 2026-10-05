import { describe, expect, it, vi } from 'vitest';
import { asBusinessId, asUserId, type TenantContext } from '@/lib/types';
import { ProductionDocumentService } from '@/modules/documents/application/production-service';
import { parseDocumentUpload, MAX_MULTIPART_BYTES } from '@/modules/documents/application/multipart';
import { PrivateDocumentStorage } from '@/modules/documents/infrastructure/private-storage';
import type { PostgrestDocumentRepository } from '@/modules/documents/infrastructure/document-repository';
import type { ExtractionService } from '@/modules/extraction';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Document } from '@/modules/documents';

const ctx: TenantContext = { businessId: asBusinessId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  userId: asUserId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), role: 'owner', correlationId: 'synthetic' };
const bytes = Buffer.from('%PDF-1.7 synthetic invoice');
function fixture() {
  let document: Document | null = null;
  const repo = {
    findByContentHash: vi.fn(async (): Promise<Document | null> => null),
    insert: vi.fn(async (input) => { document = { ...input, status: 'uploaded', metadata: {}, uploadedAt: new Date() }; return document; }),
    findById: vi.fn(async () => document),
    setStatus: vi.fn(async (_biz, _id, status) => { document = { ...document!, status }; return document; }),
  };
  const storage = { upload: vi.fn(async () => {}), load: vi.fn(async () => bytes), remove: vi.fn(async () => {}) };
  const extraction = { extract: vi.fn(async () => { document = { ...document!, status: 'review_required' }; }) };
  const service = new ProductionDocumentService(repo as unknown as PostgrestDocumentRepository,
    storage as unknown as PrivateDocumentStorage, extraction as unknown as ExtractionService);
  const input = { fileName: '../../invoice.pdf', mimeType: 'application/pdf', fileSize: bytes.length,
    sourceType: 'invoice' as const, fileData: bytes };
  return { service, repo, storage, extraction, input };
}
describe('production bytes upload (synthetic only)', () => {
  it('stores validated bytes at a server-generated path, verifies them, then persists and extracts', async () => {
    const f = fixture();
    const doc = await f.service.uploadBytes(ctx, f.input);
    expect(doc.status).toBe('review_required');
    const args = f.storage.upload.mock.calls[0] as unknown as [string,string,Buffer,string];
    expect(args[1]).toMatch(new RegExp(`^${ctx.businessId}/${ctx.userId}/[a-f0-9-]+\\.pdf$`));
    expect(args[2]).toEqual(bytes);
    expect(f.repo.insert).toHaveBeenCalledWith(expect.objectContaining({ contentHash: expect.stringMatching(/^[a-f0-9]{64}$/), fileName: 'invoice.pdf' }));
  });
  it('denies unauthorized roles before touching storage', async () => {
    const f = fixture();
    await expect(f.service.uploadBytes({ ...ctx, role: 'staff' }, f.input)).rejects.toThrow('permission');
    expect(f.storage.upload).not.toHaveBeenCalled();
  });
  it('reuses tenant-scoped byte-identical uploads without another storage or provider call', async () => {
    const f = fixture(); const first = await f.service.uploadBytes(ctx, f.input);
    f.repo.findByContentHash.mockResolvedValue(first);
    expect((await f.service.uploadBytes(ctx, f.input)).id).toBe(first.id);
    expect(f.storage.upload).toHaveBeenCalledTimes(1); expect(f.extraction.extract).toHaveBeenCalledTimes(1);
  });
  it.each([
    { mimeType: 'image/png' }, { fileSize: 1 },
    { fileName: 'invoice.xlsx' }, { sourceType: 'excel' },
    { fileData: Buffer.alloc(4 * 1024 * 1024 + 1), fileSize: 4 * 1024 * 1024 + 1 },
  ])('rejects mismatched/unsupported/oversized input before storage: %o', async (overrides) => {
    const f = fixture();
    await expect(f.service.uploadBytes(ctx, { ...f.input, ...overrides } as typeof f.input)).rejects.toThrow();
    expect(f.storage.upload).not.toHaveBeenCalled();
  });
  it('does not create metadata on storage failure', async () => {
    const f = fixture(); f.storage.upload.mockRejectedValue(new Error('synthetic storage outage'));
    await expect(f.service.uploadBytes(ctx, f.input)).rejects.toThrow('outage');
    expect(f.repo.insert).not.toHaveBeenCalled();
  });
  it('cleans up unverifiable bytes and does not create metadata', async () => {
    const f = fixture(); f.storage.load.mockResolvedValue(Buffer.from('changed'));
    await expect(f.service.uploadBytes(ctx, f.input)).rejects.toThrow('verification');
    expect(f.storage.remove).toHaveBeenCalled(); expect(f.repo.insert).not.toHaveBeenCalled();
  });
  it('reports orphan cleanup failure honestly', async () => {
    const f = fixture(); f.repo.insert.mockRejectedValue(new Error('synthetic persistence failure'));
    f.storage.remove.mockRejectedValue(new Error('synthetic cleanup failure'));
    await expect(f.service.uploadBytes(ctx, f.input)).rejects.toThrow('cleanup could not be confirmed');
    expect(f.extraction.extract).not.toHaveBeenCalled();
  });
  it('returns the durable failed state for provider failure without deleting the source', async () => {
    const f = fixture();
    f.extraction.extract.mockImplementation(async () => {
      await f.repo.setStatus(ctx.businessId, 'synthetic-id', 'failed');
      throw new Error('synthetic provider outage');
    });
    expect((await f.service.uploadBytes(ctx, f.input)).status).toBe('failed');
    expect(f.storage.remove).not.toHaveBeenCalled();
  });
  it('retains a registered source if the metadata insert response was lost', async () => {
    const f = fixture(); const insert = f.repo.insert.getMockImplementation()!;
    f.repo.insert.mockImplementation(async (input) => { await insert(input); throw new Error('synthetic response lost'); });
    await expect(f.service.uploadBytes(ctx, f.input)).rejects.toThrow('File and metadata saved');
    expect(f.storage.remove).not.toHaveBeenCalled();
  });
  it.each(['../secret.pdf', `${ctx.businessId}/../secret.pdf`, `${ctx.businessId}/%2e%2e/file.pdf`,
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc/user/file.pdf'])('rejects hostile storage path %s', async (path) => {
    const storage = new PrivateDocumentStorage({} as SupabaseClient);
    await expect(storage.load(ctx.businessId, path)).rejects.toThrow('storage path');
  });
});

describe('bounded multipart contract', () => {
  function request(form: FormData) { return new Request('http://localhost/api/documents', { method: 'POST', body: form }); }
  it('reads actual file bytes and accepts only explicit supported source types', async () => {
    const form = new FormData(); form.set('file', new File([bytes], 'invoice.pdf', { type: 'application/pdf' })); form.set('sourceType', 'invoice');
    expect((await parseDocumentUpload(request(form))).fileData).toEqual(bytes);
  });
  it.each(['businessId', 'storagePath', 'mimeType'])('rejects client-controlled %s', async (key) => {
    const form = new FormData(); form.set('file', new File([bytes], 'invoice.pdf')); form.set('sourceType', 'invoice'); form.set(key, 'evil');
    await expect(parseDocumentUpload(request(form))).rejects.toThrow('no storage or tenant');
  });
  it('bounds streamed bytes without trusting content-length', async () => {
    const req = new Request('http://localhost/upload', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: Buffer.alloc(MAX_MULTIPART_BYTES + 1) });
    await expect(parseDocumentUpload(req)).rejects.toThrow('4MB');
  });
  it('rejects the old metadata-only JSON contract', async () => {
    await expect(parseDocumentUpload(new Request('http://localhost/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))).rejects.toThrow('multipart');
  });
});
