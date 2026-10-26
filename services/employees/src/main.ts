import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { databaseEnvironment, httpEnvironment, loadLocalEnvironment } from './infrastructure/config/environment.js';

async function bootstrap() {
  loadLocalEnvironment();
  databaseEnvironment();
  const { host, port } = httpEnvironment();
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(port, host);
}

bootstrap().catch(() => {
  console.error('Employees startup failed; verify configuration and local port availability.');
  process.exitCode = 1;
});
