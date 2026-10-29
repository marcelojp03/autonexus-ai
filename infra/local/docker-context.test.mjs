import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('real Docker context excludes synthetic private locations but preserves build sources', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'autonexus-context-'));
  const context = join(fixture, 'context'), exported = join(fixture, 'export');
  const privatePaths = ['infra/compose/secrets/password', 'backups/database.sql', 'data/photo.jpg', 'datasets/sample.json', 'nested/data/private.txt', 'pgdata/base/file', 'nested/postgres-data/file', '.pgpass', 'nested/.pg_service.conf', '.envrc', 'db.backup', 'nested/key.jks', 'nested/key.keystore', 'id_rsa', 'nested/id_ed25519', '.local/accounts.json', 'demo-accounts.private.json'];
  const publicPaths = ['services/employees/src/main.ts', 'services/employees/pnpm-lock.yaml', 'services/finance/composer.lock', 'services/operations/.mvn/wrapper/maven-wrapper.jar', 'contracts/graphql/agenda.graphql', '.env.example'];
  const put = (path, value) => { const target = join(context, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, value); };
  try {
    put('.dockerignore', readFileSync(new URL('../../.dockerignore', import.meta.url)));
    put('Dockerfile', 'FROM scratch\nCOPY . /context/\n');
    for (const path of privatePaths) put(path, 'SYNTHETIC_NOT_A_SECRET');
    for (const path of publicPaths) put(path, 'PUBLIC_FIXTURE');
    const result = spawnSync('docker', ['buildx', 'build', '--progress=quiet', '--output', 'type=local,dest=' + exported, context], { encoding: 'utf8', timeout: 45000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    for (const path of privatePaths) assert.equal(existsSync(resolve(exported, 'context', path)), false, 'Private context path: ' + path);
    for (const path of publicPaths) assert.equal(existsSync(resolve(exported, 'context', path)), true, 'Required build path: ' + path);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
