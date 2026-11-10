import assert from 'node:assert/strict';
import { test, before, after, beforeEach } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { AccessError, MCP_SCOPES, requireScope } from '../dist/domain/access.js';
import { loadConfig } from '../dist/infrastructure/config.js';
import { FileClientRegistry } from '../dist/infrastructure/client-registry.js';
import { readPrivateJson } from '../dist/infrastructure/client-registry.js';
import { AccessTokenVerifier, API_AUDIENCES } from '../dist/infrastructure/access-token-verifier.js';
import { KeycloakTokenExchange } from '../dist/application/token-exchange.js';

// These are unit tests with synthetic RSA identities and a local IdP HTTP double.
let directory, server, config, privateKey, jwk, verifier, registry;
let exchangeResult, exchangeStatus, seenForm, jwksStatus;
const tokenType = 'urn:ietf:params:oauth:token-type:access_token';
const now = () => Math.floor(Date.now() / 1000);
const safeError = (status, code) => error => error instanceof AccessError &&
  error.status === status && error.code === code && !error.message.includes('sensitive-marker');
const writeRegistry = async clients => writeFile(config.clientRegistryFile,
  JSON.stringify({ version: 1, clients }), { mode: 0o600 });
const client = (overrides = {}) => ({ clientId: 'external-reader', enabled: true, scopes: [...MCP_SCOPES], ...overrides });

async function signed(overrides = {}, algorithm = 'RS256') {
  return new SignJWT({ iss: config.issuerUrl, aud: [config.resourceUrl, 'autonexus-mcp-server'], sub: 'synthetic-employee',
    azp: 'external-reader', typ: 'Bearer', exp: now() + 120, scope: 'openid mcp mcp:orders:read', ...overrides })
    .setProtectedHeader({ alg: algorithm, kid: 'unit-rsa' })
    .sign(algorithm === 'RS256' ? privateKey : new TextEncoder().encode('synthetic-unit-key-not-a-real-secret'));
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'autonexus-mcp-unit-'));
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  jwk = { ...await exportJWK(pair.publicKey), kid: 'unit-rsa', alg: 'RS256', use: 'sig' };
  server = createServer(async (req, res) => {
    if (req.url === '/jwks') {
      res.writeHead(jwksStatus, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
    } else if (req.url === '/token') {
      let body = '';
      for await (const chunk of req) body += chunk;
      seenForm = new URLSearchParams(body);
      res.writeHead(exchangeStatus, { 'content-type': 'application/json' });
      res.end(typeof exchangeResult === 'string' ? exchangeResult : JSON.stringify(exchangeResult));
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  config = loadConfig({ MCP_CLIENT_REGISTRY_FILE: join(directory, 'registry.json'),
    MCP_IDP_CLIENT_FILE: join(directory, 'requester.json'), MCP_JWKS_URL: `${base}/jwks`,
    MCP_TOKEN_ENDPOINT_URL: `${base}/token` });
  await writeFile(config.idpClientFile, JSON.stringify({ clientId: 'autonexus-mcp-server',
    clientSecret: 'synthetic-sensitive-marker' }), { mode: 0o600 });
  registry = new FileClientRegistry(config.clientRegistryFile);
});

beforeEach(async () => {
  await writeRegistry([client()]);
  exchangeStatus = 200; jwksStatus = 200; seenForm = undefined;
  verifier = new AccessTokenVerifier(config, registry);
  exchangeResult = { access_token: await signed({ aud: [...API_AUDIENCES], azp: 'autonexus-mcp-server' }),
    token_type: 'Bearer', issued_token_type: tokenType };
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('unit: config has fixed canonical resource and exact current issuer defaults', () => {
  assert.equal(config.resourceUrl, 'http://127.0.0.1:3006/mcp');
  assert.equal(config.issuerUrl, 'http://127.0.0.1:4286/identity/realms/autonexus');
  assert.equal(config.operationsBaseUrl, 'http://127.0.0.1:8081');
  assert.equal(config.host, '127.0.0.1');
});

for (const overrides of [
  { MCP_RESOURCE_URL: 'http://example.test/mcp' },
  { MCP_RESOURCE_URL: 'http://127.0.0.1:3006/mcp?x=1' },
  { MCP_RESOURCE_URL: 'http://127.0.0.1:3006/mcp?' },
  { MCP_RESOURCE_URL: 'http://127.0.0.1:3006/mcp#' },
  { MCP_RESOURCE_URL: 'http://user:pass@127.0.0.1:3006/mcp' },
  { MCP_ISSUER_URL: 'http://localhost:4286/identity/realms/autonexus#x' },
  { MCP_JWKS_URL: 'http://keycloak:8080/certs' },
  { MCP_CLIENT_REGISTRY_FILE: 'relative.json' },
  { MCP_IDP_CLIENT_FILE: 'relative.json' },
  { MCP_PORT: '3006bad' },
  { NODE_ENV: 'production', MCP_ALLOW_INTERNAL_HTTP_DEV: 'true' },
]) test(`unit: config rejects unsafe boundary ${Object.keys(overrides).join(',')}`, () => {
  assert.throws(() => loadConfig({ MCP_CLIENT_REGISTRY_FILE: config.clientRegistryFile,
    MCP_IDP_CLIENT_FILE: config.idpClientFile, ...overrides }), /^Error: Invalid MCP configuration$/);
});

test('unit: explicitly trusted internal endpoints do not change canonical issuer/resource', () => {
  const result = loadConfig({ MCP_CLIENT_REGISTRY_FILE: config.clientRegistryFile,
    MCP_IDP_CLIENT_FILE: config.idpClientFile, MCP_ALLOW_INTERNAL_HTTP_DEV: 'true',
    MCP_JWKS_URL: 'http://keycloak:8080/certs', MCP_TOKEN_ENDPOINT_URL: 'http://keycloak:8080/token' });
  assert.equal(result.resourceUrl, config.resourceUrl);
  assert.equal(result.issuerUrl, config.issuerUrl);
});

test('unit: valid token returns only verified actor fields; openid is ignored', async () => {
  const actor = await verifier.verify(await signed());
  assert.equal(actor.subject, 'synthetic-employee');
  assert.equal(actor.clientId, 'external-reader');
  assert.deepEqual(actor.scopes, ['mcp', 'mcp:orders:read']);
  requireScope(actor, 'mcp:orders:read');
  assert.throws(() => requireScope(actor, 'mcp:agenda:read:team'), safeError(403, 'insufficient_scope'));
});

for (const [name, claims, algorithm] of [
  ['API-only audience', { aud: [...API_AUDIENCES] }],
  ['canonical resource without exchange requester', { aud: 'http://127.0.0.1:3006/mcp' }],
  ['requester without canonical resource', { aud: 'autonexus-mcp-server' }],
  ['API audience added to MCP pair', { aud: ['http://127.0.0.1:3006/mcp', 'autonexus-mcp-server', 'autonexus-operations-api'] }],
  ['mixed audience', { aud: ['autonexus-operations-api', 'http://127.0.0.1:3006/mcp'] }],
  ['wrong issuer', { iss: 'https://untrusted.test/realm' }],
  ['expired', { exp: now() - 60 }],
  ['missing exp', { exp: undefined }],
  ['future not-before', { nbf: now() + 600 }],
  ['wrong typ', { typ: 'ID' }],
  ['empty subject', { sub: '' }],
  ['missing azp', { azp: undefined }],
  ['HS256 algorithm', {}, 'HS256'],
]) test(`unit: rejects ${name}`, async () => {
  await assert.rejects(verifier.verify(await signed(claims, algorithm)), safeError(401, 'invalid_token'));
});

for (const scope of ['mcp admin', 'mcp mcp:unknown', 'mcp  mcp:orders:read', ['mcp'], 'openid',
  'mcp mcp', 'mcp\tmcp:orders:read', 'mcp roles']) {
  test(`unit: strict scope syntax and closed vocabulary case ${JSON.stringify(scope)}`, async () => {
    await assert.rejects(verifier.verify(await signed({ scope })), safeError(403, 'insufficient_scope'));
  });
}

test('unit: registry reload immediately suspends a previously valid client', async () => {
  const token = await signed();
  await verifier.verify(token);
  await writeRegistry([client({ enabled: false })]);
  await assert.rejects(verifier.verify(token), safeError(403, 'client_forbidden'));
});
test('unit: registry CRUD is serialized, atomic, allowlist-only and never stores OAuth secrets', async () => {
  const entry = { clientId: 'chatgpt-static-client', displayName: 'ChatGPT workshop app', enabled: true,
    scopes: ['mcp', 'mcp:appointments:request'] };
  const outcomes = await Promise.allSettled([registry.create(entry), registry.create(entry)]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(item => item.status === 'rejected').length, 1);
  assert.deepEqual((await registry.list()).find(item => item.clientId === entry.clientId), entry);
  assert.equal((await registry.list()).length, 2);
  await assert.rejects(registry.upsert({ ...entry, scopes: ['mcp', 'admin'] }));
  await registry.update({ ...entry, displayName: 'ChatGPT limited app', scopes: ['mcp', 'mcp:appointments:request:read'] });
  await registry.setEnabled(entry.clientId, false);
  await assert.rejects(registry.authorize(entry.clientId, ['mcp']), safeError(403, 'client_forbidden'));
  await registry.setEnabled(entry.clientId, true);
  await registry.authorize(entry.clientId, ['mcp:appointments:request:read']);
  await registry.revoke(entry.clientId);
  await assert.rejects(registry.authorize(entry.clientId, ['mcp']), safeError(403, 'client_forbidden'));
  const stored = JSON.stringify(await readPrivateJson(config.clientRegistryFile));
  for (const secret of ['clientSecret', 'client_secret', 'access_token', 'refresh_token']) assert.ok(!stored.includes(secret));
});
test('unit: ordinary OIDC profile and email scopes do not grant MCP authority', async () => {
  const actor = await verifier.verify(await signed({ scope: 'openid profile email mcp' }));
  assert.deepEqual(actor.scopes, ['mcp']);
  assert.throws(() => requireScope(actor, 'mcp:orders:read'), safeError(403, 'insufficient_scope'));
});
test('unit: unregistered azp and excess allowed scopes fail closed', async () => {
  await assert.rejects(verifier.verify(await signed({ azp: 'unknown-client' })), safeError(403, 'client_forbidden'));
  await writeRegistry([client({ scopes: ['mcp'] })]);
  await assert.rejects(verifier.verify(await signed()), safeError(403, 'insufficient_scope'));
});
for (const document of [ { version: 2, clients: [] }, { version: 1, clients: [], extra: true },
  { version: 1, clients: [client({ role: 'admin' })] }, { version: 1, clients: [client(), client()] },
  { version: 1, clients: [client({ scopes: ['admin'] })] },
  { version: 1, clients: Array.from({ length: 33 }, (_, i) => client({ clientId: `reader-${i}` })) },
]) test('unit: malformed or excessive registry cannot authorize', async () => {
  await writeFile(config.clientRegistryFile, JSON.stringify(document));
  await assert.rejects(verifier.verify(await signed()), safeError(503, 'registry_unavailable'));
});
test('unit: missing registry is a sanitized unavailable error', async () => {
  await rm(config.clientRegistryFile);
  await assert.rejects(verifier.verify(await signed()), safeError(503, 'registry_unavailable'));
});
test('unit: IdP/JWKS unavailable is a sanitized dependency error', async () => {
  jwksStatus = 503;
  await assert.rejects(verifier.verify(await signed()), safeError(503, 'identity_unavailable'));
});

test('unit: standard exchange repeats both audience fields and preserves delegated identity', async () => {
  const actor = await verifier.verify(await signed());
  const result = await new KeycloakTokenExchange(config, verifier).exchange(actor);
  assert.ok(result !== actor.token);
  assert.deepEqual(seenForm.getAll('audience'), [...API_AUDIENCES]);
  assert.equal(seenForm.get('grant_type'), 'urn:ietf:params:oauth:grant-type:token-exchange');
  assert.equal(seenForm.get('subject_token_type'), tokenType);
  assert.equal(seenForm.get('requested_token_type'), tokenType);
  assert.equal(seenForm.get('client_id'), 'autonexus-mcp-server');
  assert.ok(seenForm.get('subject_token') === actor.token);
  assert.ok(seenForm.get('client_secret') === 'synthetic-sensitive-marker');
  assert.equal(seenForm.has('scope'), false);
  assert.equal(seenForm.has('requested_subject'), false);
  assert.equal(seenForm.has('refresh_token'), false);
  await assert.rejects(verifier.verify(result), safeError(401, 'invalid_token'));
});
for (const [name, claims] of [
  ['changed subject', { sub: 'another-person' }], ['changed requester', { azp: 'external-reader' }],
  ['extended lifetime', { exp: now() + 600 }], ['missing employee audience', { aud: API_AUDIENCES[0] }],
  ['wrong issuer', { iss: 'https://untrusted.test/realm' }], ['wrong token typ', { typ: 'ID' }],
  ['expired exchange', { exp: now() - 60 }],
]) test(`unit: exchange rejects ${name} as an authentication failure`, async () => {
  exchangeResult.access_token = await signed({ aud: [...API_AUDIENCES], azp: 'autonexus-mcp-server', ...claims });
  await assert.rejects(new KeycloakTokenExchange(config, verifier).exchange(await verifier.verify(await signed())),
    safeError(401, 'invalid_token'));
});
for (const [name, response] of [
  ['refresh token', { refresh_token: 'sensitive-marker' }],
  ['wrong response token type', { token_type: 'DPoP' }],
  ['wrong issued type', { issued_token_type: 'refresh_token' }],
]) test(`unit: exchange rejects ${name}`, async () => {
  exchangeResult = { ...exchangeResult, ...response };
  await assert.rejects(new KeycloakTokenExchange(config, verifier).exchange(await verifier.verify(await signed())),
    safeError(503, 'identity_unavailable'));
});
test('unit: exchange sanitizes raw upstream errors and oversized response', async () => {
  const actor = await verifier.verify(await signed());
  for (const [status, body] of [[400, 'sensitive-marker'], [200, 'x'.repeat(65537)], [200, 'sensitive-marker']]) {
    exchangeStatus = status; exchangeResult = body;
    await assert.rejects(new KeycloakTokenExchange(config, verifier).exchange(actor), safeError(503, 'identity_unavailable'));
  }
});
test('unit: exchange reloads registry and never exchanges for suspended client', async () => {
  const actor = await verifier.verify(await signed());
  await writeRegistry([client({ enabled: false })]);
  await assert.rejects(new KeycloakTokenExchange(config, verifier).exchange(actor), safeError(403, 'client_forbidden'));
  assert.equal(seenForm, undefined);
});
test('unit: malformed and incorrectly signed JWTs are invalid, not dependency failures', async () => {
  const otherPair = await generateKeyPair('RS256');
  const incorrectSignature = await new SignJWT({ iss: config.issuerUrl, aud: config.resourceUrl,
    sub: 'synthetic-employee', azp: 'external-reader', typ: 'Bearer', exp: now() + 60, scope: 'mcp' })
    .setProtectedHeader({ alg: 'RS256', kid: 'unit-rsa' }).sign(otherPair.privateKey);
  for (const token of ['not-a-jwt', incorrectSignature]) {
    await assert.rejects(verifier.verify(token), safeError(401, 'invalid_token'));
  }
});
test('unit: missing private requester file is sanitized and never sends an exchange', async () => {
  const missingConfig = { ...config, idpClientFile: join(directory, 'absent.json') };
  await assert.rejects(new KeycloakTokenExchange(missingConfig, verifier).exchange(await verifier.verify(await signed())),
    safeError(503, 'identity_unavailable'));
  assert.equal(seenForm, undefined);
});
test('unit: no exchange token cache spans calls or actors', async () => {
  const exchange = new KeycloakTokenExchange(config, verifier);
  const first = await verifier.verify(await signed());
  await exchange.exchange(first);
  const second = await verifier.verify(await signed({ sub: 'synthetic-second-employee' }));
  exchangeResult.access_token = await signed({ sub: second.subject, aud: [...API_AUDIENCES], azp: 'autonexus-mcp-server' });
  await exchange.exchange(second);
  assert.ok(seenForm.get('subject_token') === second.token);
});
