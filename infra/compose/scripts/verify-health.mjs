import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const directory = fileURLToPath(new URL('../', import.meta.url));
const docker = process.platform === 'win32' ? 'docker.exe' : 'docker';
const project = 'autonexus-backend-dev';
const container = 'autonexus-backend-dev-postgres';
const composeArguments = ['compose', '--project-name', project, '--env-file', resolve(directory, '.env'), '--file', resolve(directory, 'compose.yaml')];
const serviceSettings = name => parseEnv(readFileSync(new URL('../../../services/' + name + '/.env', import.meta.url), 'utf8'));
const operations = serviceSettings('operations');
const employees = serviceSettings('employees');
const endpoints = [
  { service: 'operations', port: operations.PORT, live: '/actuator/health/liveness', ready: '/actuator/health/readiness' },
  { service: 'employees', port: employees.PORT, live: '/health/live', ready: '/health/ready' },
];
for (const endpoint of endpoints) { if (!/^\d+$/.test(endpoint.port) || Number(endpoint.port) < 1 || Number(endpoint.port) > 65535) throw new Error('Invalid service port.'); }

function dockerCommand(arguments_) {
  const result = spawnSync(docker, arguments_, { cwd: directory, encoding: 'utf8', timeout: 30000, windowsHide: true });
  if (result.status !== 0) throw new Error('Owned Compose command failed. Inspect local configuration without printing secrets.');
  return result.stdout;
}
const labels = JSON.parse(dockerCommand(['inspect', '--format', '{{json .Config.Labels}}', container]));
const normalize = path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
if (labels['com.docker.compose.project'] !== project || labels['com.docker.compose.service'] !== 'postgres' || normalize(labels['com.docker.compose.project.working_dir'] ?? '') !== normalize(directory)) {
  throw new Error('PostgreSQL does not belong to this workspace Compose; no service was stopped.');
}

async function probe(endpoint, path, code, status) {
  const response = await fetch('http://127.0.0.1:' + endpoint.port + path, { signal: AbortSignal.timeout(4000) });
  const body = await response.json();
  if (response.status !== code || body.status !== status || Object.keys(body).length !== 1) throw new Error('Unexpected or non-sanitized health response.');
  return { http: response.status, status: body.status };
}
async function sample(readyCode, readyStatus) {
  return Promise.all(endpoints.map(async endpoint => ({
    service: endpoint.service,
    live: await probe(endpoint, endpoint.live, 200, 'UP'),
    ready: await probe(endpoint, endpoint.ready, readyCode, readyStatus),
  })));
}
async function waitFor(readyCode, readyStatus, seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    try { return await sample(readyCode, readyStatus); } catch { await new Promise(resolve => setTimeout(resolve, 300)); }
  }
  throw new Error('Health contract did not reach the expected state within its deadline.');
}

const phases = [];
let restore = false;
let failure;
try {
  phases.push({ phase: 'available', results: await waitFor(200, 'UP', 15) });
  restore = true;
  dockerCommand([...composeArguments, 'stop', '--timeout', '10', 'postgres']);
  phases.push({ phase: 'postgres-stopped', results: await waitFor(503, 'DOWN', 20) });
} catch (error) { failure = error; }
finally {
  if (restore) {
    try {
      dockerCommand([...composeArguments, 'start', 'postgres']);
      phases.push({ phase: 'postgres-restored', results: await waitFor(200, 'UP', 35) });
    } catch (error) { failure = error; }
  }
}
if (failure) {
  console.error('Health/outage verification failed. Restoration was attempted for the owned PostgreSQL only; no application was restarted.');
  process.exitCode = 1;
} else { console.log(JSON.stringify({ pass: true, phases, applicationsRestarted: false })); }
