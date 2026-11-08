import 'reflect-metadata';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { FinanceFilesController } from './finance-files.controller.js';
import { configureHttp } from './configure-http.js';
import { bffEnvironment } from '../config/environment.js';

const PATH = '/finance-files/documents/11111111-1111-4111-8111-111111111111/content';
const GRANT = 'a'.repeat(64);
const IMAGE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

describe('finance binary proxy (synthetic Nest HTTP and fake owner only)', () => {
  let app: NestExpressApplication;
  let owner: Server;
  let mode = 'ok';
  const calls: { path: string; headers: import('node:http').IncomingHttpHeaders; bytes: Buffer }[] = [];
  beforeAll(async () => {
    owner = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      calls.push({ path: req.url!, headers: req.headers, bytes: Buffer.concat(chunks) });
      if (mode === 'stall') return;
      if (mode === 'redirect') { res.writeHead(302, { Location: 'http://127.0.0.1:1/never' }); res.end(); return; }
      if (mode === 'denied') { res.writeHead(403); res.end('private grant ' + GRANT); return; }
      if (mode === 'large') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(Buffer.alloc(5242881)); return; }
      if (mode === 'large-length') { res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': '5242881' }); res.flushHeaders(); return; }
      if (mode === 'type') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('bad'); return; }
      if (mode === 'drip') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.write(IMAGE); return; }
      if (mode === 'truncated') { res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': '100' }); res.end(IMAGE); return; }
      res.setHeader('Set-Cookie', 'must-not-forward=1');
      if (req.method === 'PUT') { res.writeHead(204); res.end(); }
      else { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(IMAGE); }
    });
    await new Promise<void>(resolve => owner.listen(0, '127.0.0.1', resolve));
    const config = { ...bffEnvironment({}), financeUrl: 'http://127.0.0.1:' + (owner.address() as { port: number }).port };
    const module = await Test.createTestingModule({ controllers: [FinanceFilesController], providers: [
      { provide: 'BFF_CONFIGURATION', useValue: config },
      { provide: 'FINANCE_FILES_TIMEOUT_MS', useValue: 1000 },
    ] }).compile();
    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureHttp(app, config);
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => { await app?.close(); owner?.closeAllConnections(); await new Promise<void>(resolve => owner.close(() => resolve())); });
  beforeEach(() => { mode = 'ok'; calls.length = 0; });

  it('preserves exact upload bytes, length and grant without identity', async () => {
    await request(app.getHttpServer()).put(PATH).set('X-Finance-Grant', GRANT).set('Content-Type', 'image/png').send(IMAGE).expect(204);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe(PATH);
    expect(calls[0]!.bytes).toEqual(IMAGE);
    expect(calls[0]!.headers).toMatchObject({ 'content-length': String(IMAGE.length), 'content-type': 'image/png', 'x-finance-grant': GRANT });
    expect(calls[0]!.headers.authorization).toBeUndefined();
    expect(calls[0]!.headers.cookie).toBeUndefined();
  });
  it('downloads only bytes and safe response headers', async () => {
    const res = await request(app.getHttpServer()).get(PATH).set('X-Finance-Grant', GRANT).expect(200);
    expect(res.body).toEqual(IMAGE);
    expect(res.headers).toMatchObject({ 'cache-control': 'no-store, private', 'x-content-type-options': 'nosniff', 'content-disposition': 'attachment' });
    expect(res.headers['set-cookie']).toBeUndefined();
  });
  it('accepts exactly 5 MiB and JPEG content type', async () => {
    const bytes = Buffer.alloc(5242880, 42);
    await request(app.getHttpServer()).put(PATH).set('X-Finance-Grant', GRANT).set('Content-Type', 'image/jpeg').send(bytes).expect(204);
    expect(calls[0]!.bytes.equals(bytes)).toBe(true);
    expect(calls[0]!.headers['content-length']).toBe('5242880');
  });
  it.each(['Authorization', 'Cookie'])('rejects incoming %s without contacting owner', async header => {
    await request(app.getHttpServer()).get(PATH).set('X-Finance-Grant', GRANT).set(header, 'forbidden').expect(400);
    expect(calls).toHaveLength(0);
  });
  it.each([PATH + '?url=http://127.0.0.1:1', PATH.replace('11111111-1111-4111-8111-111111111111', 'not-a-uuid'), PATH + '/'])('rejects noncanonical target %s', async path => {
    await request(app.getHttpServer()).get(path).set('X-Finance-Grant', GRANT).expect(400);
    expect(calls).toHaveLength(0);
  });
  it.each(['post', 'delete', 'head'] as const)('rejects %s', async method => {
    await request(app.getHttpServer())[method](PATH).set('X-Finance-Grant', GRANT).expect(405);
    expect(calls).toHaveLength(0);
  });
  it.each(['', 'a'.repeat(63), 'g'.repeat(64), GRANT + ', ' + GRANT])('rejects malformed grant', async grant => {
    await request(app.getHttpServer()).get(PATH).set('X-Finance-Grant', grant).expect(400);
    expect(calls).toHaveLength(0);
  });
  it('rejects wrong upload type and oversized declared body before reading', async () => {
    await request(app.getHttpServer()).put(PATH).set('X-Finance-Grant', GRANT).set('Content-Type', 'application/json').send('{}').expect(400);
    await request(app.getHttpServer()).put(PATH).set('X-Finance-Grant', GRANT).set('Content-Type', 'image/png').set('Content-Length', '5242881').expect(413);
    expect(calls).toHaveLength(0);
  });
  it('rejects GET bodies and missing upload length', async () => {
    await request(app.getHttpServer()).get(PATH).set('X-Finance-Grant', GRANT).send('x').expect(400);
    await request(app.getHttpServer()).put(PATH).set('X-Finance-Grant', GRANT).set('Content-Type', 'image/png').expect(400);
    expect(calls).toHaveLength(0);
  });
  it.each([['redirect', 502], ['denied', 403], ['large', 502], ['large-length', 502], ['type', 502], ['stall', 504], ['drip', 504], ['truncated', 502]] as const)('sanitizes and bounds owner %s', async (value, status) => {
    mode = value;
    const res = await request(app.getHttpServer()).get(PATH).set('X-Finance-Grant', GRANT).expect(status);
    expect(res.text).not.toContain(GRANT);
    expect(res.headers.location).toBeUndefined();
  });
  it('times out an incomplete incoming body without waiting for stream end', async () => {
    const address = app.getHttpServer().address() as { port: number };
    const status = await new Promise<number>(resolve => {
      const req = httpRequest({ host: '127.0.0.1', port: address.port, path: PATH, method: 'PUT', headers: { 'X-Finance-Grant': GRANT, 'Content-Type': 'image/png', 'Content-Length': '100' } }, res => { resolve(res.statusCode!); res.resume(); req.destroy(); });
      req.on('error', () => {});
      req.write(IMAGE);
    });
    expect(status).toBe(408);
    expect(calls).toHaveLength(0);
  });
  it('settles an aborted incoming upload and remains responsive', async () => {
    const address = app.getHttpServer().address() as { port: number };
    await new Promise<void>(resolve => {
      const req = httpRequest({ host: '127.0.0.1', port: address.port, path: PATH, method: 'PUT', headers: { 'X-Finance-Grant': GRANT, 'Content-Type': 'image/png', 'Content-Length': '100' } });
      req.on('error', () => {});
      req.once('close', resolve);
      req.flushHeaders();
      req.write(IMAGE, () => req.destroy());
    });
    await request(app.getHttpServer()).get(PATH).set('X-Finance-Grant', GRANT).expect(200);
    expect(calls).toHaveLength(1);
  });
});
