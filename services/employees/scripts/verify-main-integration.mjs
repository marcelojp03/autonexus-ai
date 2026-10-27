/** Live primary-root3002 verification; never creates another application instance. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { authorize } from './local-pkce.mjs';
const service = fileURLToPath(new URL('../', import.meta.url));
const common = spawnSync(
  'git',
  ['rev-parse', '--path-format=absolute', '--git-common-dir'],
  { cwd: service, encoding: 'utf8' },
);
assert.equal(common.status, 0);
const root = resolve(common.stdout.trim(), '..');
assert.equal(
  resolve(service).toLowerCase(),
  resolve(root, 'services/employees').toLowerCase(),
  'Primary-root verifier only',
);
const base = 'http://127.0.0.1:3002';
const privateFiles = [
  'infra/compose/.env',
  'infra/keycloak/.env',
  'infra/keycloak/.local/test-accounts.json',
  'infra/keycloak/.local/employees-client.json',
  'services/employees/.env',
  'services/operations/.env',
];
const before = privateFiles.map((path) => readFileSync(resolve(root, path)));
const accounts = JSON.parse(
  readFileSync(
    resolve(root, 'infra/keycloak/.local/test-accounts.json'),
    'utf8',
  ),
);
let stage = 'health',
  employeeId,
  tokens,
  failed = false;
const record = (check) => console.log(JSON.stringify({ check, pass: true }));
async function admin() {
  if (
    !tokens ||
    JSON.parse(Buffer.from(tokens.access_token.split('.')[1], 'base64url'))
      .exp -
      Date.now() / 1000 <
      20
  )
    tokens = await authorize(
      accounts.find((item) => item.key === 'administrador'),
    );
  return tokens.access_token;
}
async function api(path, method = 'GET', body, expected = 200, bearer) {
  const access = bearer === null ? null : (bearer ?? (await admin()));
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(access ? { Authorization: 'Bearer ' + access } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, expected, 'Unexpected live Employees status');
  return response.json();
}
try {
  for (const path of ['/health/live', '/health/ready']) {
    const response = await fetch(base + path, {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'UP' });
  }
  record('live-root-3002-sql-health');
  stage = 'authorization';
  const mechanic = (
    await authorize(accounts.find((item) => item.key === 'mecanico'))
  ).access_token;
  const missing = randomUUID();
  for (const [method, path] of [
    ['GET', '/employees'],
    ['GET', '/employees/' + missing],
    ['GET', '/employees/' + missing + '/history'],
    ['POST', '/employees'],
    ['PUT', '/employees/' + missing],
    ['POST', '/employees/' + missing + '/deactivate'],
    ['POST', '/employees/' + missing + '/access/retry'],
  ]) {
    await api(path, method, undefined, 401, null);
    await api(path, method, undefined, 403, mechanic);
  }
  record('seven-live-routes-real-keycloak-401-403');
  stage = 'synthetic-create-query';
  const tag = randomUUID();
  const fields = {
    firstName: 'Synthetic',
    lastName: 'MainIntegration',
    document: 'INT-' + tag,
    email: tag + '@example.invalid',
    phone: '+591 70000000',
    jobTitle: 'Integration check',
    startDate: '2020-01-01',
    specialties: ['Motor'],
  };
  const created = await api(
    '/employees',
    'POST',
    { operationId: randomUUID(), ...fields },
    201,
  );
  employeeId = created.employee.id;
  assert.equal(created.employee.access.status, 'not_requested');
  const current = await api('/employees/' + employeeId);
  assert.equal(current.version, 1);
  assert.equal(current.document, fields.document);
  const list = await api(
    '/employees?search=' + encodeURIComponent(fields.document),
  );
  assert.equal(list.total, 1);
  assert.equal(list.items[0].id, employeeId);
  record('live-synthetic-register-query');
  stage = 'update-history';
  const modification = {
    operationId: randomUUID(),
    expectedVersion: 1,
    ...fields,
    jobTitle: 'Integration verified',
  };
  const modified = await api('/employees/' + employeeId, 'PUT', modification);
  assert.equal(modified.employee.version, 2);
  const replay = await api('/employees/' + employeeId, 'PUT', modification);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.employee, modified.employee);
  const conflict = await api(
    '/employees/' + employeeId,
    'PUT',
    { ...modification, operationId: randomUUID() },
    409,
  );
  assert.equal(conflict.code, 'VERSION_CONFLICT');
  const history = await api('/employees/' + employeeId + '/history');
  assert.equal(history.total, 2);
  assert.equal(history.items[0].snapshot.jobTitle, fields.jobTitle);
  assert.equal(history.items[1].snapshot.jobTitle, 'Integration verified');
  assert.equal(history.items[1].version, 2);
  const subject = JSON.parse(
    Buffer.from((await admin()).split('.')[1], 'base64url'),
  ).sub;
  assert.equal(history.items[1].actorSubject, subject);
  record('live-modification-history-version-and-replay');
} catch (error) {
  failed = true;
  console.error(
    JSON.stringify({
      pass: false,
      stage,
      actual: typeof error.actual === 'number' ? error.actual : undefined,
      expected: typeof error.expected === 'number' ? error.expected : undefined,
      diagnostics: 'omitted',
    }),
  );
} finally {
  if (employeeId) {
    try {
      const employee = await api('/employees/' + employeeId);
      assert.equal(employee.lastName, 'MainIntegration');
      if (employee.status === 'active')
        await api('/employees/' + employeeId + '/deactivate', 'POST', {
          operationId: randomUUID(),
          expectedVersion: employee.version,
        });
      assert.equal((await api('/employees/' + employeeId)).status, 'inactive');
      assert.equal(
        (await api('/employees/' + employeeId + '/history')).total,
        3,
      );
      record('synthetic-deactivated-history-retained');
    } catch {
      failed = true;
      console.error(
        JSON.stringify({
          pass: false,
          stage: 'synthetic-cleanup',
          diagnostics: 'omitted',
        }),
      );
    }
  }
  try {
    privateFiles.forEach((path, index) =>
      assert.ok(before[index].equals(readFileSync(resolve(root, path)))),
    );
    record('private-configurations-byte-preserved');
  } catch {
    failed = true;
    console.error(
      JSON.stringify({ pass: false, stage: 'private-preservation' }),
    );
  }
}
console.log(
  JSON.stringify({
    pass: !failed,
    target: 'primary-root:3002',
    webIntegrated: false,
  }),
);
process.exitCode = failed ? 1 : 0;
