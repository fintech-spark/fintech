import 'server-only';
import { z } from 'zod';
import { PayloadTooLargeError, ValidationError } from '@/lib/errors';
import { MAX_UPLOAD_BYTES } from '../infrastructure/private-storage';

const fieldsSchema = z.object({ sourceType: z.enum(['invoice', 'receipt']) }).strict();
export const MAX_MULTIPART_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;

/** Bound the stream BEFORE Request.formData() allocates/parses the multipart body. */
export async function parseDocumentUpload(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data;')) {
    throw new ValidationError('Send one file and sourceType as multipart/form-data.');
  }
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_MULTIPART_BYTES)) {
    throw new PayloadTooLargeError('Upload exceeds the 4MB file limit.');
  }
  if (!request.body) throw new ValidationError('Upload body is required.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_MULTIPART_BYTES) {
        await reader.cancel();
        throw new PayloadTooLargeError('Upload exceeds the 4MB file limit.');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  let form: FormData;
  try {
    form = await new Response(Buffer.concat(chunks), { headers: {
      'content-type': request.headers.get('content-type')!,
    } }).formData();
  } catch {
    throw new ValidationError('Malformed multipart upload.');
  }
  if (Array.from(form.keys()).some((key) => key !== 'file' && key !== 'sourceType') ||
      form.getAll('file').length !== 1 || form.getAll('sourceType').length !== 1) {
    throw new ValidationError('Send exactly one file and one sourceType; no storage or tenant fields.');
  }
  const fields = fieldsSchema.safeParse({ sourceType: form.get('sourceType') });
  const file = form.get('file');
  if (!fields.success || !(file instanceof File)) throw new ValidationError('A file and invoice or receipt sourceType are required.');
  if (file.size > MAX_UPLOAD_BYTES) throw new PayloadTooLargeError('Upload exceeds the 4MB file limit.');
  return { fileName: file.name, mimeType: file.type, fileSize: file.size,
    sourceType: fields.data.sourceType, fileData: Buffer.from(await file.arrayBuffer()) };
}
