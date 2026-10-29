import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../..', import.meta.url));
const result = spawnSync('docker', ['compose', '--project-name', 'autonexus-config-check', '--env-file', '.env.example', 'config', '--format', 'json'], { cwd, encoding: 'utf8', windowsHide: true, timeout: 15000, env: { ...process.env, WEB_PORT: '4299', PUBLIC_ORIGIN: 'http://127.0.0.1:4299' } });
assert.equal(result.status, 0, 'Compose configuration must validate; no runtime is started');
const config = JSON.parse(result.stdout);
test('only web is published on loopback and every volume belongs to the chosen project', () => {
  for (const [name, service] of Object.entries(config.services)) {
    assert.equal(service.container_name, undefined);
    if (name === 'web') { assert.equal(service.ports.length, 1); assert.equal(service.ports[0].host_ip, '127.0.0.1'); assert.equal(service.ports[0].target, 8080); assert.equal(service.ports[0].published, '4299'); }
    else assert.ok(!service.ports?.length);
  }
  for (const volume of Object.values(config.volumes)) assert.ok(volume.name.startsWith('autonexus-config-check_'));
});
test('runtime consumers do not mount bootstrap state or another owner configuration', () => {
  for (const [service, consumer] of [['employees', 'employees'], ['operations', 'operations'], ['finance', 'finance'], ['finance-publisher', 'finance'], ['bff', 'bff'], ['web', 'public']]) {
    assert.deepEqual(config.services[service].volumes.map(v => ({ source: v.source, target: v.target, read_only: v.read_only })), [{ source: 'config-' + consumer, target: '/run/config', read_only: true }]);
  }
});
test('migrations and genuine workers participate in ordered startup', () => {
  assert.equal(config.services.employees.depends_on['employees-migrate'].condition, 'service_completed_successfully');
  assert.equal(config.services.finance.depends_on['finance-migrate'].condition, 'service_completed_successfully');
  assert.ok(config.services['finance-publisher'].command.includes('cu15:publish-outbox'));
  assert.ok(config.services['finance-publisher'].command.includes('--loop'));
  assert.equal(config.services.provision.depends_on.keycloak.condition, 'service_healthy');
  assert.equal(config.services.keycloak.environment.KC_HTTP_MANAGEMENT_RELATIVE_PATH, '/');
  for (const service of ['keycloak', 'operations']) {
    const command = config.services[service].healthcheck.test.at(-1);
    const crlf = String.fromCharCode(92) + 'r' + String.fromCharCode(92) + 'n';
    assert.ok(command.includes(crlf + 'Host: localhost' + crlf + crlf), 'TCP probes must send HTTP CRLF escapes to printf');
    assert.ok(!command.includes(String.fromCharCode(92, 92) + 'r'), 'Do not double-escape the printf payload');
  }
});
