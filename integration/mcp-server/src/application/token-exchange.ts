import { z } from 'zod';
import { AccessError, type TokenExchange, type VerifiedActor } from '../domain/access.js';
import { API_AUDIENCES, EXCHANGE_CLIENT_ID, type AccessTokenVerifier } from '../infrastructure/access-token-verifier.js';
import { readPrivateJson } from '../infrastructure/client-registry.js';
import type { McpConfig } from '../infrastructure/config.js';

const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
const credentialsSchema = z.strictObject({
  clientId: z.literal(EXCHANGE_CLIENT_ID), clientSecret: z.string().min(1).max(4096),
});

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Invalid identity response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) throw new Error('Invalid identity response');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export class KeycloakTokenExchange implements TokenExchange {
  constructor(private readonly config: McpConfig, private readonly verifier: AccessTokenVerifier) {}

  async exchange(actor: VerifiedActor): Promise<string> {
    const current = await this.verifier.verify(actor.token);
    if (current.subject !== actor.subject || current.clientId !== actor.clientId) {
      throw new AccessError('invalid_token');
    }
    try {
      const credentials = credentialsSchema.parse(await readPrivateJson(this.config.idpClientFile, 8192));
      const form = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: current.token, subject_token_type: ACCESS_TOKEN_TYPE,
        requested_token_type: ACCESS_TOKEN_TYPE,
        client_id: credentials.clientId, client_secret: credentials.clientSecret,
      });
      for (const audience of API_AUDIENCES) form.append('audience', audience);
      const response = await fetch(this.config.tokenEndpointUrl, { method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: form, redirect: 'error', signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('Identity exchange failed');
      }
      const result = z.object({ access_token: z.string().min(1).max(32768),
        token_type: z.literal('Bearer'), issued_token_type: z.literal(ACCESS_TOKEN_TYPE),
      }).passthrough().parse(await boundedJson(response));
      if (Object.hasOwn(result, 'refresh_token')) throw new Error('Unexpected refresh token');
      await this.verifier.verifyExchanged(result.access_token, current);
      return result.access_token;
    } catch {
      throw new AccessError('identity_unavailable');
    }
  }
}
