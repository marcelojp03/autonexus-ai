import type { NestExpressApplication } from '@nestjs/platform-express';
import type { BffConfiguration } from '../config/environment.js';
import { financeFileError, financeFileHeaders, financeFileValidation } from './finance-files.controller.js';

export function configureHttp(app: NestExpressApplication, config: BffConfiguration): void {
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use('/graphql', (_request: unknown, response: import('express').Response, next: () => void) => {
    response.setHeader('Cache-Control', 'no-store, private');
    response.setHeader('Pragma', 'no-cache');
    next();
  });
  app.enableCors({
    origin: [...config.origins],
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Finance-Grant'],
    credentials: false,
    maxAge: 600,
  });
  // Runs before Nest's JSON/urlencoded parsers; image bodies stay as bounded streams.
  app.use('/finance-files', (req: import('express').Request, res: import('express').Response, next: () => void) => {
    financeFileHeaders(res);
    const invalid = financeFileValidation(req);
    if (invalid) { financeFileError(res, invalid); return; }
    next();
  });
}
