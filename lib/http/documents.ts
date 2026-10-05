import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AIProviderAdapter } from '@/lib/ai/providers/types';
import { VercelAIProviderAdapter } from '@/lib/ai/providers/vercel-ai-adapter';
import { DefaultExtractionService, PostgrestExtractionRepository } from '@/modules/extraction';
import { AuthorizationError, RateLimitError, StorageError } from '@/lib/errors';
import { PostgrestDocumentRepository } from '@/modules/documents/infrastructure/document-repository';
import { PrivateDocumentStorage, contentHash } from '@/modules/documents/infrastructure/private-storage';
import { ProductionDocumentService } from '@/modules/documents/application/production-service';
import { indexDocumentContext } from '@/lib/ai/document-indexer';

/** Caller-JWT client only. Main may inject the existing provider adapter. */
export function wireProductionDocuments(db: SupabaseClient, provider?: AIProviderAdapter) {
  const repository = new PostgrestDocumentRepository(db);
  const storage = new PrivateDocumentStorage(db);
  const candidates = new PostgrestExtractionRepository(db);
  const adapter = () => provider ?? new VercelAIProviderAdapter(
    process.env.AI_PROVIDER === 'openai' ? 'openai' : process.env.AI_PROVIDER === 'anthropic' ? 'anthropic' : 'google',
  );
  // Resolve lazily: an unavailable provider must not prevent reading saved documents.
  const lazyProvider: AIProviderAdapter = {
    get provider() { return provider?.provider ?? (process.env.AI_PROVIDER === 'openai' ? 'openai' : process.env.AI_PROVIDER === 'anthropic' ? 'anthropic' : 'google'); },
    complete: (request) => adapter().complete(request), embed: (request) => adapter().embed(request),
  };
  const extraction = new DefaultExtractionService({
    provider: lazyProvider, repository: candidates,
    config: { model: { provider: lazyProvider.provider, modelId: '', role: 'multimodal', maxTokens: 8192 }, maxAttempts: 2 },
    documents: {
      findById: async (businessId, id) => repository.findById(businessId, id),
      updateStatus: async (businessId, id, status) => { await repository.setStatus(businessId, id, status,
        status === 'failed' ? 'Extraction failed. The file remains saved; retry extraction or contact support.' : undefined); },
      claimProcessing: async (businessId, id) => {
        const { data, error } = await db.rpc('claim_document_extraction', { p_business_id: businessId, p_document_id: id });
        if (error?.code === 'P0001') throw new RateLimitError('Extraction limit reached. Wait a minute before retrying.');
        if (error?.code === '42501') throw new AuthorizationError('Document processing access denied.');
        if (error) throw error;
        return data === true;
      },
    },
    content: { load: async (businessId, path) => {
      const bytes = await storage.load(businessId, path);
      const { data, error } = await db.from('documents').select('content_hash,file_size')
        .eq('business_id', businessId).eq('storage_path', path).single();
      if (error || !data || !data.content_hash || data.content_hash !== contentHash(bytes) || Number(data.file_size) !== bytes.length) {
        throw new StorageError('Stored file does not match verified upload metadata.');
      }
      return bytes;
    } },
  });
  return { documents: new ProductionDocumentService(repository, storage, extraction,(ctx,id) => indexDocumentContext(db,ctx,id,provider)), extraction, candidates };
}
