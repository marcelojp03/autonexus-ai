import { Module } from '@nestjs/common';
import { authEnvironment } from '../config/auth-environment.js';
import { AccessTokenVerifier } from './access-token-verifier.js';

@Module({
  providers: [{ provide: AccessTokenVerifier, useFactory: () => new AccessTokenVerifier(authEnvironment()) }],
  exports: [AccessTokenVerifier],
})
export class AuthModule {}
