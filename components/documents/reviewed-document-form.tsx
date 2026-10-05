"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { documentReviewSchema } from '@/modules/documents/domain/review';
import type { DocumentReviewInput } from '@/modules/documents';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import type { WireDocument } from '@/lib/api/contracts';

interface Candidate {
  id: string; overallConfidence: string;
  fields: readonly { name: string; value: unknown; confidence: string }[];
  evidence: readonly { field?: string; excerpt?: string }[];
}
const categories = ['rent','utilities','salaries','supplies','marketing','transportation','insurance','maintenance','taxes','fees','other'];

export function ReviewedDocumentForm({ businessId, document }: { businessId: string; document: WireDocument }) {
  const router = useRouter();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [message, setMessage] = useState('Loading saved extraction…');
  const [pending, setPending] = useState(false);
  const [lines, setLines] = useState(1);
  const [direction, setDirection] = useState('');
  const [partners, setPartners] = useState<readonly { id: string; name: string }[]>([]);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [review, setReview] = useState<DocumentReviewInput | null>(null);
  const base = `/api/businesses/${businessId}/documents/${document.id}`;
  const expense = document.sourceType === 'receipt';
  useEffect(() => {
    const controller = new AbortController();
    fetch(base, { signal: controller.signal, cache: 'no-store' }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || 'Saved extraction could not be loaded.');
      setCandidate(body.data.extraction ?? null);
      setMessage(body.data.extraction ? '' : 'No saved extraction yet. A failed document can be retried.');
    }).catch((error: unknown) => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Extraction unavailable.'); });
    return () => controller.abort();
  }, [base]);
  useEffect(() => {
    if (!direction) return;
    const controller = new AbortController();
    fetch(`/api/businesses/${businessId}/${direction === 'sale' ? 'customers' : 'suppliers'}?limit=100`, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error('Business counterparties could not be loaded.');
        setPartners(body.data);
      }).catch(() => { if (!controller.signal.aborted) { setPartners([]); setMessage('Counterparties could not be loaded. Refresh to try again.'); } });
    return () => controller.abort();
  }, [businessId, direction]);

  async function mutate(path: string, method: string, values: unknown) {
    setPending(true); setMessage('');
    try {
      const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || 'The request could not be confirmed.');
      setMessage(`Recorded state: ${body.data.status}.`); router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? `${error.message} Check the real status before retrying.` : 'Outcome unknown. Check the real status before retrying.');
    } finally { setPending(false); }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!candidate) return;
    const form = new FormData(event.currentTarget);
    const str = (key: string) => String(form.get(key) ?? '');
    const num = (key: string) => str(key).trim() ? Number(str(key)) : NaN;
    const common = { reviewed: form.get('reviewed') === 'on', extractionId: candidate.id, date: str('date'), reference: str('reference'), currency: str('currency') };
    const values = expense ? { ...common, kind: 'expense', amountMinor: num('amountMinor'), category: str('category'), description: str('description'), vendor: str('vendor') }
      : { ...common, kind: 'invoice', direction: str('direction'), counterpartyId: str('counterpartyId'), totalMinor: num('totalMinor'),
        items: Array.from({ length: lines }, (_, i) => ({ description: str(`description-${i}`), quantity: num(`quantity-${i}`),
          unitPriceMinor: num(`unitPriceMinor-${i}`), discountMinor: num(`discountMinor-${i}`), taxMinor: num(`taxMinor-${i}`), totalMinor: num(`totalMinor-${i}`) })) };
    const parsed = documentReviewSchema.safeParse(values);
    if (!parsed.success) { setMessage(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' ')); return; }
    setReview(parsed.data);
  }
  async function openSource() {
    setPending(true);
    try {
      const response = await fetch(`${base}?source=1`, { cache: 'no-store' }); const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || 'Original file could not be opened.');
      setSourceUrl(body.data.sourceUrl);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Original file unavailable.'); }
    finally { setPending(false); }
  }
  return <div className="flex flex-col gap-4">
    <AlertDialog open={review !== null} onOpenChange={(open) => { if (!open) setReview(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Add reviewed values to your records?</AlertDialogTitle>
        <AlertDialogDescription>This creates an unpaid confirmed invoice or approved expense. Check all values against the original. No payment will be recorded.</AlertDialogDescription></AlertDialogHeader>
        {review && <pre className="max-h-64 max-w-full overflow-auto text-xs">{JSON.stringify(review,null,2)}</pre>}
        <AlertDialogFooter><AlertDialogCancel>Go back</AlertDialogCancel><AlertDialogAction disabled={pending} onClick={() => { if (review) void mutate(`${base}/approve`,'POST',review); }}>Confirm reviewed records</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {message ? <p role="status" className="text-sm">{message}</p> : null}
    {document.metadata.ragIndexingStatus && <p className="text-sm">Document context index: {document.metadata.ragIndexingStatus.replaceAll('_',' ')}. {document.metadata.ragIndexingError}</p>}
    {document.metadata.ragIndexingStatus === 'failed' && ['extracted','review_required','approved'].includes(document.status) && <Button variant="outline" disabled={pending} onClick={async () => {
      setPending(true);
      try {
        const response = await fetch(`${base}/index`,{method:'POST'}); const body = await response.json();
        if (!response.ok) throw new Error('Index retry could not be confirmed.');
        setMessage(`Document context index: ${body.data.status}.`); router.refresh();
      } catch {setMessage('Index retry could not be confirmed. Extraction remains saved.');}
      finally {setPending(false);}
    }}>Retry context indexing</Button>}
    <Button type="button" variant="outline" disabled={pending} onClick={openSource}>Open original file</Button>
    {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">View private original (link expires in 60 seconds)</a> : null}
    {document.status === 'failed' || document.status === 'processing' ? <Button disabled={pending} onClick={() => mutate(`${base}/status`, 'PATCH', { status: 'queued' })}>Retry extraction</Button> : null}
    {candidate ? <details open><summary>Saved AI candidates — confidence: {candidate.overallConfidence}</summary>
      <dl className="flex flex-col gap-2">{candidate.fields.map((field) => <div key={field.name}><dt className="font-medium">{field.name} ({field.confidence})</dt><dd className="break-words text-sm">{JSON.stringify(field.value)}</dd></div>)}</dl>
      {candidate.evidence.map((ref, i) => <p key={i} className="text-sm">{ref.field || 'Source'}: {ref.excerpt || 'No supporting excerpt supplied.'}</p>)}
    </details> : null}
    {candidate && ['extracted','review_required'].includes(document.status) ? <form onSubmit={submit}>
      <p className="mb-4 text-sm">Compare the original and candidates, then enter corrected values below. Money is in minor units (100 paise per rupee). Blank values are never guessed. Approval creates an unpaid confirmed invoice or approved expense; it does not record a payment.</p>
      <FieldGroup>
        <ReviewInput name="date" label="Record date" type="date" />
        <ReviewInput name="reference" label="Invoice / receipt reference" />
        <Field><FieldLabel htmlFor="review-currency">Currency</FieldLabel><select id="review-currency" name="currency" required defaultValue=""><option value="" disabled>Choose currency</option>{['INR','USD','EUR','GBP'].map((v) => <option key={v}>{v}</option>)}</select></Field>
        {expense ? <>
          <ReviewInput name="vendor" label="Vendor" /><ReviewInput name="description" label="Expense description" />
          <ReviewInput name="amountMinor" label="Amount in minor units" type="number" />
          <Field><FieldLabel htmlFor="review-category">Expense category</FieldLabel><select id="review-category" name="category" required defaultValue=""><option value="" disabled>Choose category</option>{categories.map((v) => <option key={v}>{v}</option>)}</select></Field>
        </> : <>
          <Field><FieldLabel htmlFor="review-direction">Invoice direction</FieldLabel><select id="review-direction" name="direction" required value={direction} onChange={(e) => { setPartners([]); setDirection(e.target.value); }}><option value="" disabled>Choose sale or purchase</option><option value="sale">Sale to customer</option><option value="purchase">Purchase from supplier</option></select></Field>
          <Field><FieldLabel htmlFor="review-counterparty">Existing customer / supplier</FieldLabel><select key={direction} id="review-counterparty" name="counterpartyId" required defaultValue=""><option value="" disabled>Choose an existing business counterparty</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><p className="text-sm">Add the customer or supplier first if absent. The list shows up to 100 records.</p></Field>
          {Array.from({ length: lines }, (_, i) => <fieldset key={i} className="flex flex-col gap-3"><legend>Reviewed line {i + 1}</legend>
            <ReviewInput name={`description-${i}`} label={`Line ${i + 1} description`} />
            {['quantity','unitPriceMinor','discountMinor','taxMinor','totalMinor'].map((name) => <ReviewInput key={name} name={`${name}-${i}`} label={`Line ${i + 1} ${name}`} type="number" />)}
          </fieldset>)}
          <Button type="button" variant="outline" disabled={lines >= 200 || pending} onClick={() => setLines((n) => n + 1)}>Add reviewed line</Button>
          {lines > 1 ? <Button type="button" variant="outline" onClick={() => setLines((n) => n - 1)}>Remove last line</Button> : null}
          <ReviewInput name="totalMinor" label="Invoice total in minor units" type="number" />
        </>}
        <Field><FieldLabel htmlFor="review-confirmed"><input id="review-confirmed" type="checkbox" name="reviewed" required /> I reviewed and corrected every value against the original. Add these values to my business records.</FieldLabel></Field>
        <Button type="submit" disabled={pending}>{pending ? 'Saving reviewed records…' : 'Approve reviewed values'}</Button>
      </FieldGroup>
    </form> : null}
  </div>;
}

function ReviewInput({ name, label, type = 'text' }: { name: string; label: string; type?: string }) {
  return <Field><FieldLabel htmlFor={`review-${name}`}>{label}</FieldLabel><Input id={`review-${name}`} name={name} type={type} required maxLength={500} min={type === 'number' ? 0 : undefined} step={type === 'number' ? 1 : undefined} /></Field>;
}
