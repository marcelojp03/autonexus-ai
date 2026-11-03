import 'reflect-metadata';
import { setDefaultResultOrder } from 'node:dns';

// The AWS SDK resolves the DynamoDB endpoint with the default result order; inside the container
// the IPv6 candidate never answers, so the request hangs instead of falling back. Prefer IPv4.
setDefaultResultOrder('ipv4first');

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import type { OverlayRepository } from './application/ports.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  // DynamoDB Local has no migrations: create the table once, retrying while the emulator warms up.
  const repository = app.get<OverlayRepository>('OVERLAY_REPOSITORY');
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await repository.ensureTable();
      break;
    } catch (error) {
      if (attempt === 29) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  app.enableShutdownHooks();
  const port = Number(process.env['PORT'] ?? 3005);
  await app.listen(port, process.env['HTTP_HOST'] ?? '127.0.0.1');
  // Readiness is checked by the container healthcheck; keep the log line stable for scripts.
  console.log(JSON.stringify({ service: 'sync', status: 'started', port }));
}

await bootstrap();
