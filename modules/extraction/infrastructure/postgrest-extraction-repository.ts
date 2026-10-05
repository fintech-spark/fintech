import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BusinessId, DocumentId } from '@/lib/types';
import type { ExtractionResult } from '../domain/types';
import type { ExtractionRepository } from '../application/extraction-service';

const COLUMNS = 'id,business_id,document_id,status,fields,evidence,overall_confidence,model_used,extracted_at,validated_at';
interface Row {
  id: string; business_id: BusinessId; document_id: DocumentId; status: ExtractionResult['status'];
  fields: ExtractionResult['fields']; evidence: ExtractionResult['evidence'];
  overall_confidence: ExtractionResult['overallConfidence']; model_used: string;
  extracted_at: string; validated_at: string | null;
}
function map(row: Row): ExtractionResult {
  return { id: row.id, businessId: row.business_id, documentId: row.document_id, status: row.status,
    fields: row.fields, evidence: row.evidence, overallConfidence: row.overall_confidence,
    modelUsed: row.model_used, extractedAt: new Date(row.extracted_at),
    ...(row.validated_at ? { validatedAt: new Date(row.validated_at) } : {}) };
}

export class PostgrestExtractionRepository implements ExtractionRepository {
  constructor(private readonly db: SupabaseClient) {}
  async findByDocument(businessId: BusinessId, documentId: DocumentId) {
    const { data, error } = await this.db.from('document_extractions').select(COLUMNS)
      .eq('business_id', businessId).eq('document_id', documentId).order('extracted_at', { ascending: false }).limit(1);
    if (error) throw error;
    return data?.[0] ? map(data[0] as Row) : null;
  }
  async findById(businessId: BusinessId, id: string) {
    const { data, error } = await this.db.from('document_extractions').select(COLUMNS)
      .eq('business_id', businessId).eq('id', id).limit(1);
    if (error) throw error;
    return data?.[0] ? map(data[0] as Row) : null;
  }
  async save(result: ExtractionResult): Promise<ExtractionResult> {
    const { data, error } = await this.db.rpc('persist_document_extraction', {
      p_business_id: result.businessId, p_document_id: result.documentId,
      p_candidate: { id: result.id, fields: result.fields, evidence: result.evidence,
        overall_confidence: result.overallConfidence, model_used: result.modelUsed,
        raw_output: result.rawOutput ?? null },
    });
    if (error) throw error;
    return map(data as Row);
  }
}
