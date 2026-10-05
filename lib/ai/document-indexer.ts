import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AIProviderAdapter } from './providers/types';
import { VercelAIProviderAdapter } from './providers/vercel-ai-adapter';
import { getDatabaseClient } from '@/lib/database';
import type { DocumentId, TenantContext } from '@/lib/types';
import { assertPermission } from '@/lib/http/auth-context';
import { NotFoundError } from '@/lib/errors';
import { PostgrestExtractionRepository } from '@/modules/extraction';
import { PostgrestDocumentRepository } from '@/modules/documents/infrastructure/document-repository';
import { DefaultRAGService, PgChunkStore } from '@/modules/rag';
import {businessEmbeddingProvider} from './embedding';

/** Only actual cited source excerpts enter the unstructured index; candidate amounts never become facts. */
export async function indexDocumentContext(db: SupabaseClient,ctx: TenantContext,id: DocumentId,provider?: AIProviderAdapter) {
  assertPermission(ctx,'documents:write');
  const document = await new PostgrestDocumentRepository(db).findById(ctx.businessId,id);
  const candidate = await new PostgrestExtractionRepository(db).findByDocument(ctx.businessId,id);
  if (!document || !candidate || document.businessId !== ctx.businessId || candidate.businessId !== ctx.businessId || candidate.documentId !== id || !['review_required','extracted','approved'].includes(document.status)) throw new NotFoundError('Reviewable extraction',id);
  const content = candidate.evidence.flatMap((ref) => ref.excerpt?.trim() ? [ref.excerpt] : []).join('\n\n');
  let status: 'indexed' | 'insufficient_evidence' | 'failed' = content ? 'indexed' : 'insufficient_evidence';
  let count = 0;
  if (content) {
    try {
      const adapter = provider ?? new VercelAIProviderAdapter(process.env.AI_PROVIDER === 'openai' ? 'openai':process.env.AI_PROVIDER === 'anthropic' ? 'anthropic':'google');
      const embeddings = businessEmbeddingProvider(adapter);
      const rag = new DefaultRAGService({store:new PgChunkStore({database:getDatabaseClient()}),embeddings});
      const outcome = await rag.index(ctx,{documentId:id,content,sourceType:'document',documentSourceType:document.sourceType,fileName:document.fileName,sourceTimestamp:candidate.extractedAt.toISOString()});
      count = outcome.embeddedCount;
      if (outcome.failedCount || !count) status = 'failed';
    } catch { status = 'failed'; }
  }
  const {error} = await db.rpc('record_document_index',{p_business_id:ctx.businessId,p_document_id:id,p_status:status});
  if (error) throw error;
  return {status,chunkCount:count};
}
