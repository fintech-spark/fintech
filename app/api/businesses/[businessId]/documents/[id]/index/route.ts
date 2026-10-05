import { withApi } from '@/lib/http/handler';
import { resolveTenantContext } from '@/lib/http/auth-context';
import { parseUuid,parseJsonBody } from '@/lib/http/params';
import {z} from 'zod';
import { asDocumentId } from '@/lib/types';
import { indexDocumentContext } from '@/lib/ai/document-indexer';
export const maxDuration = 60;
export const POST = withApi(async (request,route) => {
  const {ctx,db} = await resolveTenantContext(request,route.params.businessId);
  if (request.body) await parseJsonBody(request,z.object({}).strict());
  return {data:await indexDocumentContext(db,ctx,asDocumentId(parseUuid(route.params.id,'id')))};
});
