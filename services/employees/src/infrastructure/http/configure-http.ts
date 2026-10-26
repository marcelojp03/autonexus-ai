import type { NestExpressApplication } from '@nestjs/platform-express';
import { authEnvironment, type AuthConfiguration } from '../config/auth-environment.js';

export function configureHttp(app: NestExpressApplication, config: AuthConfiguration = authEnvironment()): void {
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.enableCors({
    origin: config.origins,
    methods: ['GET', 'OPTIONS'],
    allowedHeaders: ['Authorization'],
    credentials: false,
  });
}
