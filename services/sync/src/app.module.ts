import { Module } from '@nestjs/common';

import { PushOverlay } from './application/push-overlay.js';
import type { OverlayRepository, OwnerClient } from './application/ports.js';
import { TokenVerifier } from './infrastructure/auth/token-verifier.js';
import { DynamoOverlayRepository, type DynamoConfiguration } from './infrastructure/dynamodb/dynamo-overlay-repository.js';
import { HealthController } from './infrastructure/http/health.controller.js';
import { SyncController } from './infrastructure/http/sync.controller.js';
import { HttpOwnerClient } from './infrastructure/owners/http-owner-client.js';

export const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Invalid configuration: ${name}`);
  return value;
};

export const configuration = () => ({
  port: Number(process.env['PORT'] ?? 3005),
  issuer: required('OIDC_ISSUER_URI'),
  jwksUri: required('OIDC_JWKS_URI'),
  audiences: required('OIDC_AUDIENCES').split(',').map(value => value.trim()),
  dynamo: {
    table: process.env['SYNC_TABLE'] ?? 'sync_overlays',
    region: process.env['AWS_REGION'] ?? 'us-east-1',
    ...(process.env['DYNAMODB_ENDPOINT'] ? { endpoint: process.env['DYNAMODB_ENDPOINT'] } : {}),
  } satisfies DynamoConfiguration,
  owners: { operationsUrl: required('OPERATIONS_API_URL'), intelligenceUrl: required('INTELLIGENCE_API_URL') },
});

@Module({
  controllers: [HealthController, SyncController],
  providers: [
    { provide: 'SYNC_CONFIGURATION', useFactory: configuration },
    {
      provide: TokenVerifier,
      inject: ['SYNC_CONFIGURATION'],
      useFactory: (config: ReturnType<typeof configuration>) => new TokenVerifier(config.issuer, config.jwksUri, config.audiences),
    },
    {
      provide: 'OVERLAY_REPOSITORY',
      inject: ['SYNC_CONFIGURATION'],
      useFactory: (config: ReturnType<typeof configuration>) => new DynamoOverlayRepository(config.dynamo),
    },
    {
      provide: 'OWNER_CLIENT',
      inject: ['SYNC_CONFIGURATION'],
      useFactory: (config: ReturnType<typeof configuration>) => new HttpOwnerClient(config.owners),
    },
    {
      provide: PushOverlay,
      inject: ['OVERLAY_REPOSITORY', 'OWNER_CLIENT'],
      useFactory: (repository: OverlayRepository, owner: OwnerClient) => new PushOverlay(repository, owner),
    },
  ],
})
export class AppModule {}
