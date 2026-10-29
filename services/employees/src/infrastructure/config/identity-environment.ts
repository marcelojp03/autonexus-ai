import { trustedHttpUrl } from './transport.js';

export function identityEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const adminBase = env.OIDC_ADMIN_BASE_URL ?? 'http://127.0.0.1:8180';
  const tokenUrl = env.OIDC_TOKEN_URL ?? 'http://127.0.0.1:8180/realms/autonexus/protocol/openid-connect/token';
  trustedHttpUrl(adminBase, 'OIDC_ADMIN_BASE_URL');
  trustedHttpUrl(tokenUrl, 'OIDC_TOKEN_URL');
  return { adminBase: adminBase.replace(/\/$/, ''), tokenUrl };
}
