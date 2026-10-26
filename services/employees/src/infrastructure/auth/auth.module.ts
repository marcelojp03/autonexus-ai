import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { authEnvironment } from '../config/auth-environment.js';
import { AccessTokenVerifier } from './access-token-verifier.js';
import { JwtPolicyGuard } from './jwt-policy.guard.js';

@Module({
  providers: [
    { provide: AccessTokenVerifier, useFactory: () => new AccessTokenVerifier(authEnvironment()) },
    { provide: APP_GUARD, useClass: JwtPolicyGuard },
  ],
})
export class AuthModule {}
