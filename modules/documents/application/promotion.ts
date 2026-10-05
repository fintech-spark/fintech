import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentId, TenantContext } from '@/lib/types';
import { assertPermission } from '@/lib/http/auth-context';
import { BusinessRuleError, ConflictError, NotFoundError, StorageError, ValidationError } from '@/lib/errors';
import { documentReviewSchema } from '../domain/review';
import { PostgrestDocumentRepository } from '../infrastructure/document-repository';
import { PrivateDocumentStorage, contentHash } from '../infrastructure/private-storage';

export async function promoteReviewedDocument(db: SupabaseClient, ctx: TenantContext, id: DocumentId, input: unknown) {
  assertPermission(ctx, 'documents:write');
  const parsed = documentReviewSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError('Review values are invalid.', parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })));
  assertPermission(ctx, parsed.data.kind === 'invoice' ? 'transactions:write' : 'expenses:write');
  const repository = new PostgrestDocumentRepository(db);
  const source = await repository.findById(ctx.businessId, id);
  if (!source || source.businessId !== ctx.businessId) throw new NotFoundError('Document', id);
  if (!['approved', 'review_required', 'extracted'].includes(source.status)) {
    throw new BusinessRuleError('Only extracted documents awaiting review can be approved.');
  }
  if (source.status !== 'approved') {
    const bytes = await new PrivateDocumentStorage(db).load(ctx.businessId, source.storagePath);
    if (bytes.length !== source.fileSize || contentHash(bytes) !== source.metadata.contentHash) {
      throw new StorageError('The original no longer matches its verified upload. Approval was not recorded.');
    }
  }
  const { error } = await db.rpc('promote_reviewed_document', {
    p_business_id: ctx.businessId, p_document_id: id, p_review: parsed.data,
  });
  if (error) {
    if (error.code === 'P0002') throw new NotFoundError('Document or reviewed counterparty', id);
    if (error.code === '23505') throw new ConflictError('This document or business record has already been promoted. Refresh before retrying.');
    if (error.code === '22023' || error.code === '23514') throw new BusinessRuleError('Reviewed values or document state do not support promotion.');
    throw error;
  }
  const found = await repository.findById(ctx.businessId, id);
  if (!found) throw new NotFoundError('Document', id);
  return found;
}
