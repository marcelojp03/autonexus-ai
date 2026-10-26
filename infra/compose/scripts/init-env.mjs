import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const targets = [
  new URL('../.env', import.meta.url),
  new URL('../../../services/operations/.env', import.meta.url),
  new URL('../../../services/employees/.env', import.meta.url),
];
if (targets.some(existsSync)) throw new Error('Local .env configuration already exists; nothing was overwritten.');
for (const target of targets) {
  const check = spawnSync('git', ['check-ignore', '--quiet', fileURLToPath(target)], { cwd: root, stdio: 'ignore' });
  if (check.status !== 0) throw new Error('A private configuration path is not ignored by Git; refusing to create credentials.');
}
const adminPassword = randomBytes(24).toString('base64url');
const operationsPassword = randomBytes(24).toString('base64url');
const employeesPassword = randomBytes(24).toString('base64url');
const values = [
  { POSTGRES_PORT: '55432', POSTGRES_ADMIN_USER: 'autonexus_admin', POSTGRES_ADMIN_PASSWORD: adminPassword,
    OPERATIONS_DB: 'autonexus_operations', OPERATIONS_USER: 'autonexus_operations', OPERATIONS_PASSWORD: operationsPassword,
    EMPLOYEES_DB: 'autonexus_employees', EMPLOYEES_USER: 'autonexus_employees', EMPLOYEES_PASSWORD: employeesPassword },
  { PORT: '8081', DB_HOST: '127.0.0.1', DB_PORT: '55432', DB_NAME: 'autonexus_operations', DB_USER: 'autonexus_operations', DB_PASSWORD: operationsPassword },
  { PORT: '3002', DB_HOST: '127.0.0.1', DB_PORT: '55432', DB_NAME: 'autonexus_employees', DB_USER: 'autonexus_employees', DB_PASSWORD: employeesPassword },
];
const created = [];
try {
  for (let index = 0; index < targets.length; index++) {
    const content = Object.entries(values[index]).map(([key, value]) => key + '=' + value).join('\n') + '\n';
    writeFileSync(targets[index], content, { flag: 'wx', mode: 0o600 });
    created.push(targets[index]);
  }
} catch (error) {
  for (const target of created) unlinkSync(target);
  throw new Error('Could not create local configuration (' + (error.code ?? 'unknown') + '); partial files were removed.');
}
console.log('Created 3 Git-ignored .env files with distinct local credentials. Values were not printed.');
