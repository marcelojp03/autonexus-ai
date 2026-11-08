import 'reflect-metadata';
import { Controller, Post, Body } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { configureHttp } from './configure-http.js';
import { bffEnvironment } from '../config/environment.js';

@Controller('graphql')
class JsonFixture { @Post() echo(@Body() body: unknown): unknown { return body; } }

describe('HTTP configuration synthetic Nest fixture', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [JsonFixture] }).compile();
    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureHttp(app, { ...bffEnvironment({}), origins: ['http://127.0.0.1:4200'] });
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  it('adds PUT and the grant header only for approved origins without credentials', async () => {
    const res = await request(app.getHttpServer()).options('/finance-files/documents/id/content').set('Origin', 'http://127.0.0.1:4200').set('Access-Control-Request-Method', 'PUT').set('Access-Control-Request-Headers', 'X-Finance-Grant,Content-Type').expect(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:4200');
    expect(res.headers['access-control-allow-methods']).toContain('PUT');
    expect(res.headers['access-control-allow-headers']).toContain('X-Finance-Grant');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    const denied = await request(app.getHttpServer()).options('/finance-files/documents/id/content').set('Origin', 'http://unapproved.invalid').set('Access-Control-Request-Method', 'PUT');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('preserves GraphQL JSON parsing and private no-store headers', async () => {
    const res = await request(app.getHttpServer()).post('/graphql').send({ query: 'synthetic' }).expect(201);
    expect(res.body).toEqual({ query: 'synthetic' });
    expect(res.headers['cache-control']).toBe('no-store, private');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
  it('keeps the edge binary limit isolated and disables buffering and access logging (static configuration check)', () => {
    const nginx = readFileSync(new URL('../../../../../infra/local/nginx.conf', import.meta.url), 'utf8');
    const binary = nginx.slice(nginx.indexOf('    location ~ "^/finance-files/'), nginx.indexOf('    location = /identity'));
    expect(binary).toContain('http://bff:3004');
    expect(binary).toContain('client_max_body_size 5m;');
    expect(binary).toContain('access_log off;');
    expect(binary).toContain('proxy_request_buffering off;');
    expect(binary).toContain('client_body_timeout 15s;');
    expect(binary).toContain('proxy_read_timeout 35s;');
    expect(nginx.slice(0, nginx.indexOf('    location ~ "^/finance-files/'))).toContain('client_max_body_size 1m;');
  });
});
