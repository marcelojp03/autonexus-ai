/**
 * Provision the Finanzas audience and its public client on an existing realm.
 * Idempotent; bootstrap credentials are read from the private env and never printed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:8180';
const workspace = process.cwd();
const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: workspace, encoding: 'utf8' });
assert.equal(common.status, 0, 'Git metadata unavailable');
const runtime = resolve(common.stdout.trim(), '..');
const directory = resolve(runtime, 'infra/keycloak');
const env = Object.fromEntries(
  readFileSync(resolve(directory, '.env')).toString().trim().split(/\r?\n/).map(line => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1)];
  }),
);

const request = async (path, options = {}, allowed = [200, 201, 204]) => {
  const response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(15000), redirect: 'error' });
  assert.ok(allowed.includes(response.status), 'IdP request failed: ' + path);
  return response;
};
const token = await (await request('/realms/master/protocol/openid-connect/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'password',
    client_id: 'admin-cli',
    username: env.KC_BOOTSTRAP_ADMIN_USERNAME,
    password: env.KC_BOOTSTRAP_ADMIN_PASSWORD,
  }),
})).json();
const headers = { Authorization: 'Bearer ' + token.access_token, 'Content-Type': 'application/json' };
const api = async (path, method = 'GET', data) => {
  const response = await request('/admin/realms/autonexus' + path, {
    method,
    headers,
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  return response.status === 200 ? response.json() : null;
};

const audience = 'autonexus-finance-api';
const clients = await api('/clients?clientId=' + audience);
if (clients.length === 0) {
  await api('/clients', 'POST', {
    clientId: audience,
    enabled: true,
    bearerOnly: true,
    publicClient: false,
    standardFlowEnabled: false,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: false,
  });
}

const publicClients = [
  { clientId: 'autonexus-shell', redirect: 'http://127.0.0.1:4200/auth/callback' },
  { clientId: 'autonexus-mf-employees', redirect: 'http://127.0.0.1:4201/auth/callback' },
  { clientId: 'autonexus-mf-operations', redirect: 'http://127.0.0.1:4202/auth/callback' },
  { clientId: 'autonexus-mf-finance', redirect: 'http://127.0.0.1:4204/auth/callback' },
];
for (const definition of publicClients) {
  let existing = await api('/clients?clientId=' + definition.clientId);
  if (existing.length === 0) {
    await api('/clients', 'POST', {
      clientId: definition.clientId,
      enabled: true,
      protocol: 'openid-connect',
      publicClient: true,
      standardFlowEnabled: true,
      implicitFlowEnabled: false,
      directAccessGrantsEnabled: false,
      fullScopeAllowed: false,
      redirectUris: [definition.redirect],
      webOrigins: ['http://127.0.0.1:' + definition.redirect.split(':')[2].split('/')[0]],
      attributes: { 'pkce.code.challenge.method': 'S256', 'post.logout.redirect.uris': 'http://127.0.0.1:' + definition.redirect.split(':')[2].split('/')[0] + '/' },
      defaultClientScopes: ['roles'],
      optionalClientScopes: [],
    });
    existing = await api('/clients?clientId=' + definition.clientId);
  }
  assert.equal(existing.length, 1, 'client must exist: ' + definition.clientId);
  const client = await api('/clients/' + existing[0].id);
  assert.equal(client.publicClient, true);
  if (definition.clientId === 'autonexus-mf-finance') {
    const scopes = await api('/client-scopes');
    const defaults = await api('/clients/' + client.id + '/default-client-scopes');
    // Keycloak 26 publishes sub through basic, username through profile.
    // Roles/audiences alone cannot establish a SessionPort identity.
    for (const name of ['basic', 'profile', 'roles']) {
      const scope = scopes.find(item => item.name === name);
      assert.ok(scope, 'required realm client scope must exist: ' + name);
      if (!defaults.some(item => item.id === scope.id)) {
        await api('/clients/' + client.id + '/default-client-scopes/' + scope.id, 'PUT');
      }
    }
    const confirmedScopes = await api('/clients/' + client.id + '/default-client-scopes');
    assert.ok(['basic', 'profile', 'roles'].every(name => confirmedScopes.some(scope => scope.name === name)), 'finance identity and role scopes required');
    const assigned = await api('/clients/' + client.id + '/scope-mappings/realm');
    for (const name of ['administrador', 'recepcionista', 'mecanico', 'jefe_taller', 'responsable_financiero']) {
      if (!assigned.some(role => role.name === name)) {
        await api('/clients/' + client.id + '/scope-mappings/realm', 'POST', [await api('/roles/' + name)]);
      }
    }
  }
  const audiences = definition.clientId === 'autonexus-mf-finance'
    ? [audience, 'autonexus-employees-api', 'autonexus-operations-api'] : [audience];
  for (const audience of audiences) {
    const mappers = await api('/clients/' + client.id + '/protocol-mappers/models');
    if (!mappers.some(mapper => mapper.name === audience)) {
      await api('/clients/' + client.id + '/protocol-mappers/models', 'POST', {
        name: audience,
        protocol: 'openid-connect',
        protocolMapper: 'oidc-audience-mapper',
        config: {
          'included.client.audience': audience,
          'access.token.claim': 'true',
          'id.token.claim': 'false',
          'introspection.token.claim': 'true',
        },
      });
    }
    const confirmed = await api('/clients/' + client.id + '/protocol-mappers/models');
    assert.ok(confirmed.some(mapper => mapper.name === audience), 'audience mapper expected');
  }
}

console.log('PASS finance audience and public client provisioned; existing clients preserved');
