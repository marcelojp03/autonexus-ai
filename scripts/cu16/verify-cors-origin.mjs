/**
 * CU16 upload verification from the documented web origin (http://127.0.0.1:4280).
 * A real page served at that origin performs the presigned PUT and the authorized GET against
 * AWS S3, so the bucket CORS decision is exercised exactly as the quick-start documents it.
 * Signed URLs are never printed. Only a synthetic 1x1 PNG is used.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { authorize } from '../../services/employees/scripts/local-pkce.mjs';

const apiOrigin = process.env.CU16_PUBLIC_ORIGIN || 'http://127.0.0.1:4286';
const pageOrigin = process.env.CU16_DOCUMENTED_ORIGIN || 'http://127.0.0.1:4280';
const accountFile = process.env.CU16_ACCOUNTS_FILE || 'output/stack/cu16-fresh-proof.accounts.private.json';
const accounts = JSON.parse(readFileSync(accountFile, 'utf8')).accounts;
const issuer = apiOrigin + '/identity/realms/autonexus';

const requireApp = createRequire(resolve('web/mf-employees/package.json'));
const { chromium } = requireApp(resolve('web/mf-employees/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright'));

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);
const checksum = createHash('sha256').update(png).digest('base64');

const report = { apiOrigin, pageOrigin, stages: [], consoleErrors: 0, pageErrors: 0, pass: false };
const pass = (name, ok) => { assert.ok(ok, name); report.stages.push({ name, status: 'PASS' }); };

const gql = async (bearer, query, variables = {}) => {
  const response = await fetch(apiOrigin + '/graphql', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  assert.equal(response.status, 200);
  return response.json();
};

const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><meta charset="utf-8"><title>CU16 origin check</title><p id="ready">origin</p>');
});

let browser;
try {
  await new Promise((done) => server.listen(Number(new URL(pageOrigin).port), '127.0.0.1', done));

  const token = (await authorize({ ...accounts.mechanicA, enabled: true }, false, {
    issuer,
    redirect: apiOrigin + '/auth/callback',
  })).access_token;

  const agenda = await gql(
    token,
    'query($from:Date,$to:Date){myAgenda(from:$from,to:$to,limit:50){items{assignmentId executionStatus}}}',
    { from: '2026-11-01', to: '2026-11-30' },
  );
  const items = agenda.data?.myAgenda?.items ?? [];
  pass('confirmed work available for the assigned mechanic', items.length > 0);

  let work = items.find((item) => item.executionStatus === 'in_progress') ?? items[0];
  let execution;
  if (work.executionStatus === 'not_started') {
    const started = await gql(
      token,
      'mutation($id:UUID!,$input:StartExecutionInput!){startExecution(assignmentId:$id,input:$input){execution{version}}}',
      { id: work.assignmentId, input: { operationId: randomUUID() } },
    );
    execution = started.data?.startExecution?.execution;
  } else {
    const current = await gql(token, 'query($id:UUID!){myExecution(assignmentId:$id){version}}', { id: work.assignmentId });
    execution = current.data?.myExecution;
  }

  const advance = await gql(
    token,
    'mutation($id:UUID!,$input:RecordAdvanceInput!){recordAdvance(assignmentId:$id,input:$input){advance{id}}}',
    {
      id: work.assignmentId,
      input: {
        operationId: randomUUID(),
        expectedVersion: execution.version,
        description: 'Verificación de CORS desde el origen documentado',
        minutesWorked: 3,
      },
    },
  );
  const advanceId = advance.data?.recordAdvance?.advance?.id;

  const requested = await gql(
    token,
    'mutation($id:UUID!,$advance:UUID!,$input:RequestEvidenceInput!){requestEvidence(assignmentId:$id,advanceId:$advance,input:$input){evidence{id state version} upload{url method headersJson expiresAt}}}',
    {
      id: work.assignmentId,
      advance: advanceId,
      input: {
        operationId: randomUUID(),
        fileName: 'synthetic-origin-4280.png',
        contentType: 'image/png',
        sizeBytes: png.length,
        checksumSha256: checksum,
      },
    },
  );
  const evidence = requested.data?.requestEvidence?.evidence;
  const upload = requested.data?.requestEvidence?.upload;
  pass('owner issued pending evidence for the documented-origin check', evidence?.state === 'pending');

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, timezoneId: 'America/La_Paz' });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', () => report.pageErrors++);

  await page.goto(pageOrigin, { waitUntil: 'domcontentloaded' });
  pass('page is served from the documented origin', page.url().startsWith(pageOrigin));

  const putOnce = await page.evaluate(async ({ url, headers, base64 }) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    try {
      const response = await fetch(url, { method: 'PUT', headers, body: bytes });
      return { status: response.status, ok: response.ok };
    } catch (error) { return { error: error.name }; }
  }, { url: upload.url, headers: JSON.parse(upload.headersJson), base64: png.toString('base64') });
  report.firstPut = putOnce;
  pass('presigned upload succeeds from http://127.0.0.1:4280', putOnce.ok === true);

  const overwrite = await page.evaluate(async ({ url, headers, base64 }) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    try {
      const response = await fetch(url, { method: 'PUT', headers, body: bytes });
      return { status: response.status, ok: response.ok };
    } catch (error) { return { error: error.name }; }
  }, { url: upload.url, headers: JSON.parse(upload.headersJson), base64: png.toString('base64') });
  report.overwrite = overwrite;
  pass('conditional write rejects the second PUT from the documented origin', overwrite.ok === false);

  const confirmed = await gql(
    token,
    'mutation($id:UUID!,$evidence:UUID!,$input:ConfirmEvidenceInput!){confirmEvidence(assignmentId:$id,evidenceId:$evidence,input:$input){evidence{state failureCode}}}',
    { id: work.assignmentId, evidence: evidence.id, input: { operationId: randomUUID(), expectedVersion: evidence.version } },
  );
  pass('owner confirmed the evidence uploaded from the documented origin', confirmed.data?.confirmEvidence?.evidence?.state === 'available');

  const link = await gql(
    token,
    'query($id:UUID!,$evidence:UUID!){myEvidenceDownload(assignmentId:$id,evidenceId:$evidence){url}}',
    { id: work.assignmentId, evidence: evidence.id },
  );
  const downloadUrl = link.data?.myEvidenceDownload?.url;
  const downloaded = await page.evaluate(async (url) => {
    const response = await fetch(url);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { status: response.status, length: bytes.length, etag: response.headers.get('etag') };
  }, downloadUrl);
  report.download = { status: downloaded.status, length: downloaded.length, etag: Boolean(downloaded.etag) };
  pass('authorized download readable from the documented origin', downloaded.status === 200 && downloaded.length === png.length);

  // The intentional 412 overwrite is the only expected console entry.
  const expected = /412|Precondition Failed/i;
  report.consoleErrors = consoleErrors.filter((text) => !expected.test(text)).length;
  report.expectedConsoleErrors = consoleErrors.length - report.consoleErrors;
  report.pass = report.consoleErrors === 0 && report.pageErrors === 0;
} catch (error) {
  report.errorName = error?.name || 'Error';
  report.errorMessage = error?.message;
  throw error;
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
  writeFileSync('output/stack/cu16-cors-origin-result.json', JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ pass: report.pass, stages: report.stages.length }));
