import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BusinessId } from '@/lib/types';
import { AuthorizationError, StorageError } from '@/lib/errors';
import { isOwnTenantStoragePath } from '../domain/rules';

export const DOCUMENT_BUCKET = 'merchant-files';
// Bounded synchronous uploads fit a standard route request, including multipart overhead.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export function contentHash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export class PrivateDocumentStorage {
  constructor(private readonly db: SupabaseClient) {}

  private path(businessId: BusinessId, path: string) {
    if (!isOwnTenantStoragePath(path, businessId)) {
      throw new AuthorizationError('Invalid business storage path.');
    }
    return this.db.storage.from(DOCUMENT_BUCKET);
  }

  async upload(businessId: BusinessId, path: string, bytes: Buffer, mimeType: string): Promise<void> {
    const { error } = await this.path(businessId, path).upload(path, bytes, {
      contentType: mimeType, upsert: false,
    });
    if (error) throw new StorageError('Private file upload failed.');
  }

  async load(businessId: BusinessId, path: string): Promise<Buffer> {
    const { data, error } = await this.path(businessId, path).download(path, {}, { signal: AbortSignal.timeout(20_000) });
    if (error || !data) throw new StorageError('Private file could not be read.');
    if (data.size === 0 || data.size > MAX_UPLOAD_BYTES) throw new StorageError('Stored file size is unsupported.');
    return Buffer.from(await data.arrayBuffer());
  }

  async remove(businessId: BusinessId, path: string): Promise<void> {
    const { data, error } = await this.path(businessId, path).remove([path]);
    if (error || !data?.length) throw new StorageError('Private file cleanup could not be confirmed.');
  }

  async signedSource(businessId: BusinessId, path: string): Promise<string> {
    const { data, error } = await this.path(businessId, path).createSignedUrl(path, 60);
    if (error || !data?.signedUrl) throw new StorageError('Private source could not be opened.');
    return data.signedUrl;
  }
}
