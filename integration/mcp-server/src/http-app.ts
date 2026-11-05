import { randomUUID } from 'node:crypto';
import type { Request, Response, ErrorRequestHandler } from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { createMcpHandler, McpServer, requireScopes, type AuthInfo, type CallToolResult } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { AccessError, MCP_SCOPES, type VerifiedActor, type TokenExchange } from './domain/access.js';
import { ConsultationInputError, TOOL_DEFINITIONS } from './domain/consultation.js';
import { ConsultationService } from './application/consultation-service.js';
import { OperationsReader } from './infrastructure/operations-reader.js';
import type { McpConfig } from './infrastructure/config.js';
import { AuditUnavailable, type AuditSink } from './infrastructure/audit-sink.js';

export interface AppDependencies {
  readonly config: McpConfig;
  readonly verify: (token: string) => Promise<VerifiedActor>;
  readonly exchange: TokenExchange;
  readonly audit: AuditSink;
  readonly ownerFetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly requestsPerMinute?: number;
}
const MAX_OUTPUT_BYTES = 65536;
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function safeFailure(error: unknown): { status: number; code: string } {
  if (error instanceof AccessError) return { status: error.status, code: error.code };
  if (error instanceof AuditUnavailable) return { status: 503, code: error.code };
  return { status: 503, code: 'SERVICE_UNAVAILABLE' };
}
function actorInfo(info: AuthInfo | undefined): VerifiedActor {
  const subject = info?.extra?.['subject'];
  if (!info || typeof subject !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(subject)
    || !info.expiresAt || !info.scopes.every(scope => (MCP_SCOPES as readonly string[]).includes(scope))) {
    throw new AccessError('invalid_token');
  }
  return { subject, clientId: info.clientId, token: info.token, scopes: info.scopes as VerifiedActor['scopes'], expiresAt: info.expiresAt };
}
function failureResult(code: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, error: { code, message: 'Consultation unavailable. Reduce the requested limit or retry later.' } }) }] };
}

export function createConsultationApp(deps: AppDependencies) {
  const { config, audit } = deps;
  const resource = new URL(config.resourceUrl);
  const metadata = new URL('/.well-known/oauth-protected-resource/mcp', resource).href;
  const app = createMcpExpressApp({ host: config.host, allowedHosts: [resource.hostname],
    allowedOrigins: [resource.hostname], jsonLimit: '32kb' });
  app.disable('x-powered-by');
  const now = deps.now ?? Date.now;
  const buckets = new Map<string, { minute: number; count: number }>();
  let concurrent = 0;
  function reply(res: Response, status: number, code: string, scope = 'mcp'): void {
    res.setHeader('Cache-Control', 'no-store');
    if (status === 401 || status === 403) {
      const kind = status === 401 ? 'invalid_token' : 'insufficient_scope';
      res.setHeader('WWW-Authenticate', 'Bearer error="' + kind + '", resource_metadata="' + metadata + '", scope="' + scope + '"');
    }
    if (status === 429) res.setHeader('Retry-After', '60');
    res.status(status).json({ error: code });
  }
  app.get('/health/live', (_req, res) => res.json({ status: 'UP' }));
  app.get('/.well-known/oauth-protected-resource/mcp', (_req, res) => res.json({ resource: resource.href,
    authorization_servers: [config.issuerUrl], scopes_supported: MCP_SCOPES, bearer_methods_supported: ['header'] }));

  const handler = createMcpHandler(({ authInfo }) => {
    const actor = actorInfo(authInfo);
    const correlationId = typeof authInfo?.extra?.['correlationId'] === 'string' ? authInfo.extra['correlationId'] : randomUUID();
    const server = new McpServer({ name: 'autonexus-mcp-server', version: '0.1.0' });
    const service = new ConsultationService(new OperationsReader({ baseUrl: config.operationsBaseUrl,
      tokenProvider: () => deps.exchange.exchange(actor), ...(deps.ownerFetch ? { fetch: deps.ownerFetch } : {}) }));
    for (const tool of TOOL_DEFINITIONS) {
      if (!actor.scopes.some(scope => scope === tool.scope)) continue;
      server.registerTool(tool.name, { title: tool.title, description: tool.description,
        inputSchema: tool.inputSchema, outputSchema: tool.outputSchema, annotations: tool.annotations, scopeChallenge: requireScopes(tool.scope) },
      async (input: unknown): Promise<CallToolResult> => {
        const started = now();
        const event = { actorSubject: actor.subject, clientId: actor.clientId, tool: tool.name, correlationId, durationMs: 0 };
        try {
          await audit.write({ ...event, outcome: 'REQUESTED' });
          const output = await service.execute(tool.name, input);
          const json = JSON.stringify(output);
          if (Buffer.byteLength(json) > MAX_OUTPUT_BYTES) {
            await audit.write({ ...event, durationMs: now() - started, outcome: 'RESPONSE_LIMIT' });
            return failureResult('RESPONSE_LIMIT');
          }
          await audit.write({ ...event, durationMs: now() - started, outcome: output.ok ? 'OK' : output.error.code });
          const markdown = record(input)['responseFormat'] === 'markdown';
          return { content: [{ type: 'text', text: markdown ? '## ' + tool.title + String.fromCharCode(10) + json : json }],
            structuredContent: output, isError: !output.ok };
        } catch (error) {
          const code = error instanceof ConsultationInputError ? 'INVALID_ARGUMENTS' : safeFailure(error).code.toUpperCase();
          // Best effort: the terminal outcome must be recorded even when the call fails closed.
          await audit.write({ ...event, durationMs: now() - started, outcome: code }).catch(() => undefined);
          return failureResult(code);
        }
      });
    }
    return server;
  });
  const node = toNodeHandler(handler, { maxRequestBodySize: 32768 });
  app.all('/mcp', async (req: Request, res: Response) => {
    if (concurrent >= 8) { reply(res, 429, 'RATE_LIMITED'); return; }
    concurrent++;
    let released = false;
    const release = () => { if (!released) { released = true; concurrent--; } };
    res.once('finish', release); res.once('close', release);
    try {
      const origin = req.headers.origin;
      if ((origin !== undefined && origin !== resource.origin) || Object.keys(req.query).length) {
        reply(res, 403, 'ORIGIN_OR_QUERY_FORBIDDEN'); return;
      }
      const count = req.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === 'authorization').length;
      const header = req.headers.authorization;
      const match = typeof header === 'string' && count === 1 ? /^Bearer ([A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+)$/i.exec(header) : null;
      if (!match?.[1]) throw new AccessError('invalid_token');
      const actor = await deps.verify(match[1]);
      if (!actor.scopes.includes('mcp')) throw new AccessError('insufficient_scope');
      const minute = Math.floor(now() / 60000);
      for (const [key, value] of buckets) if (value.minute !== minute) buckets.delete(key);
      const key = actor.clientId + ':' + actor.subject;
      const bucket = buckets.get(key) ?? { minute, count: 0 };
      if ((!buckets.has(key) && buckets.size >= 1024) || bucket.count >= (deps.requestsPerMinute ?? 60)) {
        reply(res, 429, 'RATE_LIMITED'); return;
      }
      bucket.count++; buckets.set(key, bucket);
      const body = record(req.body);
      const tool = body['method'] === 'tools/call' ? TOOL_DEFINITIONS.find(item => item.name === record(body['params'])['name']) : undefined;
      if (tool && !actor.scopes.some(scope => scope === tool.scope)) { reply(res, 403, 'insufficient_scope', tool.scope); return; }
      const authenticated = req as Request & { auth: AuthInfo };
      authenticated.auth = { token: actor.token, clientId: actor.clientId, scopes: [...actor.scopes], expiresAt: actor.expiresAt,
        resource, extra: { subject: actor.subject, correlationId: randomUUID() } };
      res.setHeader('Cache-Control', 'no-store');
      await node(authenticated, res, req.body);
    } catch (error) {
      if (!res.headersSent) { const safe = safeFailure(error); reply(res, safe.status, safe.code); }
      else res.end();
    }
  });
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const status = record(error)['status'] === 413 ? 413 : 400;
    reply(res, status, status === 413 ? 'REQUEST_TOO_LARGE' : 'MALFORMED_REQUEST');
  };
  app.use(errors);
  return app;
}
