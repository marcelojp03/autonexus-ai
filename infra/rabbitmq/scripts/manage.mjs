/** CU15 owned local broker. No destructive commands or credential output. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { project, container, version, vhost, exchange, deadExchange, events, queues, permissions, topicPermissions, queueArguments } from './topology.mjs';

const ensure = (condition, code) => { if (!condition) throw new Error(code); };
function run(command, args, timeout = 15000) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  ensure(result.status === 0, 'COMMAND_FAILED_' + command);
  return result.stdout.trim();
}
const source = resolve(fileURLToPath(new URL('..', import.meta.url)), 'compose.yaml');
const primary = resolve(run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']), '..');
const directory = resolve(primary, 'infra/rabbitmq');
const privateDirectory = resolve(primary, 'infra/compose/.local/cu15-messaging');
const manifestFile = resolve(privateDirectory, 'broker.json');
const environmentFile = resolve(privateDirectory, '.env');
const normalize = value => value.split(String.fromCharCode(92)).join('/').toLowerCase();
const loadJson = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error('PRIVATE_CONFIGURATION_INVALID'); } };
const ignored = path => run('git', ['-C', primary, 'check-ignore', '--quiet', path]);
function validate(config) {
  ensure(config.project === project && config.version === version && config.vhost === vhost, 'PRIVATE_CONFIGURATION_MISMATCH');
  ensure(config.host === '127.0.0.1' && config.amqpPort === 5672 && config.managementPort === 15672, 'PRIVATE_ENDPOINT_MISMATCH');
  ensure(config.admin?.username === 'autonexus_setup' && typeof config.admin.password === 'string' && config.admin.password.length >= 32, 'PRIVATE_ADMIN_INVALID');
  for (const owner of Object.keys(events)) {
    const value = config.services?.[owner];
    ensure(value?.host === config.host && value.port === config.amqpPort && value.vhost === vhost && value.username === 'autonexus_' + owner && typeof value.password === 'string' && value.password.length >= 32, 'PRIVATE_CLIENT_INVALID');
  }
  return config;
}
function init() {
  ignored(manifestFile); ignored(environmentFile);
  mkdirSync(privateDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(directory, { recursive: true });
  let config;
  if (existsSync(manifestFile)) config = validate(loadJson(manifestFile));
  else {
    const services = Object.fromEntries(Object.keys(events).map(owner => [owner, { host: '127.0.0.1', port: 5672, vhost, username: 'autonexus_' + owner, password: randomBytes(32).toString('base64url') }]));
    config = { project, version, vhost, host: '127.0.0.1', amqpPort: 5672, managementPort: 15672, admin: { username: 'autonexus_setup', password: randomBytes(32).toString('base64url') }, services };
    writeFileSync(manifestFile, JSON.stringify(config, null, 2), { flag: 'wx', mode: 0o600 });
  }
  const lines = ['RABBITMQ_ADMIN_USER=' + config.admin.username, 'RABBITMQ_ADMIN_PASSWORD=' + config.admin.password, 'RABBITMQ_AMQP_PORT=5672', 'RABBITMQ_MANAGEMENT_PORT=15672', ''];
  const environment = lines.join(String.fromCharCode(10));
  if (existsSync(environmentFile)) ensure(readFileSync(environmentFile, 'utf8') === environment, 'PRIVATE_ENV_MISMATCH');
  else writeFileSync(environmentFile, environment, { flag: 'wx', mode: 0o600 });
  for (const [owner, client] of Object.entries(config.services)) {
    const path = resolve(privateDirectory, owner + '.json'); ignored(path);
    if (existsSync(path)) ensure(JSON.stringify(loadJson(path)) === JSON.stringify(client), 'PRIVATE_CLIENT_MISMATCH');
    else writeFileSync(path, JSON.stringify(client, null, 2), { flag: 'wx', mode: 0o600 });
  }
  return config;
}
function ownership(required = true) {
  const result = spawnSync('docker', ['inspect', '--format', '{{json .Config.Labels}}', container], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  if (result.status !== 0) { ensure(!required, 'OWNED_BROKER_NOT_FOUND'); return false; }
  let labels; try { labels = JSON.parse(result.stdout); } catch { throw new Error('BROKER_LABELS_INVALID'); }
  ensure(labels['com.docker.compose.project'] === project && normalize(labels['com.docker.compose.project.working_dir']) === normalize(directory), 'BROKER_OWNERSHIP_MISMATCH');
  return true;
}
const occupied = port => new Promise(resolvePort => {
  const socket = createConnection({ host: '127.0.0.1', port });
  const finish = value => { socket.destroy(); resolvePort(value); };
  socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.setTimeout(800, () => finish(false));
});
function apiFor(config) {
  const authorization = 'Basic ' + Buffer.from(config.admin.username + ':' + config.admin.password).toString('base64');
  return async (path, method = 'GET', data, allowed = [200, 201, 204]) => {
    let response;
    try { response = await fetch('http://127.0.0.1:15672/api' + path, { method, headers: { Authorization: authorization, 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(5000), redirect: 'error' }); }
    catch { throw new Error('BROKER_API_UNAVAILABLE'); }
    ensure(allowed.includes(response.status), 'BROKER_API_STATUS_' + response.status);
    if (response.status !== 200) return null;
    try { return await response.json(); } catch { throw new Error('BROKER_API_RESPONSE_INVALID'); }
  };
}
async function up(config) {
  if (!ownership(false)) ensure(!(await occupied(5672)) && !(await occupied(15672)), 'BROKER_PORT_ALREADY_OWNED');
  const args = ['compose', '--project-name', project, '--project-directory', directory, '--env-file', environmentFile, '-f', source];
  run('docker', [...args, 'config', '--quiet']);
  console.log('Starting the owned CU15 broker; existing application databases are unchanged.');
  run('docker', [...args, 'up', '--detach', '--no-recreate'], 300000);
  ownership();
  const api = apiFor(config);
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    try { const overview = await api('/overview'); ensure(overview.rabbitmq_version === version, 'BROKER_VERSION_MISMATCH'); ready = true; break; }
    catch (error) { if (error.message === 'BROKER_VERSION_MISMATCH') throw error; await pause(1000); }
  }
  ensure(ready, 'BROKER_STARTUP_NOT_READY');
}
async function provision(config) {
  ownership();
  const api = apiFor(config), root = '/' + encodeURIComponent(vhost);
  await api('/vhosts' + root, 'PUT', {});
  for (const [name, type] of [[exchange, 'topic'], [deadExchange, 'direct']]) await api('/exchanges' + root + '/' + encodeURIComponent(name), 'PUT', { type, durable: true, auto_delete: false, internal: false, arguments: {} });
  for (const queue of queues) {
    const deadName = 'cu15.' + queue.owner + '.dlq.v1';
    await api('/queues' + root + '/' + encodeURIComponent(deadName), 'PUT', { durable: true, auto_delete: false, arguments: {} });
    await api('/bindings' + root + '/e/' + encodeURIComponent(deadExchange) + '/q/' + encodeURIComponent(deadName), 'POST', { routing_key: queue.deadKey, arguments: {} });
    await api('/queues' + root + '/' + encodeURIComponent(queue.name), 'PUT', { durable: true, auto_delete: false, arguments: queueArguments(queue) });
    for (const key of queue.bindings) await api('/bindings' + root + '/e/' + encodeURIComponent(exchange) + '/q/' + encodeURIComponent(queue.name), 'POST', { routing_key: key, arguments: {} });
  }
  for (const [owner, client] of Object.entries(config.services)) {
    const user = encodeURIComponent(client.username);
    const existing = await api('/users/' + user, 'GET', undefined, [200, 404]);
    if (existing) ensure(!existing.tags?.length, 'UNEXPECTED_BROKER_CLIENT_AUTHORITY');
    else await api('/users/' + user, 'PUT', { password: client.password, tags: '' });
    await api('/permissions' + root + '/' + user, 'PUT', permissions(owner));
    await api('/topic-permissions' + root + '/' + user, 'PUT', topicPermissions(owner));
  }
}
async function verify(config) {
  ownership();
  const api = apiFor(config), root = '/' + encodeURIComponent(vhost);
  ensure((await api('/overview')).rabbitmq_version === version, 'BROKER_VERSION_MISMATCH');
  const business = await api('/exchanges' + root + '/' + encodeURIComponent(exchange));
  ensure(business.durable === true && business.type === 'topic', 'BROKER_EXCHANGE_INVALID');
  for (const queue of queues) {
    const actual = await api('/queues' + root + '/' + encodeURIComponent(queue.name));
    ensure(actual.durable === true && Object.entries(queueArguments(queue)).every(([key, value]) => actual.arguments[key] === value), 'BROKER_QUEUE_INVALID');
    const bindings = await api('/queues' + root + '/' + encodeURIComponent(queue.name) + '/bindings');
    ensure(queue.bindings.every(key => bindings.some(binding => binding.source === exchange && binding.routing_key === key)), 'BROKER_BINDING_MISSING');
  }
  for (const [owner, client] of Object.entries(config.services)) {
    const user = encodeURIComponent(client.username), expected = permissions(owner);
    const actual = await api('/permissions' + root + '/' + user);
    ensure(Object.entries(expected).every(([key, value]) => actual[key] === value), 'BROKER_PERMISSION_MISMATCH');
    const topic = await api('/topic-permissions' + root + '/' + user);
    ensure(topic.length === 1 && Object.entries(topicPermissions(owner)).every(([key, value]) => topic[0][key] === value), 'BROKER_TOPIC_PERMISSION_MISMATCH');
    ensure(!(await api('/users/' + user)).tags?.length, 'UNEXPECTED_BROKER_CLIENT_AUTHORITY');
  }
  console.log('PASS RabbitMQ ' + version + ': owned broker, durable routes and scoped service identities; credentials omitted.');
}
try {
  const action = process.argv[2];
  ensure(['init', 'up', 'provision', 'verify'].includes(action), 'USE_init_up_provision_or_verify');
  const config = action === 'init' || action === 'up' ? init() : validate(loadJson(manifestFile));
  if (action === 'up') await up(config);
  if (action === 'provision') await provision(config);
  if (action === 'verify' || action === 'provision') await verify(config);
  if (action === 'init') console.log('PASS CU15 broker private configuration created or preserved; values omitted.');
  if (action === 'up') console.log('PASS owned CU15 RabbitMQ is ready; existing volumes preserved.');
} catch (error) { const code = typeof error?.message === 'string' && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'SETUP_FAILED'; console.error('FAIL CU15 RabbitMQ: ' + code + '; private diagnostics omitted.'); process.exitCode = 1; }
