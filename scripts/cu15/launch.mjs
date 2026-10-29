/** Start only a pre-built local process; caller must inspect/stop the owned listener first. */
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { existsSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { workspace, primary, node, php, brokerFile, clientFile, serviceEnvironment } from './runtime.mjs';
const [owner, employeesUrl, financeUrl] = process.argv.slice(2);
const directory = resolve(workspace, 'output/cu15'); mkdirSync(directory, { recursive: true });
const choices = {
  employees: { binary: node, args: [resolve(workspace, 'services/employees/dist/main.js')], cwd: 'services/employees', port: 3002 },
  operations: { binary: 'C:/Program Files/Java/jdk-21/bin/java.exe', args: ['-jar', resolve(workspace, 'services/operations/target/operations-0.0.1-SNAPSHOT.jar')], cwd: 'services/operations', port: 8081 },
  bff: { binary: node, args: [resolve(workspace, 'integration/bff/dist/main.js')], cwd: 'integration/bff', port: 3004 },
  'finance-outbox': { binary: php, args: ['artisan', 'cu15:publish-outbox', '--loop', '--no-ansi'], cwd: 'services/finance', port: null },
};
const app = choices[owner]; if (!app) throw new Error('unknown local CU15 process');
const busy = port => new Promise(resolveBusy => {
  const socket = createConnection({ host: '127.0.0.1', port });
  const done = value => { socket.destroy(); resolveBusy(value); };
  socket.once('connect', () => done(true)); socket.once('error', () => done(false)); socket.setTimeout(700, () => done(false));
});
if (app.port && await busy(app.port)) throw new Error('Refusing to compete with an existing listener');
const service = owner === 'finance-outbox' ? 'finance' : owner;
const env = { ...process.env, ...(service === 'bff' ? { PORT: '3004' } : serviceEnvironment(service)) };
if (owner !== 'bff') {
  if (!existsSync(brokerFile(service))) throw new Error('Missing ignored owner broker configuration');
  env.CU15_MESSAGING_ENABLED = 'true'; env.CU15_BROKER_CLIENT_FILE = brokerFile(service);
}
if (owner === 'operations') {
  if (!existsSync(clientFile)) throw new Error('Missing ignored coordinator identity');
  env.CU15_ENABLED = 'true'; env.CU15_IDP_CLIENT_FILE = clientFile;
  env.EMPLOYEES_API_URL = employeesUrl ?? 'http://127.0.0.1:3002';
  env.FINANCE_API_URL = financeUrl ?? 'http://127.0.0.1:8000';
  for (const value of [env.EMPLOYEES_API_URL, env.FINANCE_API_URL]) { const url = new URL(value); if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) throw new Error('Only scoped loopback participant URLs'); }
}
if (owner === 'employees') env.EMPLOYEES_IDP_CLIENT_FILE = resolve(primary, 'infra/keycloak/.local/employees-client.json');
if (owner === 'finance-outbox') env.APP_DEBUG = 'false';
const log = openSync(resolve(directory, owner + '.log'), 'a');
const child = spawn(app.binary, app.args, { cwd: resolve(workspace, app.cwd), env, detached: true, stdio: ['ignore', log, log] });
child.unref();
writeFileSync(resolve(directory, owner + '.pid.json'), JSON.stringify({ pid: child.pid, owner, args: app.args, startedAt: new Date().toISOString() }, null, 2));
console.log(JSON.stringify({ owner, pid: child.pid, port: app.port }));
