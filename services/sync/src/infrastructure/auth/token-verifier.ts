/** MS05 token verification: the same user token the Shell issues; nothing is stored. */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

import { SyncError } from '../../domain/overlay.js';

export interface SyncIdentity {
  readonly subject: string;
  readonly roles: readonly string[];
  readonly token: string;
}

export class TokenVerifier {
  private readonly jwks;

  constructor(
    private readonly issuer: string,
    jwksUri: string,
    private readonly audiences: readonly string[],
  ) {
    this.jwks = createRemoteJWKSet(new URL(jwksUri), { timeoutDuration: 2000, cooldownDuration: 30000 });
  }

  async verify(authorization: string | undefined): Promise<SyncIdentity> {
    if (!authorization?.toLowerCase().startsWith('bearer ')) throw new SyncError(401, 'UNAUTHENTICATED');
    const token = authorization.slice(7).trim();
    let payload: JWTPayload;
    try {
      const result = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        algorithms: ['RS256'],
        clockTolerance: 5,
        // The shell token carries the audience of every owner; accepting any of them keeps the same
        // identity model without inventing a fifth audience for the coordinator.
        audience: [...this.audiences],
      });
      payload = result.payload;
    } catch (error) {
      throw new SyncError(401, 'UNAUTHENTICATED', String((error as Error).message).slice(0, 80));
    }
    if (typeof payload.sub !== 'string' || !payload.sub) throw new SyncError(401, 'UNAUTHENTICATED');
    if (String(payload['typ'] ?? '').toLowerCase() !== 'bearer') throw new SyncError(401, 'UNAUTHENTICATED');
    const realm = payload['realm_access'] as { roles?: unknown } | undefined;
    const roles = Array.isArray(realm?.roles) ? realm!.roles.filter((role): role is string => typeof role === 'string') : [];
    if (roles.length === 0) throw new SyncError(403, 'FORBIDDEN');
    return { subject: payload.sub, roles, token };
  }
}
