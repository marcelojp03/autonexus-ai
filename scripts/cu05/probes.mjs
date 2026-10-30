import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect, request } from './runtime.mjs';

export const workFields = 'assignmentId orderId orderNumber employee { id fullName status } vehicle { id plate make model } startsAt endsAt priority status description notes services { serviceId serviceName quantity estimatedMinutes } orderVersion assignmentVersion observedAt confirmationObservation';
const pageFields = 'actor { employeeId fullName status scopes } items { ' + workFields + ' } total limit offset from to timeZone observedAt';
const deniedKeys = /^(customerId|customerName|customerReference|email|phone|document|subject|password|access_token|quoteId|quoteVersion|unitPrice|referenceRate|totalAmount|approvalSnapshot|initiatedBy|authorizedAt)$/;
function minimal(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) { assert.ok(!deniedKeys.test(key), 'PII/financial/security field leaked'); minimal(child); }
}
function work(value, f) {
  assert.ok(value); assert.equal(value.orderId, f.orderId); assert.equal(value.employee.id, f.employeeId);
  assert.equal(value.vehicle.id, f.vehicleId); assert.equal(value.vehicle.plate, f.plate);
  assert.equal(value.status, 'confirmed'); assert.equal(value.priority, f.priority);
  assert.equal(Date.parse(value.startsAt), Date.parse(f.startsAt)); assert.equal(Date.parse(value.endsAt), Date.parse(f.endsAt));
  assert.equal(value.description, f.marker); assert.equal(value.notes, 'CU05 TEST <b>texto no HTML</b>');
  assert.ok(value.services.some(s => s.serviceId === f.serviceId && s.serviceName === f.serviceName && s.quantity === 1 && s.estimatedMinutes === 30));
  assert.ok(value.orderVersion > 0 && value.assignmentVersion > 0 && Number.isFinite(Date.parse(value.observedAt)));
  assert.ok(['observed', 'pending'].includes(value.confirmationObservation)); minimal(value);
}
export function graphql(c, session) {
  return async (account, query, variables = {}) => {
    const result = await request(c.graphql, account ? typeof account === 'string' ? account : await session.token(account) : null, 'POST', { query, variables });
    session.observeGraphql?.({ status: result.status, hasData: result.body?.data != null, bodyStatusCode: result.body?.statusCode, errors: result.body?.errors?.map(error => ({ code: /^[A-Z_]+$/.test(error.extensions?.code ?? '') ? error.extensions.code : 'WITHHELD', statusCode: error.extensions?.statusCode })) });
    return result;
  };
}
function graphError(response, code, statusCode) {
  assert.ok([200, 400, 401, 403].includes(response.status), 'Unexpected GraphQL envelope status');
  assert.ok(response.body?.errors?.length, 'GraphQL denial must contain errors');
  assert.ok(response.body.data == null || Object.values(response.body.data).every(v => v == null), 'Denied GraphQL operation must not return data');
  assert.ok(response.body.errors.some(e => e.extensions?.code === code && (statusCode === undefined || e.extensions?.statusCode === statusCode)), 'Exact GraphQL error missing');
}
export function graphAccessDenied(response) {
  if (response.status === 403) {
    assert.equal(response.body?.statusCode, 403);
    assert.equal(response.body?.message, 'Forbidden');
    assert.ok(response.body?.data == null);
  } else graphError(response, 'FORBIDDEN', 403);
}
export async function apiProbes(c, session, f, stage) {
  const range = '?from=' + f.date + '&to=' + f.date + '&status=confirmed';
  const read = (owner, path, account) => session.api(owner, path, 'GET', undefined, account);
  await stage('api-distinct-own-jobs-details-and-UTC-boundary', async () => {
    for (const [index, actor] of [f.a, f.b].entries()) {
      const page = expect(await read('operations', '/agenda/me' + range, actor.account), 200);
      assert.equal(page.actor.employeeId, actor.employee.id); assert.equal(page.timeZone, 'America/La_Paz');
      assert.equal(page.from, f.date); assert.equal(page.to, f.date); assert.equal(page.total, 1); assert.equal(page.items.length, 1);
      work(page.items[0], f.jobs[index]); f.jobs[index].assignmentId = page.items[0].assignmentId;
      work(expect(await read('operations', '/agenda/me/' + page.items[0].assignmentId, actor.account), 200), f.jobs[index]);
      assert.notEqual(new Date(page.items[0].startsAt).toISOString().slice(0, 10), f.date, 'Fixture must cross UTC day but not local midnight');
    }
  });
  await stage('api-team-filters-pagination-and-empty', async () => {
    const page = expect(await read('operations', '/agenda/team' + range + '&limit=100', f.chief.account), 200);
    for (const job of f.jobs) assert.ok(page.items.some(w => w.assignmentId === job.assignmentId));
    assert.ok(!page.items.some(w => w.orderId === f.rejected.orderId), 'Compensated/rejected CU15 is not a job');
    for (const job of f.jobs) {
      const filtered = expect(await read('operations', '/agenda/team' + range + '&employeeId=' + job.employeeId + '&priority=' + job.priority, f.chief.account), 200);
      assert.equal(filtered.total, 1); assert.equal(filtered.items.length, 1); work(filtered.items[0], job);
      work(expect(await read('operations', '/agenda/team/' + job.assignmentId, f.chief.account), 200), job);
    }
    const empty = expect(await read('operations', '/agenda/me' + range + '&priority=urgente', f.a.account), 200);
    assert.deepEqual(empty.items, []); assert.equal(empty.total, 0);
    const offset = expect(await read('operations', '/agenda/me' + range + '&limit=1&offset=1', f.a.account), 200);
    assert.equal(offset.items.length, 0); assert.equal(offset.total, 1); minimal(page);
  });
  await stage('api-IDOR-closed-input-and-no-general-CRUD-shortcut', async () => {
    for (const [actor, other] of [[f.a, f.jobs[1]], [f.b, f.jobs[0]]]) {
      expect(await read('operations', '/agenda/me/' + other.assignmentId, actor.account), 404, 'AGENDA_WORK_NOT_FOUND');
      expect(await read('operations', '/agenda/me/' + randomUUID(), actor.account), 404, 'AGENDA_WORK_NOT_FOUND');
      expect(await read('operations', '/agenda/team' + range, actor.account), 403, 'AGENDA_ACCESS_DENIED');
      for (const suffix of ['&employeeId=' + other.employeeId, '&scope=team', '&subject=' + f.chief.account.subject, '&from=' + f.date, '&status=reserved', '&status=released', '&status=in_progress', '&limit=101']) {
        expect(await read('operations', '/agenda/me' + range + suffix, actor.account), 400, 'VALIDATION_ERROR');
      }
      expect(await session.api('employees', '/agenda/assignments/check', 'POST', { scope: 'self', assignmentIds: [other.assignmentId] }, actor.account), 404, 'AGENDA_WORK_NOT_FOUND');
      expect(await read('employees', '/agenda/context?scope=team', actor.account), 403, 'AGENDA_ACCESS_DENIED');
      for (const [owner, path] of [['operations', '/orders'], ['operations', '/customers'], ['finance', '/quotes']]) expect(await read(owner, path, actor.account), 403);
    }
    expect(await read('operations', '/agenda/me', null), 401);
    const unlinkedPermissions = expect(await read('employees', '/security/permissions', session.unlinked), 200);
    assert.ok(unlinkedPermissions.effective.includes('agenda:read:self'), 'Unlinked control must have the permission so linkage is independently tested');
    for (const actor of [f.noPermission.account, session.unlinked]) expect(await read('operations', '/agenda/me' + range, actor), 403, 'AGENDA_ACCESS_DENIED');
  });
}
export async function bffProbes(c, session, f, stage) {
  const gql = graphql(c, session);
  const query = 'query($from:Date!,$to:Date!){ myAgenda(from:$from,to:$to,status:confirmed){ ' + pageFields + ' } }';
  const variables = { from: f.date, to: f.date };
  await stage('bff-own-team-list-details-and-filters', async () => {
    for (const [i, actor] of [f.a, f.b].entries()) {
      const response = await gql(actor.account, query, variables); assert.equal(response.status, 200); assert.ok(!response.body.errors);
      const page = response.body.data.myAgenda; assert.equal(page.total, 1); assert.equal(page.items.length, 1); work(page.items[0], f.jobs[i]); minimal(page);
      const detail = await gql(actor.account, 'query($id:UUID!){myAgendaWork(assignmentId:$id){' + workFields + '}}', { id: f.jobs[i].assignmentId });
      assert.ok(!detail.body.errors); work(detail.body.data.myAgendaWork, f.jobs[i]);
    }
    for (const job of f.jobs) {
      const response = await gql(f.chief.account, 'query($date:Date!,$id:UUID!,$priority:AgendaPriority!){teamAgenda(from:$date,to:$date,employeeId:$id,priority:$priority,status:confirmed){' + pageFields + '}}', { date: f.date, id: job.employeeId, priority: job.priority });
      assert.ok(!response.body.errors); assert.equal(response.body.data.teamAgenda.total, 1); work(response.body.data.teamAgenda.items[0], job);
      const detail = await gql(f.chief.account, 'query($id:UUID!){teamAgendaWork(assignmentId:$id){' + workFields + '}}', { id: job.assignmentId });
      assert.ok(!detail.body.errors); work(detail.body.data.teamAgendaWork, job);
    }
  });
  await stage('bff-IDOR-alias-multiple-fields-nested-PII-and-no-shortcut', async () => {
    graphError(await gql(f.a.account, 'query($id:UUID!){myAgendaWork(assignmentId:$id){assignmentId}}', { id: f.jobs[1].assignmentId }), 'AGENDA_WORK_NOT_FOUND', 404);
    graphError(await gql(f.a.account, '{ teamAgenda { total } }'), 'FORBIDDEN', 403);
    graphError(await gql(f.a.account, '{ a:teamAgenda { total } b:teamAgenda { items { assignmentId } } }'), 'FORBIDDEN', 403);
    graphError(await gql(f.a.account, '{ own:myAgenda { total } other:teamAgenda { total } }'), 'FORBIDDEN', 403);
    for (const input of ['employeeId:"' + f.b.employee.id + '"', 'scope:team']) graphError(await gql(f.a.account, '{myAgenda(' + input + '){total}}'), 'BAD_REQUEST', 400);
    for (const selection of ['employee { document }', 'vehicle { customerId }', 'services { unitPrice }', 'customerId', 'quoteId']) graphError(await gql(f.a.account, '{myAgenda {items {' + selection + '}}}'), 'BAD_REQUEST', 400);
    for (const q of ['{orders {items {id}}}', '{customers {items {id}}}', '{quotes {items {id}}}']) graphError(await gql(f.a.account, q), 'FORBIDDEN', 403);
    for (const actor of [f.noPermission.account, session.unlinked]) {
      const response = await gql(actor, query, variables);
      graphAccessDenied(response);
    }
  });
}
export async function identityMutations(c, session, f, stage) {
  const gql = graphql(c, session);
  const deny = async (account, stale, canLogin = true) => {
    for (const actor of canLogin ? [stale, await session.token(account, true)] : [stale, stale]) {
      expect(await session.api('employees', '/agenda/context?scope=self', 'GET', undefined, actor), 403, 'AGENDA_ACCESS_DENIED');
      expect(await session.api('operations', '/agenda/me', 'GET', undefined, actor), 403, 'AGENDA_ACCESS_DENIED');
      const result = await gql(actor, '{myAgenda {total}}');
      graphAccessDenied(result);
    }
  };
  await stage('identity-owned-inactive-no-reservations-stale-and-fresh-context', async () => {
    const account = f.inactive.account, stale = await session.token(account, true);
    const current = expect(await session.api('employees', '/employees/' + account.employeeId), 200);
    expect(await session.api('employees', '/employees/' + account.employeeId + '/deactivate', 'POST', { operationId: randomUUID(), expectedVersion: current.version }), 200);
    await deny(account, stale, false);
  });
  await stage('identity-owned-revocation-no-global-permission-mutation', async () => {
    const account = f.revoked.account, stale = await session.token(account, true);
    const result = expect(await session.api('employees', '/security/employees/' + account.employeeId + '/roles/' + account.roleName + '/revoke', 'POST', { operationId: randomUUID(), expectedVersion: account.roleVersion }), 200);
    assert.equal(result.assignment.status, 'revoked');
    await deny(account, stale);
  });
}
