export const MCP_SCOPES = [
  'mcp', 'mcp:orders:read', 'mcp:agenda:read:self', 'mcp:agenda:read:team',
  'mcp:executions:read:self', 'mcp:executions:read:team',
] as const;

export type McpScope = typeof MCP_SCOPES[number];

export interface VerifiedActor {
  readonly subject: string;
  readonly clientId: string;
  readonly scopes: readonly McpScope[];
  readonly token: string;
  readonly expiresAt: number;
}

const errors = {
  invalid_token: { status: 401, message: 'Invalid access token' },
  client_forbidden: { status: 403, message: 'Client is not authorized' },
  insufficient_scope: { status: 403, message: 'Required scope is not authorized' },
  registry_unavailable: { status: 503, message: 'Client registry is unavailable' },
  identity_unavailable: { status: 503, message: 'Identity provider is unavailable' },
} as const;

export class AccessError extends Error {
  readonly status: 401 | 403 | 503;
  constructor(readonly code: keyof typeof errors) {
    super(errors[code].message);
    this.name = 'AccessError';
    this.status = errors[code].status;
  }
}

export interface ClientRegistry {
  authorize(clientId: string, scopes: readonly McpScope[]): Promise<void>;
}

export interface TokenExchange {
  exchange(actor: VerifiedActor): Promise<string>;
}

export function requireScope(actor: VerifiedActor, scope: McpScope): void {
  if (!actor.scopes.includes(scope)) throw new AccessError('insufficient_scope');
}
