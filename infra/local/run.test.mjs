import test from 'node:test';
import assert from 'node:assert/strict';
import { options, coordinate, plan, hostBindPath, dockerFailureCode } from './run.mjs';

test('Docker failure diagnostics name the stage without echoing private stderr', () => {
  assert.equal(dockerFailureCode(['compose', 'up', 'finance'], { stderr: 'no such service: private text SECRET' }), 'DOCKER_PLATFORM_UP_UNKNOWN_SERVICE');
  assert.equal(dockerFailureCode(['compose', 'up', 'n8n'], { stderr: 'unknown flag: SECRET' }), 'DOCKER_N8N_UP_UNSUPPORTED_FLAG');
  assert.equal(dockerFailureCode(['inspect'], { stderr: 'private bytes SECRET' }), 'DOCKER_READ_FAILED');
});

test('Docker Desktop Linux bind sources resolve to existing Windows host paths', () => {
  assert.equal(hostBindPath('/run/desktop/mnt/host/c/Project With Spaces/profile.json', 'win32'), 'C:/Project With Spaces/profile.json');
  assert.equal(hostBindPath('/run/desktop/mnt/host/c/project/profile.json', 'linux'), '/run/desktop/mnt/host/c/project/profile.json');
  assert.equal(hostBindPath('/var/lib/docker/volumes/owner', 'win32'), '/var/lib/docker/volumes/owner');
});

const opts = command => options([command, '--env-file', 'private.env', '--n8n-env-file', 'n8n.private.env']);
function fixture(project = 'cu16-proof') {
  const container = (service, owner = project) => ({ Id: service, Config: { Labels: {
    'com.docker.compose.project': owner, 'com.docker.compose.service': service,
    'com.docker.compose.project.config_files': service === 'n8n' ? '/n8n.yaml' : '/compose.yaml,/override.yaml',
  } }, Mounts: [], State: { Running: true, Status: 'running' }, HostConfig: {}, NetworkSettings: { Networks: { [project + '_default']: {} } } });
  const finance = container('finance');
  finance.Mounts.push({ Type: 'bind', Source: '/private.json', Destination: '/run/finance-documents/storage.json' });
  const storage = container('finance-documents-storage');
  storage.HostConfig.NetworkMode = 'container:finance';
  storage.Mounts.push({ Type: 'volume', Name: project + '_finance-documents-minio-data', Destination: '/data' });
  const platform = ['postgres', 'sync', 'dynamodb', 'operations', 'finance-publisher', 'finance-migrate', 'demo'].map(s => container(s));
  platform.push(finance, storage);
  const n8n = container('n8n', project);
  const calls = [];
  const execute = args => {
    calls.push(args);
    if (args[0] === 'ps') return args.at(-1).endsWith('service=n8n') ? 'n8n' : platform.map(c => c.Id).join('\n');
    if (args[0] === 'inspect') return JSON.stringify(args.slice(1).map(id => [...platform, n8n].find(c => c.Id === id)));
    if (args[0] === 'volume' || args[0] === 'network') return JSON.stringify([{ Labels: { 'com.docker.compose.project': project } }]);
    return '';
  };
  const io = { exists: () => true, read: () => JSON.stringify({ endpoint: 'http://127.0.0.1:4568', secretKey: 'NEVER_PRINT' }) };
  return { platform, n8n, calls, execute, io, storage };
}

test('explicit environment, strict options and centralized default', () => {
  assert.equal(opts('check').project, 'cu16-proof');
  assert.throws(() => options(['up']), /EXPLICIT_PRIVATE_ENV_REQUIRED/);
  assert.throws(() => options(['up', '--force']), /INVALID_OPTION/);
});
for (const command of ['check', 'status']) test(command + ' is read-only and sanitized', () => {
  const f = fixture();
  const result = coordinate(opts(command), f.execute, f.io);
  assert.equal(result.actions, 0);
  assert.equal(f.calls.filter(a => a.includes('--quiet')).length, 2);
  assert.ok(f.calls.every(a => ['ps', 'inspect', 'volume', 'network'].includes(a[0]) || a.includes('--quiet')));
  assert.ok(!JSON.stringify(result).includes('NEVER_PRINT'));
});
test('up retains overrides and never prepares or recreates', () => {
  const f = fixture();
  coordinate(opts('up'), f.execute, f.io);
  const actions = f.calls.filter(a => a.includes('start'));
  assert.equal(actions.length, f.platform.filter(c => !['finance-migrate', 'demo'].includes(c.Id)).length + 1);
  assert.ok(f.calls.some(a => a.includes('--quiet') && a.includes('/override.yaml')));
  assert.ok(actions.every(a => a[0] === 'start' && a.length === 2));
  assert.ok(!actions.some(a => a.includes('finance-migrate') || a.includes('demo')));
  assert.ok(actions.findIndex(a => a[1] === 'finance') < actions.findIndex(a => a[1] === 'finance-documents-storage'));
  assert.equal(actions.at(-1)[1], 'n8n');
});
test('same existing project keeps n8n Compose separate without rejecting the installation', () => {
  const f = fixture();
  f.n8n.Config.Labels['com.docker.compose.project'] = 'cu16-proof';
  f.platform.push(f.n8n);
  const result = coordinate(opts('up'), f.execute, f.io);
  assert.equal(result.pass, true);
  const actions = f.calls.filter(args => args.includes('start'));
  assert.equal(actions.filter(args => args[1] === 'n8n').length, 1);
  const models = f.calls.filter(args => args.includes('--quiet'));
  assert.equal(models.length, 2);
  assert.equal(models[0].includes('/n8n.yaml'), false);
  assert.equal(models[1].includes('/n8n.yaml'), true);
  assert.equal(models[1][models[1].indexOf('-p') + 1], 'cu16-proof');
});
test('stop orders writers before Finance and emulators before databases', () => {
  const f = fixture();
  const actions = plan('stop', f.platform, f.n8n, [], []);
  const index = s => actions.findIndex(a => a.at(-1) === s);
  assert.ok(index('n8n') < index('finance'));
  assert.ok(index('finance-publisher') < index('finance'));
  assert.ok(index('sync') < index('dynamodb'));
  assert.ok(index('finance') < index('finance-documents-storage'));
  assert.ok(index('finance-documents-storage') < index('postgres'));
  assert.ok(actions.every(a => a[0] === 'stop'));
});
test('namespace drift blocks mutations', () => {
  const f = fixture(); f.storage.HostConfig.NetworkMode = 'container:other';
  assert.throws(() => coordinate(opts('up'), f.execute, f.io), /FINANCE_NAMESPACE_DRIFT/);
  assert.ok(!f.calls.some(a => a.includes('up')));
});
test('a foreign n8n attached to the network is not implicitly authorized for stop', () => {
  const f = fixture();
  f.n8n.Config.Labels['com.docker.compose.project'] = 'foreign-project';
  assert.throws(() => coordinate(opts('stop'), f.execute, f.io), /N8N_PROJECT_OWNERSHIP_DRIFT/);
  assert.ok(!f.calls.some(args => args[0] === 'stop'));
});
for (const declared of [true, false]) test('existing anonymous volume must be image-declared: ' + declared, () => {
  const f = fixture();
  const emulator = f.platform.find(c => c.Config.Labels['com.docker.compose.service'] === 'dynamodb');
  emulator.Mounts.push({ Type: 'volume', Name: 'existing-anonymous-id', Destination: '/var/lib/localstack' });
  emulator.Config.Volumes = declared ? { '/var/lib/localstack': {} } : {};
  const execute = args => args[0] === 'volume' && args.at(-1) === 'existing-anonymous-id' ? JSON.stringify([{ Labels: { 'com.docker.volume.anonymous': '' } }]) : f.execute(args);
  if (declared) assert.equal(coordinate(opts('check'), execute, f.io).pass, true);
  else assert.throws(() => coordinate(opts('up'), execute, f.io), /VOLUME_OWNERSHIP_DRIFT/);
  assert.ok(!f.calls.some(args => args[0] === 'rm' || args.includes('--force-recreate')));
});
test('old active document profile blocks mutations', () => {
  const f = fixture(); f.io.read = () => '{"endpoint":"http://127.0.0.1:4566"}';
  assert.throws(() => coordinate(opts('stop'), f.execute, f.io), /ACTIVE_MINIO_PROFILE_REQUIRED/);
});
test('another project is only inspected when explicitly selected', () => {
  const f = fixture('selected'); const o = opts('check'); o.project = 'selected';
  coordinate(o, f.execute, f.io);
  assert.ok(f.calls[0].at(-1).endsWith('=selected'));
  assert.ok(!JSON.stringify(f.calls).includes('cu16-proof'));
});
test('missing files and failed configuration prevent all actions', () => {
  const f = fixture(); f.io.exists = () => false;
  assert.throws(() => coordinate(opts('up'), f.execute, f.io), /REQUIRED/);
  const g = fixture();
  assert.throws(() => coordinate(opts('up'), a => { if (a.includes('--quiet')) throw Error('CONFIG_FAILED'); return g.execute(a); }, g.io), /CONFIG_FAILED/);
  assert.ok(!g.calls.some(a => a.includes('up')));
});
