/**
 * CU16 real evidence verification against the authorized private S3 bucket.
 * Uses real Keycloak identities, the BFF GraphQL surface and the owner REST API.
 * Never prints credentials, tokens or signed URLs.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { authorize } from '../../services/employees/scripts/local-pkce.mjs';

const origin = process.env.CU16_PUBLIC_ORIGIN || 'http://127.0.0.1:4286';
const accountFile = process.env.CU16_ACCOUNTS_FILE || 'output/stack/cu16-fresh-proof.accounts.private.json';
const accounts = JSON.parse(readFileSync(accountFile, 'utf8')).accounts;
const issuer = origin + '/identity/realms/autonexus';
const result = { origin, checks: [], pass: false, objects: [] };
const check = (name, ok) => { assert.ok(ok, name); result.checks.push({ name, status: 'PASS' }); };

const token = async (key) =>
  (await authorize({ ...accounts[key], enabled: true }, false, { issuer, redirect: origin + '/auth/callback' })).access_token;

const gql = async (bearer, query, variables = {}) => {
  const response = await fetch(origin + '/graphql', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  assert.equal(response.status, 200);
  return response.json();
};
const code = (response, root) =>
  response.errors?.find((error) => error.path?.[0] === root)?.extensions?.code ??
  (response.errors?.length === 1 ? response.errors[0].extensions?.code : undefined);

/** Smallest valid 1x1 PNG so the owner's real signature validation accepts it. */
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);
const checksum = createHash('sha256').update(png).digest('base64');
const objectKeyFrom = (url) => decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));

try {
  const a = await token('mechanicA');
  const b = await token('mechanicB');

  const perms = await gql(a, '{securityCatalog{effective}}');
  check('mechanic holds executions:write', perms.data?.securityCatalog?.effective?.includes('executions:write'));

  const agenda = await gql(
    a,
    'query($from:Date,$to:Date){myAgenda(from:$from,to:$to,limit:50){items{assignmentId orderNumber executionStatus}}}',
    { from: '2026-11-01', to: '2026-11-30' },
  );
  const items = agenda.data?.myAgenda?.items ?? [];
  check('confirmed work is visible for the assigned mechanic', items.length > 0);

  let work = items.find((item) => item.executionStatus === 'in_progress') ?? items[0];
  let execution;
  if (work.executionStatus === 'not_started') {
    const started = await gql(
      a,
      'mutation($id:UUID!,$input:StartExecutionInput!){startExecution(assignmentId:$id,input:$input){execution{version advances{id}} replayed}}',
      { id: work.assignmentId, input: { operationId: randomUUID() } },
    );
    execution = started.data?.startExecution?.execution;
  } else {
    const current = await gql(a, 'query($id:UUID!){myExecution(assignmentId:$id){version advances{id}}}', {
      id: work.assignmentId,
    });
    execution = current.data?.myExecution;
  }
  check('execution is in progress', execution?.version >= 1);

  const advance = await gql(
    a,
    'mutation($id:UUID!,$input:RecordAdvanceInput!){recordAdvance(assignmentId:$id,input:$input){execution{version} advance{id} replayed}}',
    {
      id: work.assignmentId,
      input: {
        operationId: randomUUID(),
        expectedVersion: execution.version,
        description: 'Verificación real de evidencia S3 (sintética)',
        minutesWorked: 5,
      },
    },
  );
  const advanceId = advance.data?.recordAdvance?.advance?.id;
  check('synthetic advance recorded', Boolean(advanceId));

  const requested = await gql(
    a,
    'mutation($id:UUID!,$advance:UUID!,$input:RequestEvidenceInput!){requestEvidence(assignmentId:$id,advanceId:$advance,input:$input){evidence{id state version sizeBytes} upload{url method headersJson expiresAt} replayed}}',
    {
      id: work.assignmentId,
      advance: advanceId,
      input: {
        operationId: randomUUID(),
        fileName: 'synthetic-evidence.png',
        contentType: 'image/png',
        sizeBytes: png.length,
        checksumSha256: checksum,
      },
    },
  );
  const requestedEvidence = requested.data?.requestEvidence;
  const upload = requestedEvidence?.upload;
  check('owner issued a pending evidence authorization', requestedEvidence?.evidence?.state === 'pending');
  check('authorization is a PUT with signed headers', upload?.method === 'PUT' && typeof upload?.headersJson === 'string');
  check('authorization did not expire yet', new Date(upload?.expiresAt).getTime() > Date.now());

  const key = objectKeyFrom(upload.url);
  result.objects.push({ key, bytes: png.length, role: 'confirmed' });
  const headers = JSON.parse(upload.headersJson);
  check('authorization carries conditional write and checksum', headers['If-None-Match'] === '*' && headers['x-amz-checksum-sha256'] === checksum);

  const put = await fetch(upload.url, { method: 'PUT', headers, body: png });
  check('presigned upload accepted the synthetic bytes', put.ok);

  const confirmed = await gql(
    a,
    'mutation($id:UUID!,$evidence:UUID!,$input:ConfirmEvidenceInput!){confirmEvidence(assignmentId:$id,evidenceId:$evidence,input:$input){evidence{id state failureCode} replayed}}',
    {
      id: work.assignmentId,
      evidence: requestedEvidence.evidence.id,
      input: { operationId: randomUUID(), expectedVersion: requestedEvidence.evidence.version },
    },
  );
  const confirmedEvidence = confirmed.data?.confirmEvidence?.evidence;
  check('owner confirmed evidence as available after verifying the object', confirmedEvidence?.state === 'available');

  const overwrite = await fetch(upload.url, { method: 'PUT', headers, body: png });
  check('conditional write rejects a second PUT on the same key', !overwrite.ok);

  const download = await gql(
    a,
    'query($id:UUID!,$evidence:UUID!){myEvidenceDownload(assignmentId:$id,evidenceId:$evidence){url expiresAt}}',
    { id: work.assignmentId, evidence: requestedEvidence.evidence.id },
  );
  const link = download.data?.myEvidenceDownload?.url;
  check('authorized download issue succeeded', typeof link === 'string' && link.startsWith('https://'));
  const fetched = await fetch(link);
  const downloaded = Buffer.from(await fetched.arrayBuffer());
  check('downloaded bytes match the uploaded bytes', fetched.ok && downloaded.equals(png));

  const foreignRead = await gql(b, 'query($id:UUID!){myExecution(assignmentId:$id){status}}', { id: work.assignmentId });
  check('another mechanic is denied by record scope', code(foreignRead, 'myExecution') === 'EXECUTION_WORK_NOT_FOUND');

  const foreignDownload = await gql(
    b,
    'query($id:UUID!,$evidence:UUID!){myEvidenceDownload(assignmentId:$id,evidenceId:$evidence){url}}',
    { id: work.assignmentId, evidence: requestedEvidence.evidence.id },
  );
  check('another mechanic cannot obtain a download authorization', Boolean(code(foreignDownload, 'myEvidenceDownload')));

  result.pass = true;
} catch (error) {
  result.errorName = error?.name || 'Error';
  result.errorMessage = error?.message;
  throw error;
} finally {
  writeFileSync('output/stack/cu16-evidence-real-result.json', JSON.stringify(result, null, 2));
}
console.log(JSON.stringify({ pass: result.pass, checks: result.checks.length, objects: result.objects }));
