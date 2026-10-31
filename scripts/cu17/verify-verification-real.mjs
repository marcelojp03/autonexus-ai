/**
 * CU17 real verification through the BFF: mandatory checklist, review request, self-approval
 * refusal, return with reason, idempotent replay, concurrent decisions, order/execution
 * consistency and history separation. Uses real Keycloak identities and the live stack.
 * Never prints tokens or signed URLs.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { authorize } from '../../services/employees/scripts/local-pkce.mjs';

const origin = process.env.CU16_PUBLIC_ORIGIN || 'http://127.0.0.1:4286';
const accountsFile = process.env.CU16_ACCOUNTS_FILE || 'output/stack/cu16-fresh-proof.accounts.private.json';
const accounts = JSON.parse(readFileSync(accountsFile, 'utf8')).accounts;
const issuer = origin + '/identity/realms/autonexus';

const report = { origin, checks: [], pass: false };
const check = (name, ok) => { assert.ok(ok, name); report.checks.push({ name, status: 'PASS' }); };
const code = (response, root) =>
  response.errors?.find((error) => error.path?.[0] === root)?.extensions?.code ??
  (response.errors?.length === 1 ? response.errors[0].extensions?.code : undefined);

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

const VERIFICATION_FIELDS = `execution{status version} checklist{id state version} reviews{action reason}
  mandatoryPending availableEvidence`;
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);
const checksum = createHash('sha256').update(png).digest('base64');

try {
  const mechanicKey = process.env.CU17_MECHANIC || 'mechanicA';
  const mechanic = await token(mechanicKey);
  const chief = await token('chief');

  const agenda = await gql(
    mechanic,
    'query($from:Date,$to:Date){myAgenda(from:$from,to:$to,limit:50){items{assignmentId executionStatus executionProgress{advances availableEvidence}}}}',
    { from: '2026-11-01', to: '2026-11-30' },
  );
  const items = agenda.data?.myAgenda?.items ?? [];
  const work = items.find((item) => item.executionStatus === 'in_progress') ?? items.find((item) => item.executionStatus === 'not_started');
  check('there is a work in progress assigned to the mechanic', Boolean(work));

  let version = (await gql(mechanic, 'query($id:UUID!){myExecution(assignmentId:$id){version}}', { id: work.assignmentId }))
    .data?.myExecution?.version;
  if (!work.executionProgress.advances) {
    const advance = await gql(
      mechanic,
      'mutation($id:UUID!,$input:RecordAdvanceInput!){recordAdvance(assignmentId:$id,input:$input){execution{version}}}',
      { id: work.assignmentId, input: { operationId: randomUUID(), expectedVersion: version, description: 'Verificación CU17', minutesWorked: 5 } },
    );
    version = advance.data?.recordAdvance?.execution?.version;
  }
  if (!work.executionProgress.availableEvidence) {
    const advanceId = (await gql(mechanic, 'query($id:UUID!){myExecution(assignmentId:$id){advances{id}}}', { id: work.assignmentId }))
      .data?.myExecution?.advances?.at(-1)?.id;
    const requested = await gql(
      mechanic,
      'mutation($id:UUID!,$advance:UUID!,$input:RequestEvidenceInput!){requestEvidence(assignmentId:$id,advanceId:$advance,input:$input){evidence{id version} upload{url headersJson}}}',
      {
        id: work.assignmentId,
        advance: advanceId,
        input: { operationId: randomUUID(), fileName: 'cu17.png', contentType: 'image/png', sizeBytes: png.length, checksumSha256: checksum },
      },
    );
    const issued = requested.data?.requestEvidence;
    const put = await fetch(issued.upload.url, { method: 'PUT', headers: JSON.parse(issued.upload.headersJson), body: png });
    check('synthetic evidence uploaded for the verification run', put.ok);
    const confirmed = await gql(
      mechanic,
      'mutation($id:UUID!,$evidence:UUID!,$input:ConfirmEvidenceInput!){confirmEvidence(assignmentId:$id,evidenceId:$evidence,input:$input){evidence{state}}}',
      { id: work.assignmentId, evidence: issued.evidence.id, input: { operationId: randomUUID(), expectedVersion: issued.evidence.version } },
    );
    check('evidence confirmed as available', confirmed.data?.confirmEvidence?.evidence?.state === 'available');
  }

  let view = (await gql(mechanic, `query($id:UUID!){myVerification(assignmentId:$id){${VERIFICATION_FIELDS}}}`, { id: work.assignmentId }))
    .data?.myVerification;
  if (view.execution.status === 'pending_verification') {
    const reset = await gql(
      chief,
      `mutation($id:UUID!,$input:ReturnInput!){returnExecution(assignmentId:$id,input:$input){${VERIFICATION_FIELDS}}}`,
      { id: work.assignmentId, input: { operationId: randomUUID(), expectedVersion: view.execution.version, reason: 'Reinicio de la verificación automatizada' } },
    );
    assert.equal(code(reset), undefined, 'the head can return a work left awaiting verification');
    view = (await gql(mechanic, `query($id:UUID!){myVerification(assignmentId:$id){${VERIFICATION_FIELDS}}}`, { id: work.assignmentId })).data.myVerification;
  }

  const pending = view.checklist.filter((item) => item.state === 'pending');
  if (pending.length) {
    const blocked = await gql(
      mechanic,
      'mutation($id:UUID!,$input:ReviewInput!){requestVerification(assignmentId:$id,input:$input){execution{status}}}',
      { id: work.assignmentId, input: { operationId: randomUUID(), expectedVersion: view.execution.version } },
    );
    check('review is refused while a mandatory activity is pending', code(blocked, 'requestVerification') === 'CHECKLIST_INCOMPLETE');
  }

  for (const item of view.checklist.filter((entry) => entry.state === 'pending')) {
    const marked = await gql(
      mechanic,
      `mutation($id:UUID!,$item:UUID!,$input:ActivityInput!){completeActivity(assignmentId:$id,itemId:$item,input:$input){${VERIFICATION_FIELDS}}}`,
      { id: work.assignmentId, item: item.id, input: { operationId: randomUUID(), expectedVersion: item.version } },
    );
    assert.equal(code(marked), undefined, 'activity must be ticked');
    view = marked.data.completeActivity;
  }
  check('every mandatory activity is explicitly done', view.mandatoryPending === 0);

  const requestOperation = randomUUID();
  const requestBody = { operationId: requestOperation, expectedVersion: view.execution.version };
  const requested = await gql(
    mechanic,
    `mutation($id:UUID!,$input:ReviewInput!){requestVerification(assignmentId:$id,input:$input){${VERIFICATION_FIELDS}}}`,
    { id: work.assignmentId, input: requestBody },
  );
  view = requested.data?.requestVerification;
  check('mechanic requests review and the execution awaits verification', view?.execution?.status === 'pending_verification');

  const replay = await gql(
    mechanic,
    'mutation($id:UUID!,$input:ReviewInput!){requestVerification(assignmentId:$id,input:$input){execution{status version}}}',
    { id: work.assignmentId, input: requestBody },
  );
  check('repeating the review request is an idempotent replay', replay.data?.requestVerification?.execution?.version === view.execution.version);

  const selfApproval = await gql(
    mechanic,
    'mutation($id:UUID!,$input:ReviewInput!){approveExecution(assignmentId:$id,input:$input){execution{status}}}',
    { id: work.assignmentId, input: { operationId: randomUUID(), expectedVersion: view.execution.version } },
  );
  // The BFF publishes a generic FORBIDDEN for any 403, exactly as it does for execution access.\n  check('a mechanic cannot approve their own work', ['FORBIDDEN', 'SELF_VERIFICATION_FORBIDDEN'].includes(code(selfApproval, 'approveExecution')));

  const stale = await gql(
    chief,
    'mutation($id:UUID!,$input:ReviewInput!){approveExecution(assignmentId:$id,input:$input){execution{status}}}',
    { id: work.assignmentId, input: { operationId: randomUUID(), expectedVersion: Math.max(1, view.execution.version - 1) } },
  );
  check('a stale version is rejected instead of closing twice', code(stale, 'approveExecution') === 'VERSION_CONFLICT');

  const returned = await gql(
    chief,
    `mutation($id:UUID!,$input:ReturnInput!){returnExecution(assignmentId:$id,input:$input){${VERIFICATION_FIELDS}}}`,
    { id: work.assignmentId, input: { operationId: randomUUID(), expectedVersion: view.execution.version, reason: 'Falta revisar la presión de neumáticos' } },
  );
  view = returned.data?.returnExecution;
  check('the head returns the work with a reason and it resumes', view?.execution?.status === 'in_progress');
  check('the return is recorded in the review trail', view.reviews.some((entry) => entry.action === 'returned' && entry.reason));

  const secondRequest = await gql(
    mechanic,
    `mutation($id:UUID!,$input:ReviewInput!){requestVerification(assignmentId:$id,input:$input){${VERIFICATION_FIELDS}}}`,
    { id: work.assignmentId, input: { operationId: randomUUID(), expectedVersion: view.execution.version } },
  );
  view = secondRequest.data?.requestVerification;
  check('the work can be submitted again after a return', view?.execution?.status === 'pending_verification');

  // Two concurrent approvals with the same expected version: only one closes the work.
  const approveBody = (operationId) => ({
    method: 'POST',
    headers: { Authorization: 'Bearer ' + chief, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'mutation($id:UUID!,$input:ReviewInput!){approveExecution(assignmentId:$id,input:$input){execution{status version}}}',
      variables: { id: work.assignmentId, input: { operationId, expectedVersion: view.execution.version } },
    }),
  });
  const [first, second] = await Promise.all([
    fetch(origin + '/graphql', approveBody(randomUUID())).then((r) => r.json()),
    fetch(origin + '/graphql', approveBody(randomUUID())).then((r) => r.json()),
  ]);
  const approved = [first, second].filter((response) => response.data?.approveExecution?.execution?.status === 'completed');
  // The loser of the race is rejected either by version or by the state it no longer matches.\n  const conflicts = [first, second].filter((response) => ['VERSION_CONFLICT', 'EXECUTION_STATE_CONFLICT'].includes(code(response, 'approveExecution')));
  check('concurrent approvals close the work exactly once', approved.length === 1 && conflicts.length === 1);

  const after = (await gql(chief, `query($id:UUID!){teamVerification(assignmentId:$id){${VERIFICATION_FIELDS}}}`, { id: work.assignmentId }))
    .data?.teamVerification;
  check('execution is completed after approval', after?.execution?.status === 'completed');
  check('the approval is recorded in the review trail', after.reviews.some((entry) => entry.action === 'approved'));

  const active = await gql(chief, 'query($from:Date,$to:Date){teamAgenda(from:$from,to:$to,limit:100){items{assignmentId}}}',
    { from: '2026-11-01', to: '2026-11-30' });
  check('completed work leaves the active agenda', !(active.data?.teamAgenda?.items ?? []).some((item) => item.assignmentId === work.assignmentId));

  const history = await gql(chief, 'query($from:Date,$to:Date){teamAgendaHistory(from:$from,to:$to,limit:100){items{assignmentId status}}}',
    { from: '2026-11-01', to: '2026-12-31' });
  const inHistory = (history.data?.teamAgendaHistory?.items ?? []).find((item) => item.assignmentId === work.assignmentId);
  check('the completed work is reachable in history with its status', inHistory?.status === 'completed');

  report.assignmentId = work.assignmentId;
  report.mechanic = mechanicKey;
  report.pass = true;
} catch (error) {
  report.errorName = error?.name || 'Error';
  report.errorMessage = error?.message;
  throw error;
} finally {
  writeFileSync('output/stack/cu17-verification-result.json', JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ pass: report.pass, checks: report.checks.length }));
