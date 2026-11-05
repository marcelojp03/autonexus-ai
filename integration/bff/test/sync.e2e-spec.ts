import { createServer, type Server } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AccessTokenVerifier } from '../src/infrastructure/auth/token-verifier.js';
import { HttpEmployeesGateway } from '../src/application/employees-gateway.js';
import { configureHttp } from '../src/infrastructure/http/configure-http.js';
import { bffEnvironment } from '../src/infrastructure/config/environment.js';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const FIELDS = 'operationId overlayId entity state attemptCount lastStatus lastCode resultJson';
const LOOKUP = 'query($id: UUID!) { offlineSyncOperation(operationId: $id) { overlayId operation { ' + FIELDS + ' } } }';

describe('CU27 HTTP wiring with signed synthetic JWT and explicit HTTP coordinator fixture', () => {
  let app: NestExpressApplication;
  let upstream: Server;
  let mechanic: string;
  let other: string;
  let unknown: string;
  let wrongAudience: string;
  const calls: { path: string; token: string; body: unknown }[] = [];
  let pushed = false;
  const permissions = vi.fn(async () => ({ effective: [] }));

  beforeAll(async () => {
    const config = bffEnvironment({});
    const keys = await generateKeyPair('RS256');
    const jwk = await exportJWK(keys.publicKey);
    const sign = (subject: string, roles: string[], audience = config.audience) => new SignJWT({ typ: 'Bearer', realm_access: { roles } })
      .setProtectedHeader({ alg: 'RS256' }).setSubject(subject).setIssuer(config.issuer).setAudience(audience).setExpirationTime('5m').sign(keys.privateKey);
    mechanic = await sign('mechanic', ['mecanico']);
    other = await sign('other', ['mecanico']);
    unknown = await sign('unknown', []);
    wrongAudience = await sign('mechanic', ['mecanico'], 'not-bff');
    upstream = createServer(async (req, res) => {
      let text = '';
      for await (const chunk of req) text += String(chunk);
      calls.push({ path: req.url!, token: req.headers.authorization!, body: text ? JSON.parse(text) : null });
      res.setHeader('Content-Type', 'application/json');
      if (req.headers.authorization === 'Bearer ' + other) {
        res.statusCode = 404;
        res.end(JSON.stringify({ code: req.url!.includes('/operations/') ? 'OPERATION_NOT_FOUND' : 'OVERLAY_NOT_FOUND' }));
        return;
      }
      const operation = { operationId: ID, overlayId: ID, entity: 'evidence-authorize', state: pushed ? 'applied' : 'pending', attempts: pushed ? [{}] : [],
        lastBody: pushed ? { evidenceId: OTHER, version: 3, upload: { url: '[redacted]' } } : undefined };
      const overlay = { overlayId: ID, deviceId: 'pwa', createdAt: '2026-11-04T12:00:00Z', operations: [operation] };
      let body: unknown;
      if (req.url!.endsWith('/push')) {
        const results = pushed ? [] : [{ operationId: ID, status: 201, body: { evidenceId: OTHER, upload: { url: 'ephemeral-signed-url' } } }];
        pushed = true;
        body = { overlayId: ID, operations: [{ ...operation, state: 'applied' }], applied: [ID], pending: [], failed: [], results };
      } else if (req.url!.includes('/operations/')) body = { operation };
      else body = { overlay, replayed: false, replayedOperations: [] };
      res.end(JSON.stringify(body));
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address() as { port: number };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider('BFF_CONFIGURATION').useValue({ ...config, syncUrl: 'http://127.0.0.1:' + address.port })
      .overrideProvider(AccessTokenVerifier).useValue(new AccessTokenVerifier(config, createLocalJWKSet({ keys: [jwk] })))
      .overrideProvider(HttpEmployeesGateway).useValue({ permissions, reachable: async () => true }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    configureHttp(app, config);
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await new Promise<void>((resolve, reject) => upstream?.close(error => error ? reject(error) : resolve()));
  });
  const post = (query: string, token = mechanic, variables: unknown = { id: ID }) => request(app.getHttpServer()).post('/graphql')
    .set('Authorization', 'Bearer ' + token).send({ query, variables });

  it('registers and reads through the production gateway without unrelated owner permissions', async () => {
    const input = { overlayId: ID, deviceId: 'pwa', createdAt: '2026-11-04T12:00:00Z', operationsJson: JSON.stringify([{ operationId: ID, entity: 'advance' }]) };
    const registered = await post('mutation($input: RegisterOfflineSyncInput!) { registerOfflineSync(input: $input) { replayed replayedOperations overlay { overlayId operations { ' + FIELDS + ' } } } }', mechanic, { input });
    expect(registered.body.errors).toBeUndefined();
    expect(calls.at(-1)?.body).toEqual({ overlayId: ID, deviceId: 'pwa', createdAt: input.createdAt, operations: JSON.parse(input.operationsJson) });
    const read = await post('query($id: UUID!) { offlineSyncOverlay(overlayId: $id) { overlayId operations { state } } }');
    expect(read.body.data.offlineSyncOverlay.overlayId).toBe(ID);
    expect(calls.at(-1)?.token).toBe('Bearer ' + mechanic);
    expect(permissions).not.toHaveBeenCalled();
  });

  it('returns signed results only on the live push, with no-store headers and recoverable durable lookup', async () => {
    const query = 'mutation($id: UUID!) { pushOfflineSync(overlayId: $id) { overlayId applied pending failed { operationId state code status } operations { ' + FIELDS + ' } resultsJson } }';
    const first = await post(query);
    expect(first.body.errors).toBeUndefined();
    expect(first.headers['cache-control']).toBe('no-store, private');
    expect(first.headers.pragma).toBe('no-cache');
    expect(first.body.data.pushOfflineSync.resultsJson).toContain('ephemeral-signed-url');
    const replay = await post(query);
    expect(replay.body.data.pushOfflineSync.resultsJson).toBe('[]');
    const lookup = await post(LOOKUP);
    expect(lookup.body.data.offlineSyncOperation).toMatchObject({ overlayId: ID, operation: { overlayId: ID, state: 'applied' } });
    expect(JSON.parse(lookup.body.data.offlineSyncOperation.operation.resultJson)).toMatchObject({ evidenceId: OTHER, version: 3, upload: { url: '[redacted]' } });
    expect(JSON.stringify(lookup.body)).not.toContain('ephemeral-signed-url');
    expect(lookup.headers['cache-control']).toContain('no-store');
  });

  it('does not expose another subject overlay or operation', async () => {
    for (const query of [LOOKUP, 'query($id: UUID!) { offlineSyncOverlay(overlayId: $id) { overlayId } }', 'mutation($id: UUID!) { pushOfflineSync(overlayId: $id) { overlayId } }']) {
      const response = await post(query, other);
      expect(response.body.errors[0].extensions.statusCode).toBe(404);
      expect(response.body.data).toBeUndefined();
    }
  });

  it('denies missing, roleless and wrong audience tokens before contacting MS05', async () => {
    const count = calls.length;
    await request(app.getHttpServer()).post('/graphql').send({ query: LOOKUP, variables: { id: ID } }).expect(401);
    await post(LOOKUP, unknown).expect(403);
    await post(LOOKUP, wrongAudience).expect(401);
    expect(calls).toHaveLength(count);
  });

  it('retains the closed root allowlist and rejects client URL arguments and hidden roots', async () => {
    const count = calls.length;
    for (const query of ['{ arbitrarySync { state } }', '{ __schema { queryType { name } } }',
      '{ ... on Query { offlineSyncOverlay(overlayId: "' + ID + '") { overlayId } } }',
      '{ offlineSyncOverlay(overlayId: "' + ID + '", url: "http://client.invalid") { overlayId } }']) {
      const response = await post(query);
      expect(response.body.errors[0].extensions.code).toBe('BAD_REQUEST');
    }
    expect(calls).toHaveLength(count);
  });
});
