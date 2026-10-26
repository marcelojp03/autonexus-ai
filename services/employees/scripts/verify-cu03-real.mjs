/** Real owned PostgreSQL/Keycloak; synthetic records retained and deactivated, no secrets logged. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { NestFactory } from '@nestjs/core';
import { authorize } from './local-pkce.mjs';
const git = spawnSync(
  'git',
  ['rev-parse', '--path-format=absolute', '--git-common-dir'],
  { encoding: 'utf8' },
);
assert.equal(git.status, 0);
const runtime = resolve(git.stdout.trim(), '..');
process.loadEnvFile(resolve(runtime, 'services/employees/.env'));
process.env.EMPLOYEES_IDP_CLIENT_FILE = resolve(
  runtime,
  'infra/keycloak/.local/employees-client.json',
);
const { AppModule } = await import('../dist/app.module.js');
const { configureHttp } =
  await import('../dist/infrastructure/http/configure-http.js');
const { dataSourceOptions } =
  await import('../dist/infrastructure/postgres/data-source-options.js');
const { PostgresEmployeeRepository } =
  await import('../dist/infrastructure/postgres/postgres-employee-repository.js');
const { ManageEmployees } =
  await import('../dist/application/manage-employees.js');
const { KeycloakIdentityGateway } =
  await import('../dist/infrastructure/keycloak/keycloak-identity-gateway.js');
const accounts = JSON.parse(
  readFileSync(
    resolve(runtime, 'infra/keycloak/.local/test-accounts.json'),
    'utf8',
  ),
);
const options = dataSourceOptions();
assert.equal(options.database, 'autonexus_employees');
assert.equal(options.username, 'autonexus_employees');
assert.equal(options.host, '127.0.0.1');
assert.equal(options.port, 55432);
const source = new DataSource(options),
  created = [],
  repositories = [];
let app,
  url,
  stage = 'migrations',
  tokens,
  mechanic,
  technicalToken;
const record = (label) =>
  console.log(JSON.stringify({ check: label, pass: true }));
const sample = () => {
  const key = randomUUID();
  return {
    firstName: 'Synthetic',
    lastName: 'CU03',
    document: 'C03-' + key,
    email: key + '@example.invalid',
    phone: '+591 70000000',
    jobTitle: 'Mecanico',
    startDate: '2020-01-01',
    specialties: ['Motor'],
  };
};
async function administrator() {
  if (
    !tokens ||
    JSON.parse(Buffer.from(tokens.access_token.split('.')[1], 'base64url'))
      .exp -
      Date.now() / 1000 <
      20
  )
    tokens = await authorize(accounts.find((a) => a.key === 'administrador'));
  return tokens.access_token;
}
async function api(path, method = 'GET', body, expected = 200, bearer) {
  const token = bearer === null ? null : (bearer ?? (await administrator()));
  const response = await fetch(url + path, {
    method,
    headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, expected, 'Unexpected employee HTTP status');
  const text = await response.text();
  assert.ok(!text.includes('DB_PASSWORD') && !text.includes('stacktrace'));
  return JSON.parse(text);
}
async function idp(path, method = 'GET', body) {
  const credentials = JSON.parse(
    readFileSync(process.env.EMPLOYEES_IDP_CLIENT_FILE, 'utf8'),
  );
  const response = await fetch(
    'http://127.0.0.1:8180/realms/autonexus/protocol/openid-connect/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      }),
      signal: AbortSignal.timeout(5000),
    },
  );
  assert.equal(response.status, 200);
  technicalToken = (await response.json()).access_token;
  const remote = await fetch(
    'http://127.0.0.1:8180/admin/realms/autonexus' + path,
    {
      method,
      headers: {
        Authorization: 'Bearer ' + technicalToken,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(5000),
    },
  );
  assert.ok(
    [200, 201, 204].includes(remote.status),
    'Unexpected owned IdP operation status',
  );
  return remote.status === 200 ? remote.json() : null;
}
async function start() {
  app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  configureHttp(app);
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
}
try {
  await source.initialize();
  if (process.argv.includes('--cleanup-only')) {
    stage = 'cleanup-owned-synthetic-records';
    await start();
    const rows = await source.query(
      "SELECT record FROM employees.employee_records WHERE record->>'status'='active' AND record->>'lastName'='CU03' AND record->>'document' LIKE 'C03-%' AND record->>'email' LIKE '%@example.invalid'",
    );
    for (const { record: employee } of rows) {
      assert.ok(
        /^C03-[0-9a-f-]{36}$/u.test(employee.document) &&
          /^[0-9a-f-]{36}@example[.]invalid$/u.test(employee.email),
      );
      const history = await source.query(
        'SELECT entry FROM employees.employee_history WHERE employee_id=$1 ORDER BY version LIMIT 1',
        [employee.id],
      );
      assert.equal(history[0]?.entry?.snapshot?.firstName, 'Synthetic');
      assert.equal(history[0]?.entry?.snapshot?.lastName, 'CU03');
    }
    created.push(...rows.map((row) => row.record.id));
  } else {
    const first = await source.runMigrations();
    assert.ok(first.length <= 1);
    assert.equal((await source.runMigrations()).length, 0);
    assert.equal(await source.showMigrations(), false);
    record('versioned-owner-migration-and-no-op');
    await start();
    stage = 'authorization';
    mechanic = (await authorize(accounts.find((a) => a.key === 'mecanico')))
      .access_token;
    for (const [method, path] of [
      ['GET', '/employees'],
      ['GET', '/employees/' + randomUUID()],
      ['GET', '/employees/' + randomUUID() + '/history'],
      ['POST', '/employees'],
      ['PUT', '/employees/' + randomUUID()],
      ['POST', '/employees/' + randomUUID() + '/deactivate'],
      ['POST', '/employees/' + randomUUID() + '/access/retry'],
    ]) {
      await api(path, method, undefined, 401, null);
      await api(path, method, undefined, 403, mechanic);
    }
    record('all-seven-actions-real-session-401-403');
    stage = 'crud';
    const fields = sample(),
      operationId = randomUUID();
    let result = await api(
      '/employees',
      'POST',
      { operationId, ...fields },
      201,
    );
    const employeeId = result.employee.id;
    created.push(employeeId);
    assert.equal(result.employee.access.status, 'not_requested');
    assert.deepEqual(
      (
        await source.query(
          'SELECT record FROM employees.employee_records WHERE id=$1',
          [employeeId],
        )
      )[0].record,
      result.employee,
    );
    const replay = await api(
      '/employees',
      'POST',
      { operationId, ...fields },
      201,
    );
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.employee, result.employee);
    assert.equal(
      (
        await api(
          '/employees',
          'POST',
          { operationId, ...fields, jobTitle: 'Other' },
          409,
        )
      ).code,
      'IDEMPOTENCY_CONFLICT',
    );
    assert.equal(
      (
        await api(
          '/employees',
          'POST',
          { operationId: randomUUID(), ...sample(), document: fields.document },
          409,
        )
      ).code,
      'DUPLICATE_DOCUMENT',
    );
    assert.equal(
      (
        await api(
          '/employees',
          'POST',
          {
            operationId: randomUUID(),
            ...sample(),
            email: fields.email.toUpperCase(),
          },
          409,
        )
      ).code,
      'DUPLICATE_EMAIL',
    );
    for (const invalid of [
      { firstName: '' },
      { firstName: String.fromCharCode(0) },
      { firstName: String.fromCharCode(0xd800) },
      { email: 'bad' },
      { email: String.fromCharCode(0x212a) + '@example.com' },
      { email: 'ana@' + String.fromCharCode(0x212a) + '.example' },
      { email: 'ana@-example.com' },
      { email: 'ana@example..com' },
      { email: '.ana@example.com' },
      { startDate: '2025-02-30' },
      { startDate: '2999-01-01' },
      { specialties: ['Motor', ' Motor '] },
      { phone: 'abcdefg' },
      { roles: ['administrador'] },
      { access: null },
    ])
      await api(
        '/employees',
        'POST',
        { operationId: randomUUID(), ...sample(), ...invalid },
        400,
      );
    result = await api('/employees/' + employeeId, 'PUT', {
      operationId: randomUUID(),
      expectedVersion: 1,
      ...fields,
      jobTitle: 'Jefe laboral',
    });
    assert.equal(result.employee.version, 2);
    assert.equal(
      (
        await api(
          '/employees/' + employeeId,
          'PUT',
          { operationId: randomUUID(), expectedVersion: 1, ...fields },
          409,
        )
      ).code,
      'VERSION_CONFLICT',
    );
    const history = await api('/employees/' + employeeId + '/history');
    assert.equal(history.total, 2);
    assert.equal(history.items[0].snapshot.jobTitle, 'Mecanico');
    assert.equal(
      history.items[1].actorSubject,
      JSON.parse(
        Buffer.from((await administrator()).split('.')[1], 'base64url'),
      ).sub,
    );
    record('real-persistence-validation-duplicates-version-idempotency-audit');
    stage = 'concurrency';
    const duplicatedEmail = sample().email;
    const duplicateResults = await Promise.all(
      [1, 2].map(async () => {
        const response = await fetch(url + '/employees', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + (await administrator()),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            operationId: randomUUID(),
            ...sample(),
            email: duplicatedEmail,
          }),
        });
        const body = await response.json();
        if (response.status === 201) created.push(body.employee.id);
        return { status: response.status, code: body.code };
      }),
    );
    assert.equal(duplicateResults.filter((r) => r.status === 201).length, 1);
    assert.equal(
      duplicateResults.filter(
        (r) => r.status === 409 && r.code === 'DUPLICATE_EMAIL',
      ).length,
      1,
    );
    record('concurrent-duplicate-email-one-durable-employee');

    const concurrent = await Promise.all(
      [1, 2].map(async (n) => {
        const response = await fetch(url + '/employees/' + employeeId, {
          method: 'PUT',
          headers: {
            Authorization: 'Bearer ' + (await administrator()),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            operationId: randomUUID(),
            expectedVersion: 2,
            ...fields,
            jobTitle: 'Concurrent ' + n,
          }),
        });
        return response.status;
      }),
    );
    assert.equal(concurrent.filter((status) => status === 200).length, 1);
    assert.ok(concurrent.every((status) => [200, 409, 503].includes(status)));
    record('concurrent-version-no-lost-update');
    stage = 'deactivation';
    let current = await api('/employees/' + employeeId);
    await api('/employees/' + employeeId + '/deactivate', 'POST', {
      operationId: randomUUID(),
      expectedVersion: current.version,
    });
    current = await api('/employees/' + employeeId);
    assert.equal(current.status, 'inactive');
    assert.equal((await api('/employees/' + employeeId + '/history')).total, 4);
    const noop = await api('/employees/' + employeeId + '/deactivate', 'POST', {
      operationId: randomUUID(),
      expectedVersion: current.version,
    });
    assert.equal(noop.employee.version, current.version);
    assert.equal(
      (
        await api(
          '/employees',
          'POST',
          { operationId: randomUUID(), ...sample(), document: fields.document },
          409,
        )
      ).code,
      'DUPLICATE_DOCUMENT',
    );
    assert.equal(
      (
        await api(
          '/employees?status=inactive&search=' +
            encodeURIComponent(fields.document),
        )
      ).total,
      1,
    );
    assert.equal(
      (await api('/employees?search=' + encodeURIComponent('%'))).total,
      0,
    );
    record('deactivation-retains-history-and-uniqueness');
    stage = 'identity';
    const linkedFields = sample();
    result = await api(
      '/employees',
      'POST',
      {
        operationId: randomUUID(),
        ...linkedFields,
        access: { requested: true },
      },
      201,
    );
    const linkedId = result.employee.id;
    created.push(linkedId);
    let linked = await api('/employees/' + linkedId);
    assert.equal(linked.access.status, 'synced');
    assert.ok(linked.access.subject);
    const subject = linked.access.subject;
    let remote = await idp('/users/' + subject);
    assert.equal(remote.attributes.employeeId[0], linkedId);
    assert.equal(remote.username, 'employee-' + linkedId);
    assert.equal((await idp('/users/' + subject + '/credentials')).length, 0);
    assert.ok(
      !(await idp('/users/' + subject + '/role-mappings/realm')).some((role) =>
        [
          'administrador',
          'mecanico',
          'recepcionista',
          'jefe_taller',
          'responsable_financiero',
        ].includes(role.name),
      ),
    );
    await api('/employees/' + linkedId, 'PUT', {
      operationId: randomUUID(),
      expectedVersion: 1,
      ...linkedFields,
      firstName: 'Changed',
    });
    linked = await api('/employees/' + linkedId);
    assert.equal(linked.access.subject, subject);
    assert.equal((await idp('/users/' + subject)).firstName, 'Changed');
    stage = 'externally-disabled-account';
    await idp('/users/' + subject, 'PUT', { enabled: false });
    await api('/employees/' + linkedId, 'PUT', {
      operationId: randomUUID(),
      expectedVersion: 2,
      ...linkedFields,
      firstName: 'ChangedAgain',
    });
    assert.equal((await idp('/users/' + subject)).enabled, false);
    assert.equal(
      (await api('/employees/' + linkedId)).access.errorCode,
      'IDP_ACCOUNT_DISABLED',
    );
    // Separate authorized IdP action in this synthetic fixture, not a CU03 endpoint.
    await idp('/users/' + subject, 'PUT', { enabled: true });
    await api('/employees/' + linkedId + '/access/retry', 'POST', {
      operationId: randomUUID(),
      expectedVersion: 3,
    });
    assert.equal((await api('/employees/' + linkedId)).access.status, 'synced');
    record('disabled-idp-account-never-reactivated-by-profile-update');
    stage = 'identity';

    assert.equal(
      (
        await api(
          '/employees/' + linkedId,
          'PUT',
          {
            operationId: randomUUID(),
            expectedVersion: 3,
            ...linkedFields,
            access: { requested: false },
          },
          409,
        )
      ).code,
      'ACCESS_REQUEST_CANNOT_BE_REVOKED',
    );
    await api('/employees/' + linkedId + '/deactivate', 'POST', {
      operationId: randomUUID(),
      expectedVersion: 3,
    });
    remote = await idp('/users/' + subject);
    assert.equal(remote.enabled, false);
    record(
      'optional-account-profile-stable-subject-disable-no-roles-no-credential',
    );
    if (!process.argv.includes('--skip-recovery')) {
      stage = 'lost-response';
      let dropped = false;
      const transport = async (input, init) => {
        const response = await fetch(input, init);
        if (
          !dropped &&
          String(input).endsWith('/admin/realms/autonexus/users') &&
          init?.method === 'POST' &&
          response.status === 201
        ) {
          dropped = true;
          throw new DOMException('Controlled response loss', 'TimeoutError');
        }
        return response;
      };
      const repository = new PostgresEmployeeRepository();
      repositories.push(repository);
      const service = new ManageEmployees(
        repository,
        new KeycloakIdentityGateway(transport),
      );
      result = await service.mutate(
        'create',
        null,
        { operationId: randomUUID(), ...sample(), access: { requested: true } },
        'synthetic-recovery',
      );
      const recoveryId = result.employee.id;
      created.push(recoveryId);
      assert.ok(dropped);
      let failed = await repository.get(recoveryId);
      assert.equal(failed.access.errorCode, 'IDP_TIMEOUT');
      assert.equal(failed.access.subject, null);
      await repository.onApplicationShutdown();
      const restarted = new PostgresEmployeeRepository();
      repositories.push(restarted);
      const recovered = new ManageEmployees(
        restarted,
        new KeycloakIdentityGateway(),
      );
      await recovered.mutate(
        'retry',
        recoveryId,
        { operationId: randomUUID(), expectedVersion: 1 },
        'synthetic-recovery',
      );
      failed = await restarted.get(recoveryId);
      assert.equal(failed.access.status, 'synced');
      assert.equal(failed.version, 1);
      const matching = await idp(
        '/users?exact=true&username=employee-' + recoveryId,
      );
      assert.equal(matching.length, 1);
      assert.equal(failed.access.subject, matching[0].id);
      record(
        'real-idp-write-injected-lost-response-restart-retry-one-identity',
      );
      stage = 'ownership-conflict';
      result = await recovered.mutate(
        'create',
        null,
        { operationId: randomUUID(), ...sample() },
        'synthetic-recovery',
      );
      const conflictId = result.employee.id;
      created.push(conflictId);
      await idp('/users', 'POST', {
        username: 'employee-' + conflictId,
        firstName: 'Foreign',
        lastName: 'Synthetic',
        email: randomUUID() + '@example.invalid',
        enabled: false,
        attributes: { employeeId: [randomUUID()] },
      });
      const foreign = (
        await idp('/users?exact=true&username=employee-' + conflictId)
      )[0];
      const foreignBefore = await idp('/users/' + foreign.id);
      await recovered.mutate(
        'update',
        conflictId,
        {
          operationId: randomUUID(),
          expectedVersion: 1,
          ...sample(),
          access: { requested: true },
        },
        'synthetic-recovery',
      );
      const conflict = await restarted.get(conflictId);
      assert.equal(conflict.access.status, 'conflict');
      assert.equal(conflict.access.errorCode, 'IDP_OWNERSHIP_CONFLICT');
      assert.deepEqual(await idp('/users/' + foreign.id), foreignBefore);
      record('foreign-identity-ownership-conflict-no-mutation');
      stage = 'sql-confirmation-failure';
      result = await recovered.mutate(
        'create',
        null,
        { operationId: randomUUID(), ...sample() },
        'synthetic-recovery',
      );
      const confirmationId = result.employee.id;
      created.push(confirmationId);
      const suffix = randomUUID().split('-').join(''),
        trigger = 'verify_confirm_' + suffix,
        fn = 'employees.' + trigger;
      await source.query(
        'CREATE FUNCTION ' +
          fn +
          "() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Controlled confirmation failure'; END $$",
      );
      try {
        await source.query(
          'CREATE TRIGGER ' +
            trigger +
            " BEFORE UPDATE ON employees.employee_records FOR EACH ROW WHEN (NEW.id='" +
            confirmationId +
            "'::uuid AND NEW.record->'access'->>'status'='synced') EXECUTE FUNCTION " +
            fn +
            '()',
        );
        await recovered.mutate(
          'update',
          confirmationId,
          {
            operationId: randomUUID(),
            expectedVersion: 1,
            ...sample(),
            access: { requested: true },
          },
          'synthetic-recovery',
        );
        const pending = await restarted.get(confirmationId);
        assert.equal(pending.access.status, 'pending');
        assert.equal(pending.access.subject, null);
        const remoteBefore = await idp(
          '/users?exact=true&username=employee-' + confirmationId,
        );
        assert.equal(remoteBefore.length, 1);
        await source.query(
          'DROP TRIGGER ' + trigger + ' ON employees.employee_records',
        );
        await recovered.mutate(
          'retry',
          confirmationId,
          { operationId: randomUUID(), expectedVersion: 2 },
          'synthetic-recovery',
        );
        const confirmed = await restarted.get(confirmationId);
        assert.equal(confirmed.access.status, 'synced');
        assert.equal(confirmed.access.subject, remoteBefore[0].id);
        assert.equal(
          (await idp('/users?exact=true&username=employee-' + confirmationId))
            .length,
          1,
        );
      } finally {
        await source.query(
          'DROP TRIGGER IF EXISTS ' +
            trigger +
            ' ON employees.employee_records',
        );
        await source.query('DROP FUNCTION ' + fn + '()');
      }
      record('real-remote-success-injected-local-confirmation-failure-retry');
      stage = 'identity-concurrency';
      result = await recovered.mutate(
        'create',
        null,
        { operationId: randomUUID(), ...sample() },
        'synthetic-recovery',
      );
      const serializedId = result.employee.id;
      created.push(serializedId);
      let release, entered;
      const gate = new Promise((resolve) => {
          release = resolve;
        }),
        arrived = new Promise((resolve) => {
          entered = resolve;
        });
      let paused = false;
      const heldGateway = new KeycloakIdentityGateway(async (input, init) => {
        if (!paused && init?.method === 'PUT') {
          paused = true;
          entered();
          await gate;
        }
        return fetch(input, init);
      });
      const serialized = new ManageEmployees(restarted, heldGateway);
      const inFlight = serialized.mutate(
        'update',
        serializedId,
        {
          operationId: randomUUID(),
          expectedVersion: 1,
          ...sample(),
          access: { requested: true },
        },
        'synthetic-recovery',
      );
      try {
        await Promise.race([
          arrived,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('No remote boundary')), 15000),
          ),
        ]);
        await api(
          '/employees/' + serializedId + '/deactivate',
          'POST',
          { operationId: randomUUID(), expectedVersion: 2 },
          503,
        );
      } finally {
        release();
      }
      await inFlight;
      await api('/employees/' + serializedId + '/deactivate', 'POST', {
        operationId: randomUUID(),
        expectedVersion: 2,
      });
      const disabled = await restarted.get(serializedId);
      assert.equal(
        (await idp('/users/' + disabled.access.subject)).enabled,
        false,
      );
      record('cross-connection-lock-no-stale-enable-after-deactivation');
      stage = 'lost-sql-session';
      const partitionFields = sample();
      result = await recovered.mutate(
        'create',
        null,
        {
          operationId: randomUUID(),
          ...partitionFields,
          access: { requested: true },
        },
        'synthetic-partition',
      );
      const partitionId = result.employee.id;
      created.push(partitionId);
      const partitionSubject = (await restarted.get(partitionId)).access
        .subject;
      let unlockLate,
        lateEntered,
        lateDelivered = false;
      const lateGate = new Promise((resolve) => {
          unlockLate = resolve;
        }),
        lateArrival = new Promise((resolve) => {
          lateEntered = resolve;
        });
      let held = false;
      const lateGateway = new KeycloakIdentityGateway(async (input, init) => {
        if (!held && init?.method === 'PUT') {
          held = true;
          lateEntered();
          await lateGate;
          // Controlled late delivery models an IdP request committing after the SQL session is lost.
          const response = await fetch(input, {
            ...init,
            signal: AbortSignal.timeout(5000),
          });
          lateDelivered = response.status === 204;
          return response;
        }
        return fetch(input, init);
      });
      const lateService = new ManageEmployees(restarted, lateGateway);
      const lateWork = lateService.mutate(
        'update',
        partitionId,
        {
          operationId: randomUUID(),
          expectedVersion: 1,
          ...partitionFields,
          firstName: 'OldInFlight',
        },
        'synthetic-partition',
      );
      try {
        await Promise.race([
          lateArrival,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('No in-flight boundary')), 15000),
          ),
        ]);
        const locks = await source.query(
          "SELECT l.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND l.granted AND l.objsubid=1 AND l.classid::bigint=((hashtextextended($1,0)>>32)&4294967295) AND l.objid::bigint=(hashtextextended($1,0)&4294967295) AND a.usename=current_user AND a.datname=current_database() AND l.pid<>pg_backend_pid()",
          ['employee:' + partitionId],
        );
        assert.equal(
          locks.length,
          1,
          'Expected exactly one owned synthetic employee lock',
        );
        assert.equal(
          (
            await source.query('SELECT pg_terminate_backend($1) AS stopped', [
              locks[0].pid,
            ])
          )[0].stopped,
          true,
        );
        await api('/employees/' + partitionId, 'PUT', {
          operationId: randomUUID(),
          expectedVersion: 2,
          ...partitionFields,
          firstName: 'Newest',
        });
        await api('/employees/' + partitionId + '/deactivate', 'POST', {
          operationId: randomUUID(),
          expectedVersion: 3,
        });
      } finally {
        unlockLate();
      }
      await lateWork;
      assert.equal(lateDelivered, true);
      assert.equal((await idp('/users/' + partitionSubject)).enabled, false);
      const beforeRepair = await api('/employees/' + partitionId);
      assert.equal(beforeRepair.version, 4);
      await api('/employees/' + partitionId + '/access/retry', 'POST', {
        operationId: randomUUID(),
        expectedVersion: 4,
      });
      const afterRepair = await api('/employees/' + partitionId);
      assert.equal(afterRepair.version, 4);
      assert.equal(afterRepair.updatedAt, beforeRepair.updatedAt);
      assert.equal(afterRepair.access.status, 'synced');
      const repaired = await idp('/users/' + partitionSubject);
      assert.equal(repaired.firstName, 'Newest');
      assert.equal(repaired.enabled, false);
      record(
        'owned-sql-session-loss-late-write-no-reactivation-explicit-repair',
      );
      stage = 'real-idp-outage';
      const container = 'autonexus-keycloak-dev-keycloak-1';
      const inspect = spawnSync(
        'docker',
        ['inspect', '--format', '{{json .Config.Labels}}', container],
        { encoding: 'utf8' },
      );
      assert.equal(inspect.status, 0);
      const labels = JSON.parse(inspect.stdout);
      const normalize = (value) =>
        value
          .split(String.fromCharCode(92))
          .join('/')
          .split('/')
          .filter(Boolean)
          .join('/')
          .toLowerCase();
      assert.equal(
        labels['com.docker.compose.project'],
        'autonexus-keycloak-dev',
      );
      assert.equal(
        normalize(labels['com.docker.compose.project.working_dir']),
        normalize(resolve(runtime, 'infra/keycloak')),
      );
      let outageId;
      try {
        assert.equal(
          spawnSync('docker', ['stop', '--time', '3', container], {
            encoding: 'utf8',
            timeout: 15000,
          }).status,
          0,
        );
        result = await recovered.mutate(
          'create',
          null,
          {
            operationId: randomUUID(),
            ...sample(),
            access: { requested: true },
          },
          'synthetic-recovery',
        );
        outageId = result.employee.id;
        created.push(outageId);
        const unavailable = await restarted.get(outageId);
        assert.equal(unavailable.access.status, 'failed');
        assert.equal(unavailable.access.errorCode, 'IDP_UNAVAILABLE');
      } finally {
        assert.equal(
          spawnSync('docker', ['start', container], {
            encoding: 'utf8',
            timeout: 15000,
          }).status,
          0,
        );
        let ready = false;
        const deadline = Date.now() + 300000;
        let lastProgress = Date.now();
        while (Date.now() < deadline && !ready) {
          const health = spawnSync(
            'docker',
            ['inspect', '--format', '{{.State.Health.Status}}', container],
            { encoding: 'utf8', timeout: 5000 },
          );
          try {
            ready =
              health.status === 0 &&
              health.stdout.trim() === 'healthy' &&
              (
                await fetch(
                  'http://127.0.0.1:8180/realms/autonexus/.well-known/openid-configuration',
                  { signal: AbortSignal.timeout(1000) },
                )
              ).status === 200;
          } catch {}
          if (!ready) {
            if (Date.now() - lastProgress >= 30000) {
              console.log(
                JSON.stringify({
                  stage: 'owned-idp-restoration-wait',
                  ready: false,
                }),
              );
              lastProgress = Date.now();
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
        assert.ok(ready, 'Owned IdP did not recover');
      }
      await recovered.mutate(
        'retry',
        outageId,
        { operationId: randomUUID(), expectedVersion: 1 },
        'synthetic-recovery',
      );
      assert.equal((await restarted.get(outageId)).access.status, 'synced');
      record('real-owned-idp-outage-durable-failure-restoration-retry');
    }
    stage = 'restart-persistence';
    await app.close();
    app = undefined;
    await start();
    assert.equal((await api('/employees/' + employeeId)).status, 'inactive');
    assert.equal((await api('/employees/' + employeeId + '/history')).total, 4);
    record('application-restart-retains-employees-and-history');
    console.log(
      JSON.stringify({
        pass: true,
        realPostgres: true,
        realKeycloak: true,
        webIntegrated: false,
        cu02Complete: false,
      }),
    );
  }
} catch (error) {
  console.error(
    JSON.stringify({
      pass: false,
      stage,
      actual: typeof error.actual === 'number' ? error.actual : undefined,
      expected: typeof error.expected === 'number' ? error.expected : undefined,
      enumActual: [
        'conflict',
        'synced',
        'pending',
        'failed',
        'not_requested',
        'IDP_OWNERSHIP_CONFLICT',
      ].includes(error.actual)
        ? error.actual
        : undefined,
      diagnostics: 'omitted',
    }),
  );
  process.exitCode = 1;
} finally {
  for (const id of created) {
    let cleanupStep = 'lookup';
    try {
      const e = await api('/employees/' + id);
      if (e.status === 'active') {
        cleanupStep = 'deactivate';
        await api('/employees/' + id + '/deactivate', 'POST', {
          operationId: randomUUID(),
          expectedVersion: e.version,
        });
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          stage: 'synthetic-cleanup-pending',
          step: cleanupStep,
          httpActual:
            typeof error.actual === 'number' ? error.actual : undefined,
          httpExpected:
            typeof error.expected === 'number' ? error.expected : undefined,
          errorType: [
            'AssertionError',
            'TypeError',
            'TimeoutError',
            'AbortError',
          ].includes(error.name)
            ? error.name
            : 'Error',
        }),
      );
      process.exitCode = 1;
    }
  }
  for (const repository of repositories)
    await repository.onApplicationShutdown();
  if (app) await app.close();
  if (source.isInitialized) await source.destroy();
  if (process.argv.includes('--cleanup-only'))
    console.log(
      JSON.stringify({
        check: 'owned-synthetic-cleanup',
        pass: process.exitCode !== 1,
        records: created.length,
      }),
    );
}
