import { BusinessError } from './business-error.js';

export const MCP_ALLOWED_SCOPES = Object.freeze([
  'mcp',
  'mcp:orders:read',
  'mcp:agenda:read:self',
  'mcp:agenda:read:team',
  'mcp:executions:read:self',
  'mcp:executions:read:team',
  'mcp:appointments:request',
  'mcp:appointments:request:read',
] as const);
export type McpAllowedScope = (typeof MCP_ALLOWED_SCOPES)[number];
export interface McpClientDraft {
  clientId: string;
  displayName: string;
  enabled: boolean;
  scopes: readonly McpAllowedScope[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function parseClient(value: unknown): McpClientDraft {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) => !['clientId', 'displayName', 'enabled', 'scopes'].includes(key),
    ) ||
    typeof value.clientId !== 'string' ||
    !/^[A-Za-z0-9._:-]{1,200}$/.test(value.clientId) ||
    typeof value.displayName !== 'string' ||
    !value.displayName.trim() ||
    value.displayName.trim().length > 120 ||
    typeof value.enabled !== 'boolean' ||
    !Array.isArray(value.scopes) ||
    value.scopes.length < 1 ||
    value.scopes.length > MCP_ALLOWED_SCOPES.length ||
    value.scopes.some(
      (scope) => !MCP_ALLOWED_SCOPES.includes(scope as McpAllowedScope),
    ) ||
    new Set(value.scopes).size !== value.scopes.length ||
    !value.scopes.includes('mcp')
  ) {
    throw new BusinessError(503, 'SERVICE_UNAVAILABLE');
  }
  return {
    clientId: value.clientId,
    displayName: value.displayName.trim(),
    enabled: value.enabled,
    scopes: value.scopes as McpAllowedScope[],
  };
}
type PublicConfig = {
  endpoint: string | null;
  protectedResourceMetadataUrl: string | null;
  oauthIssuer: string;
  oauthStatus: 'https_configured' | 'local_development';
  endpointReachability:
    | 'not_configured'
    | 'local_or_private'
    | 'https_configured_unverified'
    | 'not_public_https';
};
function parsePublicConfig(value: unknown): PublicConfig {
  if (!isRecord(value)) throw new BusinessError(503, 'SERVICE_UNAVAILABLE');
  const endpointReachability = value.endpointReachability;
  if (
    !(
      endpointReachability === 'not_configured' ||
      endpointReachability === 'local_or_private' ||
      endpointReachability === 'https_configured_unverified' ||
      endpointReachability === 'not_public_https'
    ) ||
    !(
      value.oauthStatus === 'https_configured' ||
      value.oauthStatus === 'local_development'
    ) ||
    !(value.endpoint === null || typeof value.endpoint === 'string') ||
    !(
      value.protectedResourceMetadataUrl === null ||
      typeof value.protectedResourceMetadataUrl === 'string'
    ) ||
    typeof value.oauthIssuer !== 'string'
  ) {
    throw new BusinessError(503, 'SERVICE_UNAVAILABLE');
  }
  return {
    endpoint: value.endpoint,
    protectedResourceMetadataUrl: value.protectedResourceMetadataUrl,
    oauthIssuer: value.oauthIssuer,
    oauthStatus: value.oauthStatus,
    endpointReachability,
  };
}

export class HttpMcpClientsGateway {
  constructor(
    private readonly baseUrl?: string,
    private readonly adminToken?: string,
    private readonly transport: typeof fetch = fetch,
  ) {}

  private async call(
    path: string,
    init: RequestInit = {},
    actor?: string,
  ): Promise<unknown> {
    const baseUrl = this.baseUrl;
    const adminToken = this.adminToken;
    if (!baseUrl || !adminToken)
      throw new BusinessError(503, 'SERVICE_UNAVAILABLE');
    let response: Response;
    try {
      response = await this.transport(baseUrl + path, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
        headers: {
          authorization: `Bearer ${adminToken}`,
          ...(actor ? { 'x-admin-subject': actor } : {}),
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...(init.headers ?? {}),
        },
      });
    } catch {
      throw new BusinessError(503, 'SERVICE_UNAVAILABLE');
    }
    if (response.status === 204) return null;
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (response.ok) return body;
    if (response.status === 401 || response.status === 403)
      throw new BusinessError(503, 'SERVICE_UNAVAILABLE');
    const code =
      body &&
      typeof body === 'object' &&
      'error' in body &&
      typeof body.error === 'string'
        ? body.error
        : '';
    if (response.status === 409 && code === 'CLIENT_DUPLICATE')
      throw new BusinessError(409, 'CLIENT_DUPLICATE');
    if (response.status === 404 && code === 'CLIENT_NOT_FOUND')
      throw new BusinessError(404, 'NOT_FOUND');
    if (response.status === 400)
      throw new BusinessError(400, 'VALIDATION_ERROR');
    throw new BusinessError(503, 'SERVICE_UNAVAILABLE');
  }

  async list(): Promise<readonly McpClientDraft[]> {
    const raw = await this.call('/admin/clients');
    if (!Array.isArray(raw) || raw.length > 32)
      throw new BusinessError(503, 'SERVICE_UNAVAILABLE');
    const items = raw.map(parseClient);
    return items.map((item) => ({
      ...item,
      scopes: [...new Set(item.scopes)],
    }));
  }
  async publicConfig(): Promise<PublicConfig> {
    if (!this.baseUrl)
      return parsePublicConfig({
        endpoint: null,
        protectedResourceMetadataUrl: null,
        oauthIssuer: '',
        oauthStatus: 'local_development',
        endpointReachability: 'not_configured',
      });
    let response: Response;
    try {
      response = await this.transport(this.baseUrl + '/public/config', {
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new BusinessError(503, 'SERVICE_UNAVAILABLE');
    }
    if (!response.ok) throw new BusinessError(503, 'SERVICE_UNAVAILABLE');
    try {
      return parsePublicConfig(await response.json());
    } catch {
      throw new BusinessError(503, 'SERVICE_UNAVAILABLE');
    }
  }
  async create(input: McpClientDraft, actor: string): Promise<McpClientDraft> {
    const draft = parseClient(input);
    return parseClient(
      await this.call(
        '/admin/clients',
        { method: 'POST', body: JSON.stringify(draft) },
        actor,
      ),
    );
  }
  async update(input: McpClientDraft, actor: string): Promise<McpClientDraft> {
    const parsed = parseClient(input);
    const { clientId, ...draft } = parsed;
    return parseClient(
      await this.call(
        '/admin/clients/' + encodeURIComponent(clientId),
        { method: 'PUT', body: JSON.stringify(draft) },
        actor,
      ),
    );
  }
  async setEnabled(
    clientId: string,
    enabled: boolean,
    actor: string,
  ): Promise<McpClientDraft> {
    await this.call(
      '/admin/clients/' + encodeURIComponent(clientId),
      { method: 'PATCH', body: JSON.stringify({ enabled }) },
      actor,
    );
    const item = (await this.list()).find(
      (client) => client.clientId === clientId,
    );
    if (!item) throw new BusinessError(503, 'SERVICE_UNAVAILABLE');
    return item;
  }
  async revoke(clientId: string, actor: string): Promise<boolean> {
    await this.call(
      '/admin/clients/' + encodeURIComponent(clientId),
      { method: 'DELETE' },
      actor,
    );
    return true;
  }
}
