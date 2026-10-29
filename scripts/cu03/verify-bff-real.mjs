/** BFF CU03 against the real Employees API and Keycloak: token scope, allowlist and forwarding. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { authorize } from '../../services/employees/scripts/local-pkce.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' });
assert.equal(common.status, 0);
const primary = resolve(common.stdout.trim(), '..');
const accounts = JSON.parse(readFileSync(resolve(primary, 'infra/keycloak/.local/test-accounts.json'), 'utf8'));
const account = key => {
  const found = accounts.find(item => item.key === key);
  assert.ok(found?.username && found?.password, 'Private fixture missing');
  return found;
};
const bff = 'http://127.0.0.1:3004';
const post = async (body, token) => {
  const response = await fetch(bff + '/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  return { status: response.status, body: await response.json() };
};
const stages = [];
try {
  const live = await fetch(bff + '/health/live', { signal: AbortSignal.timeout(4000) });
  assert.equal(live.status, 200);
  const ready = await fetch(bff + '/health/ready', { signal: AbortSignal.timeout(4000) });
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: 'UP' });
  stages.push('bff-health-with-upstream');

  const anonymous = await post({ query: '{ employees { total } }' });
  assert.equal(anonymous.status, 401);
  stages.push('anonymous-401');

  const mechanic = (await authorize(account('mecanico'))).access_token;
  const forbidden = await post({ query: '{ employees { total } }' }, mechanic);
  // CU02 moved business authorization to the root-field policy. The GraphQL
  // transport remains 200, but must expose no employee data and a typed denial.
  assert.equal(forbidden.status, 200);
  assert.ok(!forbidden.body.data?.employees);
  assert.equal(forbidden.body.errors.length, 1);
  assert.equal(forbidden.body.errors[0].extensions.code, 'FORBIDDEN');
  assert.equal(forbidden.body.errors[0].extensions.statusCode, 403);
  stages.push('employee-field-denied-403-without-data');

  const admin = (await authorize(account('administrador'))).access_token;
  const list = await post(
    { query: 'query ($limit: Int) { employees(limit: $limit) { total items { id version access { status } } } }', variables: { limit: 3 } },
    admin,
  );
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.body.data.employees.items));
  stages.push('administrator-list-forwarded');

  const introspection = await post({ query: '{ __schema { types { name } } }' }, admin);
  assert.equal(introspection.body.errors[0].extensions.code, 'BAD_REQUEST');
  stages.push('introspection-rejected');

  const invalid = await post(
    {
      query: 'mutation ($input: CreateEmployeeInput!) { createEmployee(input: $input) { employee { id } } }',
      variables: {
        input: {
          operationId: globalThis.crypto.randomUUID(),
          firstName: 'Synthetic',
          lastName: 'BffProbe',
          document: '',
          email: 'not-an-email',
          phone: '123',
          jobTitle: 'X',
          startDate: '2999-01-01',
          specialties: [],
        },
      },
    },
    admin,
  );
  assert.equal(invalid.body.errors[0].extensions.code, 'VALIDATION_ERROR');
  assert.equal(invalid.body.errors[0].extensions.statusCode, 400);
  stages.push('business-error-mapped-from-owner');

  console.log(JSON.stringify({ pass: true, stages, tokensInMemoryOnly: true }));
} catch (error) {
  console.error(JSON.stringify({ pass: false, stage: stages.length, message: String(error?.message ?? error).slice(0, 160) }));
  process.exitCode = 1;
}
