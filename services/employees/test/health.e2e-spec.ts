import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CheckReadiness } from '../src/application/check-readiness.js';
import { HealthController } from '../src/infrastructure/http/health.controller.js';

describe('Health HTTP (explicit fake probe, not PostgreSQL integration)', () => {
  let app: INestApplication;
  const check = vi.fn<() => Promise<void>>();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: CheckReadiness, useValue: new CheckReadiness({ check }) }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => { await app.close(); });
  beforeEach(() => { check.mockReset(); });

  it('liveness is UP without consulting the database', async () => {
    check.mockRejectedValue(new Error('offline'));
    await request(app.getHttpServer()).get('/health/live').expect(200).expect({ status: 'UP' });
    expect(check).not.toHaveBeenCalled();
  });

  it('returns ready UP/200', async () => {
    check.mockResolvedValue(undefined);
    await request(app.getHttpServer()).get('/health/ready').expect(200).expect({ status: 'UP' });
    expect(check).toHaveBeenCalledOnce();
  });

  it('returns only DOWN/503 then recovers, while liveness stays UP', async () => {
    check.mockRejectedValueOnce(new Error('SQL SELECT credentials host password stack'));
    await request(app.getHttpServer()).get('/health/ready').expect(503).expect({ status: 'DOWN' });
    await request(app.getHttpServer()).get('/health/live').expect(200).expect({ status: 'UP' });
    check.mockResolvedValue(undefined);
    await request(app.getHttpServer()).get('/health/ready').expect(200).expect({ status: 'UP' });
  });
});
