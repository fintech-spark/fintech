// Actual document Client Components in Chromium, isolated synthetic HTTP only.
// Does not start/stop Next, read .env, contact providers or touch merchant storage.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '../..');
const biz = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const extractionId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const document = { id, businessId: biz, sourceType: 'receipt', fileName: 'synthetic.pdf', mimeType: 'application/pdf',
  fileSize: 20, storagePath: `${biz}/synthetic.pdf`, status: 'review_required', metadata: { originalName: 'synthetic.pdf' },
  uploadedAt: '2026-10-05T00:00:00Z', uploadedBy: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
const entry = '\0document-browser-check.tsx';
const result = await build({ configFile: false, envDir: false, root, publicDir: false, logLevel: 'error',
  resolve: { alias: { '@': root } }, oxc: { jsx: { runtime: 'automatic', development:false } },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [{ name: 'synthetic-documents-only', enforce:'pre',
    resolveId(name) { if (name.endsWith('virtual:document-browser-check')) return entry; if (name === 'next/navigation') return '\0document-browser-navigation'; },
    load(name) {
      if (name === '\0document-browser-navigation') return 'export const useRouter = () => ({ push: path => { window.document.body.dataset.navigation = path }, refresh() {} });';
      if (name === entry) return `import { createRoot } from 'react-dom/client';
        import { DocumentUploadZone } from '@/components/documents/document-upload-zone';
        import { ReviewedDocumentForm } from '@/components/documents/reviewed-document-form';
        const fixture = ${JSON.stringify(document)};
        if (location.search.includes('failed')) fixture.status = 'failed';
        createRoot(window.document.getElementById('root')).render(<><DocumentUploadZone businessId={fixture.businessId}/><ReviewedDocumentForm businessId={fixture.businessId} document={fixture}/></>);`;
    },
  }], build: { write: false, minify: false, lib: { entry: 'virtual:document-browser-check', formats: ['iife'], name: 'SyntheticDocumentCheck' } },
});
const code = (Array.isArray(result) ? result[0] : result).output.find((item) => item.type === 'chunk').code;
let uploaded, reviewed, retried;
const server = http.createServer(async (request, response) => {
  if (request.url === '/bundle.js') { response.setHeader('Content-Type','text/javascript; charset=utf-8'); response.end(code); return; }
  if (!request.url.startsWith('/api/')) { response.setHeader('Content-Type','text/html; charset=utf-8'); response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Synthetic documents check</title></head><body><main id="root"></main><script src="/bundle.js"></script></body></html>'); return; }
  response.setHeader('Content-Type','application/json');
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  if (request.method === 'POST' && request.url.endsWith('/documents')) {
    uploaded = bytes; response.end(JSON.stringify({ data: { id,status:'review_required' } })); return;
  }
  if (request.url.endsWith('/approve')) {
    reviewed = JSON.parse(bytes); response.end(JSON.stringify({ data: { ...document,status:'approved' } })); return;
  }
  if (request.url.endsWith('/status')) {
    retried = JSON.parse(bytes); response.end(JSON.stringify({ data: { ...document,status:'review_required' } })); return;
  }
  response.end(JSON.stringify({ data: { ...document, extraction: { id: extractionId, overallConfidence:'low',
    fields:[{ name:'amount', value:{ amountMinor:99999,currency:'INR' }, confidence:'low' }],
    evidence:[{ field:'amount',excerpt:'Synthetic source excerpt; verify the actual original.' }] } } }));
});
await new Promise((resolve) => server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser = await chromium.launch({ headless:true }); const page = await browser.newPage();
  await page.addInitScript('window.process = { env: { NODE_ENV: "production" } };');
  const errors = []; page.on('pageerror',(error) => { errors.push(error.message); console.error('Synthetic browser error:',error.message); });
  const origin = `http://127.0.0.1:${server.address().port}`; await page.goto(origin);
  await expect(page.getByText('Saved AI candidates — confidence: low')).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({ name:'unsupported.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('synthetic unsupported') });
  await expect(page.getByRole('alert')).toContainText('Upload an invoice or receipt'); assert.equal(uploaded,undefined);
  await page.locator('input[type=file]').setInputFiles({name:'receipt.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7 synthetic bytes')});
  await page.getByRole('button',{name:'Confirm & Ingest'}).click();
  await expect(page.locator('body')).toHaveAttribute('data-navigation',`/documents/${id}`);
  assert(uploaded.includes(Buffer.from('%PDF-1.7 synthetic bytes'))); assert(!uploaded.includes(Buffer.from('storagePath')));
  await page.getByLabel('Record date',{exact:true}).fill('2026-10-05');
  await page.getByLabel('Invoice / receipt reference').fill('SYN-REVIEWED');
  await page.getByLabel('Currency',{exact:true}).selectOption('INR');
  await page.getByLabel('Vendor',{exact:true}).fill('Synthetic vendor');
  await page.getByLabel('Expense description').fill('Synthetic reviewed supplies');
  await page.getByLabel('Amount in minor units',{exact:true}).fill('12345');
  await page.getByLabel('Expense category').selectOption('supplies');
  await page.getByLabel('I reviewed and corrected every value').check();
  await page.getByRole('button',{name:'Approve reviewed values'}).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button',{name:'Confirm reviewed records'}).click();
  await expect(page.getByRole('status')).toContainText('Recorded state: approved');
  assert.equal(reviewed.amountMinor,12345); assert.equal(reviewed.reviewed,true); assert.equal(reviewed.extractionId,extractionId);
  assert.equal(reviewed.businessId,undefined); assert.equal(reviewed.storagePath,undefined);
  await page.goto(`${origin}/?failed`); await page.getByRole('button',{name:'Retry extraction'}).click();
  await expect(page.getByRole('status')).toContainText('Recorded state: review_required'); assert.deepEqual(retried,{status:'queued'});
  assert.deepEqual(errors,[]);
  console.log('PASS: Chromium upload bytes, unsupported-file rejection, corrected reviewed approval, failed-extraction retry; no browser runtime errors.');
} finally {
  await browser?.close(); await new Promise((resolve) => server.close(resolve));
}
