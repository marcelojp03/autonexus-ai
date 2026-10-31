/**
 * CU17 post-condition audit: proves from persisted, authenticated state that a completed work
 * closed exactly once, that the order reached technical completion and that history keeps it
 * while the active agenda no longer lists it. Read-only: it never mutates business data.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { authorize } from '../../services/employees/scripts/local-pkce.mjs';

const origin = process.env.CU16_PUBLIC_ORIGIN || 'http://127.0.0.1:4286';
const accountsFile = process.env.CU16_ACCOUNTS_FILE || 'output/stack/cu16-fresh-proof.accounts.private.json';
const accounts = JSON.parse(readFileSync(accountsFile, 'utf8')).accounts;
const issuer = origin + '/identity/realms/autonexus';

const report = { origin, checks: [], pass: false };
const check = (name, ok) => { assert.ok(ok, name); report.checks.push({ name, status: 'PASS' }); };

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

try {
  const chief = await token('chief');

  const history = await gql(
    chief,
    'query($from:Date,$to:Date){teamAgendaHistory(from:$from,to:$to,limit:100){items{assignmentId orderId orderNumber status executionStatus}}}',
    { from: '2026-11-01', to: '2026-11-30' },
  );
  const completed = (history.data?.teamAgendaHistory?.items ?? []).filter((item) => item.status === 'completed');
  check('history exposes technically completed work', completed.length > 0);

  const target = completed[0];
  const active = await gql(
    chief,
    'query($from:Date,$to:Date){teamAgenda(from:$from,to:$to,limit:100){items{assignmentId}}}',
    { from: '2026-11-01', to: '2026-11-30' },
  );
  check('completed work is not listed in the active agenda',
    !(active.data?.teamAgenda?.items ?? []).some((item) => item.assignmentId === target.assignmentId));

  const verification = await gql(
    chief,
    'query($id:UUID!){teamVerification(assignmentId:$id){execution{status version} checklist{state} reviews{action reason} mandatoryPending}}',
    { id: target.assignmentId },
  );
  const view = verification.data?.teamVerification;
  check('execution is completed and readable from history', view?.execution?.status === 'completed');
  check('every mandatory activity stayed done', view?.mandatoryPending === 0);
  check('checklist keeps its completed activities', (view?.checklist ?? []).every((item) => item.state === 'done'));

  const approvals = (view?.reviews ?? []).filter((entry) => entry.action === 'approved');
  check('the work was approved exactly once despite the concurrent requests', approvals.length === 1);
  check('the review trail keeps the request and the return', (view?.reviews ?? []).some((entry) => entry.action === 'requested')
    && (view?.reviews ?? []).some((entry) => entry.action === 'returned'));

  const order = await gql(chief, 'query($id:UUID!){order(id:$id){id status version}}', { id: target.orderId });
  check('the order reached technical completion', order.data?.order?.status === 'completed');

  report.assignmentId = target.assignmentId;
  report.orderId = target.orderId;
  report.reviews = (view?.reviews ?? []).map((entry) => entry.action);
  report.pass = true;
} catch (error) {
  report.errorName = error?.name || 'Error';
  report.errorMessage = error?.message;
  throw error;
} finally {
  writeFileSync('output/stack/cu17-audit-result.json', JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ pass: report.pass, checks: report.checks.length, reviews: report.reviews }));
