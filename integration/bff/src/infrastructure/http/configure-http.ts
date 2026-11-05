import type { NestExpressApplication } from '@nestjs/platform-express';
import type { BffConfiguration } from '../config/environment.js';

export function configureHttp(app: NestExpressApplication, config: BffConfiguration): void {
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use('/graphql', (_request: unknown, response: import('express').Response, next: () => void) => {
    response.setHeader('Cache-Control', 'no-store, private');
    response.setHeader('Pragma', 'no-cache');
    next();
  });
  app.enableCors({
    origin: [...config.origins],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: false,
    maxAge: 600,
  });
}
