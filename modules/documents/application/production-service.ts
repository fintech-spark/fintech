import 'server-only';
import type { DocumentId, TenantContext } from '@/lib/types';
import { asDocumentId } from '@/lib/types';
import { assertPermission } from '@/lib/http/auth-context';
import { AuthorizationError, BusinessRuleError, ConflictError, NotFoundError, PayloadTooLargeError, RateLimitError, StorageError, ValidationError } from '@/lib/errors';
import { validateExtractionInput } from '../infrastructure/file-validation';
import type { UploadDocumentInput } from './service';
import { DefaultDocumentService, type PostgrestDocumentRepository } from '../infrastructure/document-repository';
import { contentHash, MAX_UPLOAD_BYTES, type PrivateDocumentStorage } from '../infrastructure/private-storage';

export class ProductionDocumentService extends DefaultDocumentService {
  constructor(private readonly repo: PostgrestDocumentRepository,
    private readonly storage: PrivateDocumentStorage,
    private readonly extraction: { extract(ctx: TenantContext, id: DocumentId): Promise<unknown> },
    private readonly indexContext?: (ctx: TenantContext,id: DocumentId) => Promise<unknown>) {
    super(repo);
  }

  async uploadBytes(ctx: TenantContext, input: UploadDocumentInput) {
    assertPermission(ctx, 'documents:write');
    if (input.sourceType !== 'invoice' && input.sourceType !== 'receipt') {
      throw new BusinessRuleError('Only invoice and receipt extraction is supported.');
    }
    const bytes = Buffer.isBuffer(input.fileData) ? input.fileData : Buffer.from(input.fileData);
    if (bytes.length > MAX_UPLOAD_BYTES) throw new PayloadTooLargeError('Upload exceeds the 4MB file limit.');
    if (input.fileSize !== bytes.length) throw new ValidationError('File size does not match the uploaded bytes.');
    const file = validateExtractionInput({ bytes, fileName: input.fileName, declaredMimeType: input.mimeType });
    if (file.kind !== 'pdf' && file.kind !== 'image') {
      throw new BusinessRuleError('Upload an invoice or receipt as PDF, PNG, JPEG or WebP. CSV, Excel, audio and text extraction are not supported by this production flow.');
    }
    const id = asDocumentId(crypto.randomUUID());
    const extension = file.fileName.slice(file.fileName.lastIndexOf('.')).toLowerCase();
    const path = `${ctx.businessId}/${ctx.userId}/${id}${extension}`;
    const hash = contentHash(bytes);
    const duplicate = await this.repo.findByContentHash(ctx.businessId, hash);
    if (duplicate) return duplicate;
    await this.storage.upload(ctx.businessId, path, bytes, file.detectedMimeType);
    try {
      const stored = await this.storage.load(ctx.businessId, path);
      if (stored.length !== bytes.length || contentHash(stored) !== hash) {
        throw new StorageError('Stored file verification failed.');
      }
      await this.repo.insert({ id, businessId: ctx.businessId, uploadedBy: ctx.userId,
        sourceType: input.sourceType, fileName: file.fileName, mimeType: file.detectedMimeType,
        fileSize: bytes.length, storagePath: path, contentHash: hash, tags: input.tags });
    } catch (error) {
      // A lost INSERT response is not proof the insert failed. Keep the source if a row exists
      // or registration cannot be checked; deleting then would corrupt a durable document.
      let registered;
      try { registered = await this.repo.findById(ctx.businessId, id); } catch {
        throw new StorageError('Upload registration could not be confirmed. The private file was retained for reconciliation.');
      }
      if (registered) throw new StorageError('File and metadata saved, but the upload response could not be confirmed. Refresh before retrying.');
      try { await this.storage.remove(ctx.businessId, path); } catch {
        throw new StorageError('Upload registration failed and private file cleanup could not be confirmed. Contact support with the request reference.');
      }
      const concurrent = await this.repo.findByContentHash(ctx.businessId, hash);
      if (concurrent) return concurrent;
      throw error;
    }
    return this.process(ctx, id);
  }

  async process(ctx: TenantContext, id: DocumentId) {
    assertPermission(ctx, 'documents:write');
    const doc = await this.repo.findById(ctx.businessId, id);
    if (!doc) throw new NotFoundError('Document', id);
    if (!['uploaded','failed','queued','processing'].includes(doc.status)) {
      throw new ConflictError('Only a pending or failed document can be processed again.');
    }
    if (doc.status === 'uploaded') {
      await this.updateStatus(ctx, id, 'validating');
      await this.updateStatus(ctx, id, 'queued');
    } else if (doc.status === 'failed') {
      await this.updateStatus(ctx, id, 'queued');
    }
    try {
      await this.extraction.extract(ctx, id);
    } catch (error) {
      if (error instanceof RateLimitError || error instanceof ConflictError || error instanceof AuthorizationError) throw error;
      // The persisted state is the upload outcome; the merchant can retry a failed extraction.
      const failed = await this.repo.findById(ctx.businessId, id);
      if (!failed || failed.status !== 'failed') {
        throw new StorageError('File saved, but processing completion could not be confirmed. Refresh the document before retrying.');
      }
      return failed;
    }
    const result = await this.repo.findById(ctx.businessId, id);
    if (!result) throw new NotFoundError('Document', id);
    if (this.indexContext && ['extracted','review_required'].includes(result.status)) await this.indexContext(ctx,id);
    return this.indexContext ? await this.repo.findById(ctx.businessId,id) ?? result : result;
  }
}
