import 'server-only';
import type {AIProviderAdapter} from './providers/types';
import {VercelAIProviderAdapter} from './providers/vercel-ai-adapter';
import {ProviderEmbeddingProvider} from '@/modules/rag';

/** Indexing and queries MUST use the identical configured embedding space. */
export function businessEmbeddingProvider(adapter: AIProviderAdapter) {
  const provider = adapter.provider === 'anthropic'
    ? new VercelAIProviderAdapter(process.env.OPENAI_API_KEY ? 'openai':'google') : adapter;
  return new ProviderEmbeddingProvider({provider,model:{provider:provider.provider,role:'embedding',modelId:''},maxAttempts:1});
}
