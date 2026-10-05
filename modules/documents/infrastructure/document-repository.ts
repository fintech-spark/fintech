// Merchant Brain: documents repository and service
//
// RLS-backed metadata operations. Production bytes, extraction and promotion are
// composed in lib/http/documents.ts; metadata-only approval fails closed.

import 'server-only';

import type {
  BusinessId,
  DocumentId,
  PaginatedResult,
  TenantContext,
  UserId,
} from '@/lib/types';
import { asDocumentId } from '@/lib/types';
import { AuthorizationError, BusinessRuleError, NotFoundError, ValidationError } from '@/lib/errors';
import {
  type Db,
  firstOrNull,
  paginate,
  toDate,
  toIso,
  toOptionalDate,
  toOptionalString,
  unwrap,
} from '@/lib/database/query-helpers';
import { hasPermission } from '@/lib/http/auth-context';

import type {
  Document,
  DocumentMetadata,
  DocumentSourceType,
  DocumentStatus,
} from '../domain/types';
import { DOCUMENT_STATUS_TRANSITIONS } from '../domain/types';
import { isOwnTenantStoragePath } from '../domain/rules';

// ===========================================================================
// Documents
// ===========================================================================

const DOCUMENT_COLUMNS = `
  id, business_id, source_type, file_name, mime_type, file_size, storage_path,
  status, original_name, content_hash, page_count, language, extraction_id,
  rejection_reason, tags, uploaded_by, uploaded_at, processed_at, updated_at,
  rag_indexing_status, rag_chunk_count, rag_indexing_error
`;

interface DocumentRow {
  id: string; business_id: string; source_type: DocumentSourceType;
  file_name: string; mime_type: string; file_size: number; storage_path: string;
  status: DocumentStatus; original_name: string | null; content_hash: string | null;
  page_count: number | null; language: string | null; extraction_id: string | null;
  rejection_reason: string | null; tags: string[] | null; uploaded_by: string;
  uploaded_at: string; processed_at: string | null; updated_at: string;
  rag_indexing_status?: DocumentMetadata['ragIndexingStatus']; rag_chunk_count?: number; rag_indexing_error?: string | null;
}

function toDocument(row: DocumentRow): Document {
  const metadata: DocumentMetadata = {
    originalName: row.original_name ?? row.file_name,
    contentHash: toOptionalString(row.content_hash),
    pageCount: row.page_count ?? undefined,
    language: toOptionalString(row.language),
    extractionId: toOptionalString(row.extraction_id),
    rejectionReason: toOptionalString(row.rejection_reason),
    tags: row.tags ?? undefined,
    ragIndexingStatus: row.rag_indexing_status,
    ragChunkCount: row.rag_chunk_count,
    ragIndexingError: row.rag_indexing_error ?? undefined,
  };

  return {
    id: asDocumentId(row.id) as DocumentId,
    businessId: row.business_id as unknown as BusinessId,
    sourceType: row.source_type,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    storagePath: row.storage_path,
    status: row.status,
    metadata,
    uploadedAt: toDate(row.uploaded_at),
    processedAt: toOptionalDate(row.processed_at),
    uploadedBy: row.uploaded_by as unknown as UserId,
  };
}

export class PostgrestDocumentRepository {
  constructor(private readonly db: Db) {}

  async findByContentHash(businessId: BusinessId, hash: string): Promise<Document | null> {
    const rows = unwrap(await this.db.from('documents').select(DOCUMENT_COLUMNS)
      .eq('business_id', businessId).eq('content_hash', hash).limit(1));
    const row = firstOrNull<DocumentRow>(rows);
    return row ? toDocument(row) : null;
  }

  findById(businessId: BusinessId, id: DocumentId) {
    return this.db
      .from('documents')
      .select(DOCUMENT_COLUMNS)
      .eq('business_id', businessId)
      .eq('id', id)
      .limit(1)
      .then(unwrap)
      .then((d) => {
        const row = firstOrNull<DocumentRow>(d);
        return row ? toDocument(row) : null;
      });
  }

  async list(
    businessId: BusinessId,
    filters: { page?: number; limit?: number; status?: DocumentStatus; sourceType?: DocumentSourceType; search?: string },
    sort: { column: string; ascending: boolean },
  ): Promise<PaginatedResult<Document>> {
    const limit = filters.limit ?? 20;
    const page = filters.page ?? 1;

    let query = this.db
      .from('documents')
      .select(DOCUMENT_COLUMNS, { count: 'exact' })
      .eq('business_id', businessId);

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.sourceType) query = query.eq('source_type', filters.sourceType);
    if (filters.search) query = query.ilike('file_name', `%${filters.search}%`);

    const column = sort.column === 'uploadedAt' ? 'uploaded_at' : sort.column;
    const { data, error, count } = await query
      .order(column, { ascending: sort.ascending })
      .range((page - 1) * limit, page * limit - 1);

    if (error) throw error;
    const items = ((data ?? []) as DocumentRow[]).map(toDocument);
    return paginate(items, count ?? items.length, page, limit);
  }

  async insert(input: {
    id: DocumentId;
    businessId: BusinessId;
    sourceType: DocumentSourceType;
    fileName: string;
    mimeType: string;
    fileSize: number;
    storagePath: string;
    uploadedBy: UserId;
    tags?: readonly string[];
    contentHash?: string;
  }): Promise<Document> {
    const row = unwrap(
      await this.db
        .from('documents')
        .insert({
          id: input.id,
          business_id: input.businessId,
          source_type: input.sourceType,
          file_name: input.fileName,
          mime_type: input.mimeType,
          file_size: input.fileSize,
          storage_path: input.storagePath,
          status: 'uploaded',
          original_name: input.fileName,
          content_hash: input.contentHash ?? null,
          tags: input.tags ?? null,
          uploaded_by: input.uploadedBy,
        })
        .select(DOCUMENT_COLUMNS)
        .single(),
    ) as DocumentRow;
    return toDocument(row);
  }

  async setStatus(
    businessId: BusinessId,
    id: DocumentId,
    status: DocumentStatus,
    reason?: string,
    expectedStatus?: DocumentStatus,
  ): Promise<Document> {
    let query = this.db
        .from('documents')
        .update({
          status,
          rejection_reason: reason ?? null,
          processed_at: status === 'extracted' ? toIso(new Date()) : null,
          updated_at: toIso(new Date()),
        })
        .eq('business_id', businessId)
        .eq('id', id);
    if (expectedStatus) query = query.eq('status', expectedStatus);
    const row = unwrap(await query.select(DOCUMENT_COLUMNS).single()) as DocumentRow;
    return toDocument(row);
  }
}

/**
 * Rejects a storage path that is not addressed to the caller's own tenant.
 *
 * A structurally unusable path is a client error (400). A well-formed path
 * rooted at a *different* tenant is a boundary violation (403): the caller
 * addressed storage they do not own.
 */
function assertTenantStoragePath(businessId: BusinessId, storagePath: string): void {
  if (typeof storagePath !== 'string' || storagePath.trim().length === 0) {
    throw new ValidationError('A storage path is required.', [
      { field: 'storagePath', message: 'storagePath must not be empty.' },
    ]);
  }

  if (!isOwnTenantStoragePath(storagePath, businessId)) {
    throw new AuthorizationError('The storage path is not addressable within your business.');
  }
}

/** Implements the declared document write operations (contract plan §3.8). */
export class DefaultDocumentService {
  constructor(private readonly repository: PostgrestDocumentRepository) {}

  async getById(ctx: TenantContext, id: DocumentId): Promise<Document | null> {
    this.require(ctx, 'documents:read');
    return this.repository.findById(ctx.businessId, id);
  }

  async list(
    ctx: TenantContext,
    filters: { page?: number; limit?: number; status?: DocumentStatus; sourceType?: DocumentSourceType; search?: string },
  ) {
    this.require(ctx, 'documents:read');
    return this.repository.list(ctx.businessId, filters, { column: 'uploaded_at', ascending: false });
  }

  /**
   * Registers document metadata.
   *
   * The binary is written to storage by a separate upload step; this records
   * the pointer. The route schema only rejects absolute and traversing paths —
   * it has no tenant to compare against — so the tenant-prefix rule is enforced
   * here, against the authenticated TenantContext.
   */
  async upload(
    ctx: TenantContext,
    input: {
      fileName: string;
      mimeType: string;
      fileSize: number;
      sourceType: DocumentSourceType;
      storagePath: string;
      tags?: readonly string[];
    },
  ): Promise<Document> {
    this.require(ctx, 'documents:write');
    assertTenantStoragePath(ctx.businessId, input.storagePath);

    return this.repository.insert({
      id: asDocumentId(crypto.randomUUID()) as DocumentId,
      businessId: ctx.businessId,
      sourceType: input.sourceType,
      fileName: input.fileName,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      storagePath: input.storagePath,
      uploadedBy: ctx.userId,
      tags: input.tags,
    });
  }

  async updateStatus(
    ctx: TenantContext,
    id: DocumentId,
    status: DocumentStatus,
    reason?: string,
  ): Promise<Document> {
    this.require(ctx, 'documents:write');

    const existing = await this.repository.findById(ctx.businessId, id);
    if (!existing) throw new NotFoundError('Document', id);
    if (status === 'rejected' && (!reason?.trim() || reason.length > 500)) {
      throw new ValidationError('A rejection reason of 1–500 characters is required.');
    }

    // Phase 1 transition table — no new statuses invented.
    const allowed = DOCUMENT_STATUS_TRANSITIONS[existing.status];
    if (!allowed.includes(status)) {
      throw new BusinessRuleError(
        `Cannot move a document from "${existing.status}" to "${status}".`,
        { from: existing.status, to: status },
      );
    }

    if (status === 'approved') {
      throw new BusinessRuleError('Approval requires reviewed values and atomic ledger promotion.');
    }
    return this.repository.setStatus(ctx.businessId, id, status, reason, existing.status);
  }

  async approve(ctx: TenantContext, id: DocumentId): Promise<Document> {
    return this.updateStatus(ctx, id, 'approved');
  }

  async reject(ctx: TenantContext, id: DocumentId, reason: string): Promise<Document> {
    return this.updateStatus(ctx, id, 'rejected', reason);
  }

  private require(ctx: TenantContext, permission: Parameters<typeof hasPermission>[1]) {
    if (!hasPermission(ctx.role, permission)) {
      throw new AuthorizationError(`Missing required permission: ${permission}.`);
    }
  }
}
