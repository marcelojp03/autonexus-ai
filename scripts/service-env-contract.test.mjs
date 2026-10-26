import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
function fixture(service, extra = '') {
  const directory = mkdtempSync(join(tmpdir(), 'autonexus-cu01-env-contract-'));
  const scripts = join(directory, 'infra', 'compose', 'scripts');
  const owner = join(directory, 'services', service);
  mkdirSync(scripts, { recursive: true }); mkdirSync(owner, { recursive: true });
  copyFileSync(join(root, 'infra/compose/scripts/load-service-env.ps1'), join(scripts, 'load-service-env.ps1'));
  const synthetic = randomBytes(24).toString('base64url');
  const example = readFileSync(join(root, 'services', service, '.env.example'), 'utf8');
  assert.match(example, /^DB_PASSWORD=$/m);
  writeFileSync(join(owner, '.env'), example.replace(/^DB_PASSWORD=$/m, 'DB_PASSWORD=' + synthetic) + '\n' + extra);
  return { directory, scripts, synthetic };
}
function run(f, service) {
  const script = join(f.scripts, 'load-service-env.ps1').replaceAll("'", "''");
  const command = "$ErrorActionPreference='Stop'; . '" + script + "' -Service " + service
    + "; if ($env:OIDC_ISSUER_URI -ne 'http://127.0.0.1:8180/realms/autonexus') { throw 'Issuer not loaded' }"
    + "; if ($env:OIDC_AUDIENCE -ne 'autonexus-" + service + "-api') { throw 'Audience not loaded' }"
    + "; if (-not $env:WEB_ALLOWED_ORIGINS.Contains('http://127.0.0.1:4200')) { throw 'Origins not loaded' }"
    + "; if ([string]::IsNullOrEmpty($env:DB_PASSWORD)) { throw 'Fixture password not loaded' }; Write-Output 'CONTRACT_PASS'";
  const result = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.error, undefined, 'PowerShell must be installed for this contract test.');
  assert.ok(!result.stdout.includes(f.synthetic) && !result.stderr.includes(f.synthetic), 'Loader must not expose private values.');
  return result;
}
function cleanup(f) {
  assert.ok(basename(f.directory).startsWith('autonexus-cu01-env-contract-'));
  rmSync(f.directory, { recursive: true }); // Only our unique, synthetic test fixture.
}
for (const service of ['operations', 'employees']) {
  test(service + ': public example including OIDC loads without exposing fixture secrets', () => {
    const f = fixture(service);
    try { const result = run(f, service); assert.equal(result.status, 0, result.stderr.includes('Unexpected key in local service environment.') ? 'Loader rejected a documented OIDC key' : 'Fixture loader failed'); assert.match(result.stdout, /CONTRACT_PASS/); }
    finally { cleanup(f); }
  });
}
test('unexpected environment keys still fail closed without printing values', () => {
  const f = fixture('operations', 'UNEXPECTED_OVERRIDE=synthetic-only\n');
  try { const result = run(f, 'operations'); assert.notEqual(result.status, 0); assert.ok(!result.stdout.includes('CONTRACT_PASS')); }
  finally { cleanup(f); }
});
