import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureHttp } from './infrastructure/http/configure-http.js';
import { AppModule } from './app.module.js';
import { databaseEnvironment, httpEnvironment, loadLocalEnvironment } from './infrastructure/config/environment.js';

async function bootstrap() {
  loadLocalEnvironment();
  databaseEnvironment();
  const { host, port } = httpEnvironment();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureHttp(app);
  app.enableShutdownHooks();
  await app.listen(port, host);
}

bootstrap().catch(() => {
  console.error('Employees startup failed; verify configuration and local port availability.');
  process.exitCode = 1;
});
