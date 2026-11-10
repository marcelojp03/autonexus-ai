import { describe, expect, it, vi } from 'vitest';
import { HttpMcpClientsGateway } from './mcp-clients-gateway.js';
import { BusinessError } from './business-error.js';

const draft = {
  clientId: 'chatgpt-static',
  displayName: 'ChatGPT workshop app',
  enabled: true,
  scopes: ['mcp', 'mcp:orders:read'] as const,
};
const config = {
  endpoint: 'https://workshop.example/mcp',
  protectedResourceMetadataUrl:
    'https://workshop.example/.well-known/oauth-protected-resource/mcp',
  oauthIssuer: 'https://identity.example/realms/workshop',
  oauthStatus: 'https_configured',
  endpointReachability: 'https_configured_unverified',
};

describe('HttpMcpClientsGateway', () => {
  it('keeps the private service credential server-side and forwards only the admin subject and allowlisted draft', async () => {
    const transport = vi.fn(
      async (_input: URL | RequestInfo, _init?: RequestInit) =>
        Response.json(draft, { status: 201 }),
    );
    const gateway = new HttpMcpClientsGateway(
      'http://mcp-server:3006',
      'private-service-token-at-least-32-chars',
      transport,
    );
    await expect(
      gateway.create(draft, 'verified-admin-subject'),
    ).resolves.toEqual(draft);
    const [, request] = transport.mock.calls[0]!;
    const headers = request?.headers as Record<string, string>;
    expect(headers.authorization).toBe(
      'Bearer private-service-token-at-least-32-chars',
    );
    expect(headers['x-admin-subject']).toBe('verified-admin-subject');
    expect(String(request?.body)).not.toContain('secret');
  });

  it('fails closed when the private BFF-to-MCP credential is missing', async () => {
    const transport = vi.fn();
    const gateway = new HttpMcpClientsGateway(
      'http://mcp-server:3006',
      undefined,
      transport as never,
    );
    await expect(gateway.list()).rejects.toMatchObject({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('rejects unknown scopes before they leave the BFF', async () => {
    const transport = vi.fn();
    const gateway = new HttpMcpClientsGateway(
      'http://mcp-server:3006',
      'private-service-token-at-least-32-chars',
      transport as never,
    );
    await expect(
      gateway.create({ ...draft, scopes: ['mcp', 'admin'] as never }, 'admin'),
    ).rejects.toMatchObject({ statusCode: 503, code: 'SERVICE_UNAVAILABLE' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('reports an MCP registry mutation response as unknown service failure rather than exposing upstream details', async () => {
    const transport = vi.fn(async () =>
      Response.json(
        { error: 'REGISTRY_UPDATE_FAILED', secret: 'must-not-leak' },
        { status: 503 },
      ),
    );
    const gateway = new HttpMcpClientsGateway(
      'http://mcp-server:3006',
      'private-service-token-at-least-32-chars',
      transport,
    );
    try {
      await gateway.create(draft, 'admin');
      throw new Error('Expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessError);
      expect(error).toMatchObject({
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
      });
      expect((error as Error).message).not.toContain('must-not-leak');
    }
  });

  it('reads configured MCP public endpoint status without forwarding the service token', async () => {
    const transport = vi.fn(
      async (_input: URL | RequestInfo, _init?: RequestInit) =>
        Response.json(config),
    );
    const gateway = new HttpMcpClientsGateway(
      'http://mcp-server:3006',
      'private-service-token-at-least-32-chars',
      transport,
    );
    await expect(gateway.publicConfig()).resolves.toEqual(config);
    expect(transport.mock.calls[0]?.[1]?.headers).toBeUndefined();
  });
});
