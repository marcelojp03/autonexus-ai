import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { bffEnvironment, loadLocalEnvironment } from './infrastructure/config/environment.js';
import { configureHttp } from './infrastructure/http/configure-http.js';

async function main(): Promise<void> {
  loadLocalEnvironment();
  const config = bffEnvironment();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'], bodyParser: true });
  
  configureHttp(app, config);
  app.enableShutdownHooks();
  await app.listen(config.port, '127.0.0.1');
}

void main();