import { isAbsolute } from 'node:path';

export interface McpConfig {
  readonly resourceUrl: string;
  readonly issuerUrl: string;
  readonly jwksUrl: string;
  readonly tokenEndpointUrl: string;
  readonly operationsBaseUrl: string;
  readonly host: string;
  readonly port: number;
  readonly clientRegistryFile: string;
  readonly idpClientFile: string;
}

function loopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function url(value: string, allowInternal: boolean): URL {
  const result = new URL(value);
  if (value !== value.trim() || value.includes('?') || value.includes('#') ||
    result.username || result.password || result.search || result.hash ||
    (result.protocol !== 'https:' && !(result.protocol === 'http:' &&
      (loopback(result.hostname) || allowInternal)))) throw new Error('Invalid MCP configuration');
  return result;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  try {
    const production = env['NODE_ENV'] === 'production';
    const allowInternal = !production && env['MCP_ALLOW_INTERNAL_HTTP_DEV'] === 'true';
    const resource = url(env['MCP_RESOURCE_URL'] ?? 'http://127.0.0.1:3006/mcp', false);
    const issuer = url(env['MCP_ISSUER_URL'] ?? 'http://127.0.0.1:4286/identity/realms/autonexus', false);
    if (resource.pathname !== '/mcp' || issuer.pathname.endsWith('/') ||
      (production && (resource.protocol !== 'https:' || issuer.protocol !== 'https:'))) {
      throw new Error('Invalid MCP configuration');
    }
    const jwks = url(env['MCP_JWKS_URL'] ?? `${issuer.href}/protocol/openid-connect/certs`, allowInternal);
    const token = url(env['MCP_TOKEN_ENDPOINT_URL'] ?? `${issuer.href}/protocol/openid-connect/token`, allowInternal);
    const operations = url(env['MCP_OPERATIONS_BASE_URL'] ?? 'http://127.0.0.1:8081', allowInternal);
    if (operations.pathname !== '/') throw new Error('Invalid MCP configuration');
    const clientRegistryFile = env['MCP_CLIENT_REGISTRY_FILE'];
    const idpClientFile = env['MCP_IDP_CLIENT_FILE'];
    if (!clientRegistryFile || !idpClientFile || !isAbsolute(clientRegistryFile) || !isAbsolute(idpClientFile)) {
      throw new Error('Invalid MCP configuration');
    }
    const host = env['MCP_HOST'] ?? '127.0.0.1';
    const portText = env['MCP_PORT'] ?? '3006';
    if (!['127.0.0.1', '::1', '0.0.0.0'].includes(host) || !/^\d+$/.test(portText)) {
      throw new Error('Invalid MCP configuration');
    }
    const port = Number(portText);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid MCP configuration');
    return Object.freeze({ resourceUrl: resource.href, issuerUrl: issuer.href, jwksUrl: jwks.href,
      tokenEndpointUrl: token.href, operationsBaseUrl: operations.origin, host, port, clientRegistryFile, idpClientFile });
  } catch {
    throw new Error('Invalid MCP configuration');
  }
}
