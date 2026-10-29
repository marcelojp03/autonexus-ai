import { UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { BffConfiguration } from '../config/environment.js';

export const WORKSHOP_ROLES = ['administrador', 'recepcionista', 'mecanico', 'jefe_taller', 'responsable_financiero'] as const;
export type WorkshopRole = (typeof WORKSHOP_ROLES)[number];
export interface VerifiedIdentity {
  readonly subject: string;
  readonly roles: readonly string[];
}
export interface AuthenticatedRequest extends Record<string, unknown> {
  headers: Record<string, string | string[] | undefined>;
  rawHeaders: string[];
  identity?: VerifiedIdentity;
}

/** Validates only what the BFF forwards: a real Employees-scoped user access token. */
export class AccessTokenVerifier {
  private keyResolver?: JWTVerifyGetKey;

  constructor(
    private readonly config: Pick<BffConfiguration, 'issuer' | 'audience'>,
    keyResolver?: JWTVerifyGetKey,
  ) {
    this.keyResolver = keyResolver;
  }

  async verify(token: string): Promise<VerifiedIdentity> {
    try {
      this.keyResolver ??= createRemoteJWKSet(new URL(`${this.config.issuer}/protocol/openid-connect/certs`), {
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
      // Preserve CU02 custom roles; business authority comes from the owner catalog.
      const roles = Array.isArray(realmRoles)
        ? [...new Set(realmRoles.filter((role): role is string => typeof role === 'string' && /^[a-z][a-z0-9_]{2,63}$/.test(role)))]
        : [];
      return Object.freeze({ subject: payload.sub, roles: Object.freeze(roles) });
    } catch {
      throw new UnauthorizedException();
    }
  }
}
