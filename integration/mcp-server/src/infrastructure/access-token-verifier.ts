import { createRemoteJWKSet, customFetch, errors, jwtVerify, type JWTPayload } from 'jose';
import { AccessError, MCP_SCOPES, type ClientRegistry, type McpScope, type VerifiedActor } from '../domain/access.js';
import type { McpConfig } from './config.js';

export const API_AUDIENCES = ['autonexus-operations-api', 'autonexus-employees-api'] as const;
export const EXCHANGE_CLIENT_ID = 'autonexus-mcp-server';

export class AccessTokenVerifier {
  private readonly keys;

  constructor(private readonly config: McpConfig, private readonly registry: ClientRegistry) {
    this.keys = createRemoteJWKSet(new URL(config.jwksUrl), {
      timeoutDuration: 5000,
      [customFetch]: (url, options) => fetch(url, { ...options, redirect: 'error' }),
    });
  }

  private async claims(token: string, audiences: readonly string[]): Promise<JWTPayload> {
    if (!token || token.length > 32768) throw new AccessError('invalid_token');
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        algorithms: ['RS256'], issuer: this.config.issuerUrl, audience: [...audiences],
        requiredClaims: ['exp', 'sub', 'aud', 'iss', 'azp', 'typ'],
      });
      const actual = typeof payload.aud === 'string' ? [payload.aud] : payload.aud;
      if (!actual || actual.length !== audiences.length ||
        new Set(actual).size !== actual.length || !audiences.every(a => actual.includes(a)) ||
        payload['typ'] !== 'Bearer' || typeof payload.sub !== 'string' || !payload.sub.trim() ||
        typeof payload.exp !== 'number' || !Number.isSafeInteger(payload.exp) ||
        typeof payload['azp'] !== 'string' || !payload['azp'].trim()) {
        throw new AccessError('invalid_token');
      }
      return payload;
    } catch (error) {
      if (error instanceof AccessError) throw error;
      if (error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid ||
        !(error instanceof errors.JOSEError) ||
        (error instanceof errors.JOSEError && error.code === 'ERR_JOSE_GENERIC')) {
        throw new AccessError('identity_unavailable');
      }
      throw new AccessError('invalid_token');
    }
  }

  async verify(token: string): Promise<VerifiedActor> {
    const payload = await this.claims(token, [this.config.resourceUrl, EXCHANGE_CLIENT_ID]);
    const scope = payload['scope'];
    if (typeof scope !== 'string' || !/^[A-Za-z0-9:._-]+(?: [A-Za-z0-9:._-]+)*$/.test(scope)) {
      throw new AccessError('insufficient_scope');
    }
    const parts = scope.split(' ');
    const scopes: McpScope[] = [];
    if (new Set(parts).size !== parts.length) throw new AccessError('insufficient_scope');
    for (const part of parts) {
      if (['openid', 'profile', 'email'].includes(part)) continue;
      if (!(MCP_SCOPES as readonly string[]).includes(part)) throw new AccessError('insufficient_scope');
      scopes.push(part as McpScope);
    }
    if (!scopes.includes('mcp')) throw new AccessError('insufficient_scope');
    const clientId = payload['azp'] as string;
    await this.registry.authorize(clientId, scopes);
    return Object.freeze({ subject: payload.sub as string, clientId, scopes: Object.freeze(scopes),
      token, expiresAt: payload.exp as number });
  }

  async verifyExchanged(token: string, original: VerifiedActor): Promise<void> {
    const payload = await this.claims(token, API_AUDIENCES);
    if (payload.sub !== original.subject || payload['azp'] !== EXCHANGE_CLIENT_ID ||
      (payload.exp as number) > original.expiresAt + 5) throw new AccessError('invalid_token');
  }
}
