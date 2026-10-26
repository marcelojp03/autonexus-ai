import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { normalizeWorkspacePath as normalize } from '../../infra/keycloak/scripts/workspace-path.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const historical = resolve(root, '.worktrees/cu01-keycloak');
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, 'Docker check unavailable');
  return result.stdout.trim();
}
try {
  for (const file of ['infra/keycloak/.env', 'infra/keycloak/.local/test-accounts.json', 'services/employees/.env', 'services/operations/.env']) {
    assert.ok(readFileSync(resolve(root, file)).equals(readFileSync(resolve(historical, file))), 'Private configuration mismatch');
  }
  for (const [name, directory, project, service, volume] of [
    ['autonexus-backend-dev-postgres', 'infra/compose', 'autonexus-backend-dev', 'postgres', 'autonexus-backend-dev_postgres-data'],
    ['autonexus-keycloak-dev-postgres-1', 'infra/keycloak', 'autonexus-keycloak-dev', 'postgres', 'autonexus-keycloak-dev_idp-postgres-data'],
    ['autonexus-keycloak-dev-keycloak-1', 'infra/keycloak', 'autonexus-keycloak-dev', 'keycloak', null],
  ]) {
    const labels = JSON.parse(docker(['inspect', '--format', '{{json .Config.Labels}}', name]));
    assert.equal(labels['com.docker.compose.project'], project);
    assert.equal(labels['com.docker.compose.service'], service);
    assert.equal(normalize(labels['com.docker.compose.project.working_dir']), normalize(resolve(root, directory)));
    assert.equal(normalize(labels['com.docker.compose.project.config_files']), normalize(resolve(root, directory, 'compose.yaml')));
    assert.equal(docker(['inspect', '--format', '{{.State.Health.Status}}', name]), 'healthy');
    if (volume) {
      const mounts = JSON.parse(docker(['inspect', '--format', '{{json .Mounts}}', name]));
      assert.ok(mounts.some(item => item.Type === 'volume' && item.Name === volume && item.Destination === '/var/lib/postgresql/data'));
      const volumeLabels = JSON.parse(docker(['volume', 'inspect', '--format', '{{json .Labels}}', volume]));
      assert.equal(volumeLabels['com.docker.compose.project'], project);
    }
  }
  for (const [port, paths] of [[8081, ['/actuator/health/liveness', '/actuator/health/readiness']], [3002, ['/health/live', '/health/ready']]]) {
    for (const path of paths) {
      const response = await fetch('http://127.0.0.1:' + port + path, { signal: AbortSignal.timeout(4000) });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: 'UP' });
    }
    assert.equal((await fetch('http://127.0.0.1:' + port + '/technical/session')).status, 401);
  }
  console.log('PASS current root Compose ownership, healthy existing named volumes, identical private bytes, SQL readiness and anonymous 401');
  console.log('LIMIT: interrupted relocation verifier did not retain its pre-relocation identity snapshot; no fresh before/after ID comparison is claimed');
} catch {
  console.error('FAIL main runtime verification; private diagnostics omitted');
  process.exitCode = 1;
}
