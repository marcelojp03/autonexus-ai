import { UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { AuthConfiguration } from '../config/auth-environment.js';
import type { VerifiedIdentity } from './auth-policy.js';

export class AccessTokenVerifier {
  private keyResolver?: JWTVerifyGetKey;

  constructor(private readonly config: AuthConfiguration, keyResolver?: JWTVerifyGetKey) {
    this.keyResolver = keyResolver;
  }

  async verify(token: string): Promise<VerifiedIdentity> {
    try {
      this.keyResolver ??= createRemoteJWKSet(new URL(this.config.issuer + '/protocol/openid-connect/certs'), {
        timeoutDuration: 2000,
        cooldownDuration: 30000,
        cacheMaxAge: 600000,
      });
      const { payload } = await jwtVerify(token, this.keyResolver, {
        algorithms: ['RS256'],
        issuer: this.config.issuer,
        audience: this.config.audience,
        requiredClaims: ['sub', 'iss', 'aud', 'exp'],
        clockTolerance: 5,
      });
      if (payload.typ !== 'Bearer' || !payload.sub?.trim()) throw new Error('Invalid access token');
      const access = payload.realm_access;
      const realmRoles = typeof access === 'object' && access !== null && 'roles' in access ? access.roles : undefined;
      const roles = Array.isArray(realmRoles)
        ? [...new Set(realmRoles.filter((role): role is string => typeof role === 'string' && /^[a-z][a-z0-9_]{2,63}$/.test(role)))]
        : [];
      return { subject: payload.sub, roles, permissions: [], recognized: [] };
    } catch {
      throw new UnauthorizedException();
    }
  }
}
