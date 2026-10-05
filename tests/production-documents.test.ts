import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { documentReviewSchema } from '@/modules/documents/domain/review';

const review = { kind: 'expense', reviewed: true, extractionId: randomUUID(), date: '2026-10-05',
  reference: 'SYNTHETIC-RECEIPT-1', currency: 'INR', category: 'supplies', description: 'Synthetic supplies',
  vendor: 'Synthetic Vendor', amountMinor: 12345 };
describe('review validation', () => {
  it('requires explicit complete reviewed values', () => { expect(documentReviewSchema.safeParse(review).success).toBe(true); });
  it.each([{ reviewed: false }, { amountMinor: 1.5 }, { amountMinor: -1 }, { amountMinor: 1e20 },
    { date: '2026-02-31' }, { businessId: randomUUID() }, { vendor: '' }])('rejects invalid review %o', (fields) => {
    expect(documentReviewSchema.safeParse({ ...review, ...fields }).success).toBe(false);
  });
  it('recomputes invoice line and header totals deterministically', () => {
    const invoice = { kind: 'invoice', reviewed: true, extractionId: randomUUID(), date: '2026-10-05',
      reference: 'SYN-INV', currency: 'INR', direction: 'purchase', counterpartyId: randomUUID(),
      items: [{ description: 'Synthetic widget', quantity: 2, unitPriceMinor: 1000, discountMinor: 100, taxMinor: 50, totalMinor: 1950 }], totalMinor: 1950 };
    expect(documentReviewSchema.safeParse(invoice).success).toBe(true);
    expect(documentReviewSchema.safeParse({ ...invoice, totalMinor: 2000 }).success).toBe(false);
    expect(documentReviewSchema.safeParse({ ...invoice, items: [{ ...invoice.items[0], quantity: 1.5 }] }).success).toBe(false);
  });
});

const local = process.env.LOCAL_DATABASE_URL;
const live = local ? describe : describe.skip;
live('local PostgreSQL document promotion — all changes rolled back', () => {
  let db: pg.Client;
  const biz = randomUUID(), otherBiz = randomUUID(), user = randomUUID(), staff = randomUUID();
  const doc = randomUUID(), otherDoc = randomUUID(), duplicate = randomUUID(), rollbackDoc = randomUUID();
  const extraction = randomUUID(), duplicateExtraction = randomUUID(), rollbackExtraction = randomUUID();
  const invoiceDoc = randomUUID(), invoiceExtraction = randomUUID(), supplier = randomUUID(), otherSupplier = randomUUID();
  beforeAll(async () => {
    if (!local || !['127.0.0.1','localhost'].includes(new URL(local).hostname)) throw new Error('Only a local synthetic database is allowed.');
    db = new pg.Client({ connectionString: local }); await db.connect(); await db.query('BEGIN');
    await db.query(await readFile(new URL('../supabase/migrations/20261005000020_document_promotion.sql', import.meta.url), 'utf8'));
    await db.query(await readFile(new URL('../supabase/migrations/20261005000024_document_source_retention.sql', import.meta.url), 'utf8'));
    await db.query(await readFile(new URL('../supabase/migrations/20261005000025_role_and_document_retention.sql', import.meta.url), 'utf8'));
    await db.query(await readFile(new URL('../supabase/migrations/20261005000026_document_context_index.sql', import.meta.url), 'utf8'));
    await db.query(await readFile(new URL('../supabase/migrations/20261005000027_line_permissions_and_index_recovery.sql', import.meta.url), 'utf8'));
    await db.query("INSERT INTO public.businesses(id,name,type) VALUES ($1,'Synthetic Document Test','retail'),($2,'Synthetic Other Test','retail')", [biz,otherBiz]);
    await db.query("INSERT INTO public.users(id,email,name) VALUES ($1,$2,'Synthetic reviewer'),($3,$4,'Synthetic staff')", [user,`${user}@example.invalid`,staff,`${staff}@example.invalid`]);
    await db.query("INSERT INTO public.business_members(business_id,user_id,role,status) VALUES ($1,$2,'owner','active'),($1,$3,'staff','active')", [biz,user,staff]);
    for (const [id,businessId,eid,hash] of [[doc,biz,extraction,'a'],[otherDoc,otherBiz,randomUUID(),'b'],[duplicate,biz,duplicateExtraction,'c'],[rollbackDoc,biz,rollbackExtraction,'d']]) {
      await db.query("INSERT INTO public.documents(id,business_id,source_type,file_name,mime_type,file_size,storage_path,status,content_hash,extraction_id,uploaded_by) VALUES ($1,$2,'receipt','synthetic.pdf','application/pdf',25,$3,'review_required',$4,$5,$6)", [id,businessId,`${businessId}/${user}/${id}.pdf`,hash.repeat(64),eid,user]);
      await db.query("INSERT INTO public.document_extractions(id,business_id,document_id,status,model_used) VALUES ($1,$2,$3,'completed','synthetic-provider')", [eid,businessId,id]);
    }
    await db.query("INSERT INTO public.suppliers(id,business_id,name) VALUES ($1,$2,'Synthetic supplier'),($3,$4,'Synthetic other supplier')",[supplier,biz,otherSupplier,otherBiz]);
    await db.query("INSERT INTO public.documents(id,business_id,source_type,file_name,mime_type,file_size,storage_path,status,content_hash,extraction_id,uploaded_by) VALUES ($1,$2,'invoice','synthetic.pdf','application/pdf',25,$3,'review_required',$4,$5,$6)",[invoiceDoc,biz,`${biz}/${user}/${invoiceDoc}.pdf`,'e'.repeat(64),invoiceExtraction,user]);
    await db.query("INSERT INTO public.document_extractions(id,business_id,document_id,status,model_used) VALUES ($1,$2,$3,'completed','synthetic-provider')",[invoiceExtraction,biz,invoiceDoc]);
  });
  afterAll(async () => { if (db) { await db.query('ROLLBACK'); await db.end(); } });
  async function asUser<T>(who: string, fn: () => Promise<T>) {
    await db.query('SAVEPOINT test_call');
    try {
      await db.query('SET LOCAL ROLE authenticated');
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [who]);
      const result = await fn(); await db.query('RESET ROLE'); await db.query('RELEASE SAVEPOINT test_call'); return result;
    } catch (error) {
      await db.query('ROLLBACK TO SAVEPOINT test_call'); await db.query('RELEASE SAVEPOINT test_call'); throw error;
    }
  }
  const promote = (businessId: string, documentId: string, values: object) => db.query('SELECT public.promote_reviewed_document($1,$2,$3::jsonb) AS result', [businessId,documentId,JSON.stringify(values)]);
  it('denies unauthorized tenant, staff and cross-tenant document ids in the database', async () => {
    await expect(asUser(user, () => promote(otherBiz,otherDoc,review))).rejects.toMatchObject({ code: '42501' });
    await expect(asUser(staff, () => promote(biz,doc,review))).rejects.toMatchObject({ code: '42501' });
    await expect(asUser(user, () => promote(biz,otherDoc,review))).rejects.toMatchObject({ code: 'P0002' });
  });
  it('atomically writes reviewed amount, source linkage, candidate state and audit; replay writes nothing twice', async () => {
    const values = { ...review, extractionId: extraction };
    const first = await asUser(user, () => promote(biz,doc,values));
    const second = await asUser(user, () => promote(biz,doc,values));
    expect(second.rows[0].result).toMatchObject({ resourceId: first.rows[0].result.resourceId, replayed: true });
    const expense = await db.query('SELECT amount_minor,status,source_document_id,created_by FROM public.expenses WHERE business_id=$1 AND source_document_id=$2', [biz,doc]);
    expect(expense.rows).toEqual([{ amount_minor:'12345',status:'approved',source_document_id:doc,created_by:user }]);
    expect((await db.query("SELECT count(*) FROM public.audit_logs WHERE business_id=$1 AND resource_id=$2 AND action='approve'",[biz,doc])).rows[0].count).toBe('1');
    expect((await db.query('SELECT status FROM public.document_extractions WHERE business_id=$1 AND id=$2',[biz,extraction])).rows[0].status).toBe('validated');
    await expect(asUser(user, () => promote(biz,doc,{ ...values, amountMinor: 54321 }))).rejects.toMatchObject({ code:'23505' });
  });
  it('rejects duplicate financial references across different uploaded files', async () => {
    await expect(asUser(user, () => promote(biz,duplicate,{ ...review, extractionId: duplicateExtraction }))).rejects.toMatchObject({ code:'23505' });
    expect((await db.query('SELECT status FROM public.documents WHERE business_id=$1 AND id=$2',[biz,duplicate])).rows[0].status).toBe('review_required');
  });
  it('rolls ledger, candidate and document back when audit persistence fails', async () => {
    await db.query("CREATE FUNCTION pg_temp.reject_synthetic_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$");
    await db.query('CREATE TRIGGER document_test_audit_failure BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_synthetic_audit()');
    await expect(asUser(user, () => promote(biz,rollbackDoc,{ ...review, extractionId: rollbackExtraction, reference:'SYN-ROLLBACK' }))).rejects.toThrow('synthetic audit failure');
    await db.query('DROP TRIGGER document_test_audit_failure ON public.audit_logs');
    expect((await db.query('SELECT count(*) FROM public.expenses WHERE business_id=$1 AND source_document_id=$2',[biz,rollbackDoc])).rows[0].count).toBe('0');
    expect((await db.query('SELECT status FROM public.documents WHERE business_id=$1 AND id=$2',[biz,rollbackDoc])).rows[0].status).toBe('review_required');
    expect((await db.query('SELECT status FROM public.document_extractions WHERE business_id=$1 AND id=$2',[biz,rollbackExtraction])).rows[0].status).toBe('completed');
  });
  it('blocks direct approval/provenance forgery by authenticated callers', async () => {
    await expect(asUser(user, () => db.query("UPDATE public.documents SET status='approved' WHERE business_id=$1 AND id=$2",[biz,duplicate]))).rejects.toMatchObject({ code:'42501' });
  });
  it('validates invoice arithmetic and tenant counterparty, then persists deterministic header and lines without claiming payment', async () => {
    const values = { kind:'invoice',reviewed:true,extractionId:invoiceExtraction,date:'2026-10-05',reference:'SYN-INVOICE-1',currency:'INR',direction:'purchase',counterpartyId:supplier,
      items:[{description:'Synthetic widget',quantity:2,unitPriceMinor:1000,discountMinor:100,taxMinor:50,totalMinor:1950}],totalMinor:1950 };
    await expect(asUser(user, () => promote(biz,invoiceDoc,{ ...values,counterpartyId:otherSupplier }))).rejects.toMatchObject({code:'P0002'});
    await expect(asUser(user, () => promote(biz,invoiceDoc,{ ...values,totalMinor:2000 }))).rejects.toMatchObject({code:'22023'});
    const result = await asUser(user, () => promote(biz,invoiceDoc,values)); const tx = result.rows[0].result.resourceId;
    const header = await db.query('SELECT status,total_minor,subtotal_minor,discount_minor,tax_minor,payment_method FROM public.transactions WHERE business_id=$1 AND id=$2',[biz,tx]);
    expect(header.rows[0]).toEqual({status:'confirmed',total_minor:'1950',subtotal_minor:'2000',discount_minor:'100',tax_minor:'50',payment_method:null});
    expect((await db.query('SELECT quantity,total_minor FROM public.transaction_items WHERE transaction_id=$1',[tx])).rows).toEqual([{quantity:'2.000',total_minor:'1950'}]);
  });
  it('rejects content-identical documents and immutable source linkage changes', async () => {
    await expect(asUser(user, () => db.query('UPDATE public.documents SET content_hash=$1 WHERE business_id=$2 AND id=$3',['a'.repeat(64),biz,duplicate]))).rejects.toMatchObject({code:'42501'});
    await expect(asUser(user, () => db.query('UPDATE public.expenses SET source_document_id=$1 WHERE business_id=$2 AND source_document_id=$3',[duplicate,biz,doc]))).rejects.toMatchObject({code:'42501'});
  });
  it('claims processing once, persists a tenant-scoped candidate and source id atomically', async () => {
    const pendingDoc = randomUUID(); const pendingExtraction = randomUUID();
    await db.query("INSERT INTO public.documents(id,business_id,source_type,file_name,mime_type,file_size,storage_path,status,content_hash,uploaded_by) VALUES ($1,$2,'receipt','synthetic.pdf','application/pdf',25,$3,'queued',$4,$5)",[pendingDoc,biz,`${biz}/${user}/${pendingDoc}.pdf`,'f'.repeat(64),user]);
    const claim = () => db.query('SELECT public.claim_document_extraction($1,$2) AS claimed',[biz,pendingDoc]);
    expect((await asUser(user,claim)).rows[0].claimed).toBe(true); expect((await asUser(user,claim)).rows[0].claimed).toBe(false);
    const candidate = {id:pendingExtraction,fields:[{name:'amount',value:{amountMinor:12345,currency:'INR'},type:'money',confidence:'low'}],evidence:[],overall_confidence:'low',model_used:'synthetic-provider'};
    await asUser(user,() => db.query('SELECT public.persist_document_extraction($1,$2,$3::jsonb)',[biz,pendingDoc,JSON.stringify(candidate)]));
    expect((await db.query('SELECT extraction_id FROM public.documents WHERE business_id=$1 AND id=$2',[biz,pendingDoc])).rows[0].extraction_id).toBe(pendingExtraction);
    expect((await db.query('SELECT count(*) FROM public.expenses WHERE business_id=$1 AND source_document_id=$2',[biz,pendingDoc])).rows[0].count).toBe('0');
    await db.query("UPDATE public.documents SET status='review_required' WHERE business_id=$1 AND id=$2",[biz,pendingDoc]);
    expect((await db.query('SELECT state FROM public.ingestion_jobs WHERE business_id=$1 AND document_id=$2',[biz,pendingDoc])).rows[0].state).toBe('review');
    await db.query("INSERT INTO public.ingestion_jobs(business_id,document_id,state,source_type,created_by) SELECT $1,$2,'failed','receipt',$3 FROM generate_series(1,19)",[biz,pendingDoc,user]);
    await expect(asUser(user,claim)).rejects.toMatchObject({code:'P0001'});
  });
  it('makes registered private sources immutable while permitting cleanup of unregistered orphans', async () => {
    const source = `${biz}/${user}/${doc}.pdf`, orphan = `${biz}/${user}/${randomUUID()}.pdf`;
    // Policy-only metadata fixtures: no actual Storage API object is created or deleted.
    await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES ('merchant-files',$1),('merchant-files',$2)",[source,orphan]);
    const changed = await asUser(user, () => db.query("UPDATE storage.objects SET name=name||'.changed' WHERE bucket_id='merchant-files' AND name=$1 RETURNING id",[source]));
    expect(changed.rowCount).toBe(0);
    // Emulate the Storage service's verified transaction-local guard for these
    // metadata-only fixtures; the entire test transaction is rolled back.
    await db.query("SELECT set_config('storage.allow_delete_query','true',true)");
    expect((await asUser(user, () => db.query("DELETE FROM storage.objects WHERE bucket_id='merchant-files' AND name=$1 RETURNING id",[source]))).rowCount).toBe(0);
    expect((await asUser(user, () => db.query("DELETE FROM storage.objects WHERE bucket_id='merchant-files' AND name=$1 RETURNING id",[orphan]))).rowCount).toBe(1);
  });
  it('blocks staff from stripping reviewed provenance or detaching the original source', async () => {
    expect((await asUser(staff, () => db.query("UPDATE public.documents SET status='failed',reviewed_values=NULL,reviewed_by=NULL,reviewed_at=NULL,promoted_resource_type=NULL,promoted_resource_id=NULL WHERE business_id=$1 AND id=$2",[biz,doc]))).rowCount).toBe(0);
    expect((await asUser(staff, () => db.query("UPDATE public.documents SET storage_path=$3 WHERE business_id=$1 AND id=$2",[biz,duplicate,`${biz}/detached.pdf`]))).rowCount).toBe(0);
    await expect(asUser(user, () => db.query("UPDATE public.documents SET storage_path=$3 WHERE business_id=$1 AND id=$2",[biz,duplicate,`${biz}/detached.pdf`]))).rejects.toMatchObject({code:'42501'});
    expect((await db.query('SELECT status,promoted_resource_id FROM public.documents WHERE business_id=$1 AND id=$2',[biz,doc])).rows[0]).toMatchObject({status:'approved',promoted_resource_id:expect.any(String)});
    await expect(asUser(staff,() => db.query('DELETE FROM public.documents WHERE business_id=$1 AND id=$2',[biz,duplicate]))).rejects.toMatchObject({code:'42501'});
    expect((await asUser(staff,() => db.query("UPDATE public.expenses SET amount_minor=1 WHERE business_id=$1 RETURNING id",[biz]))).rowCount).toBe(0);
  });
  it('allows indexing recovery after approval without altering reviewed provenance',async () => {
    const before=(await db.query('SELECT reviewed_values,promoted_resource_id,storage_path FROM public.documents WHERE business_id=$1 AND id=$2',[biz,doc])).rows[0];
    await expect(asUser(staff,() => db.query('SELECT public.record_document_index($1,$2,$3)',[biz,doc,'failed']))).rejects.toMatchObject({code:'42501'});
    await expect(asUser(user,() => db.query('SELECT public.record_document_index($1,$2,$3)',[otherBiz,otherDoc,'failed']))).rejects.toMatchObject({code:'42501'});
    await expect(asUser(user,() => db.query('SELECT public.record_document_index($1,$2,$3)',[biz,doc,'indexed']))).rejects.toMatchObject({code:'23514'});
    await asUser(user,() => db.query('SELECT public.record_document_index($1,$2,$3)',[biz,doc,'failed']));
    expect((await db.query('SELECT reviewed_values,promoted_resource_id,storage_path FROM public.documents WHERE business_id=$1 AND id=$2',[biz,doc])).rows[0]).toEqual(before);
    expect((await db.query('SELECT status,rag_indexing_status FROM public.documents WHERE business_id=$1 AND id=$2',[biz,doc])).rows[0]).toEqual({status:'approved',rag_indexing_status:'failed'});
  });
});
