import { randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { Request, Response, ErrorRequestHandler } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import {
  createMcpHandler,
  McpServer,
  requireScopes,
  type AuthInfo,
  type CallToolResult,
} from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  AccessError,
  MCP_SCOPES,
  type VerifiedActor,
  type TokenExchange,
} from "./domain/access.js";
import {
  ConsultationInputError,
  OperationsReadError,
  TOOL_DEFINITIONS,
} from "./domain/consultation.js";
import { ConsultationService } from "./application/consultation-service.js";
import { OperationsReader } from "./infrastructure/operations-reader.js";
import type { McpConfig } from "./infrastructure/config.js";
import {
  AuditUnavailable,
  type AuditSink,
} from "./infrastructure/audit-sink.js";
import {
  appointmentRequestInput,
  appointmentRequestResult,
  projectAppointmentRequest,
  reconcileAppointmentRequestInput,
} from "./domain/appointment-requests.js";
import { z } from "zod";
import type { FileClientRegistry } from "./infrastructure/client-registry.js";
import { AppointmentRequestOwnerError } from "./infrastructure/operations-reader.js";

export interface AppDependencies {
  readonly config: McpConfig;
  readonly verify: (token: string) => Promise<VerifiedActor>;
  readonly exchange: TokenExchange;
  readonly audit: AuditSink;
  readonly registry?: FileClientRegistry;
  readonly ownerFetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly requestsPerMinute?: number;
}
const MAX_OUTPUT_BYTES = 65536;
const APPOINTMENT_REQUEST_TOOLS = [
  {
    name: "autonexus_request_appointment",
    scope: "mcp:appointments:request" as const,
  },
  {
    name: "autonexus_get_appointment_request",
    scope: "mcp:appointments:request:read" as const,
  },
] as const;
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function safeFailure(error: unknown): { status: number; code: string } {
  if (error instanceof AccessError)
    return { status: error.status, code: error.code };
  if (error instanceof AuditUnavailable)
    return { status: 503, code: error.code };
  return { status: 503, code: "SERVICE_UNAVAILABLE" };
}
function actorInfo(info: AuthInfo | undefined): VerifiedActor {
  const subject = info?.extra?.["subject"];
  if (
    !info ||
    typeof subject !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(subject) ||
    !info.expiresAt ||
    !info.scopes.every((scope) =>
      (MCP_SCOPES as readonly string[]).includes(scope),
    )
  ) {
    throw new AccessError("invalid_token");
  }
  return {
    subject,
    clientId: info.clientId,
    token: info.token,
    scopes: info.scopes as VerifiedActor["scopes"],
    expiresAt: info.expiresAt,
  };
}
function failureResult(code: string): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          ok: false,
          error: {
            code,
            message:
              "Consultation unavailable. Reduce the requested limit or retry later.",
          },
        }),
      },
    ],
  };
}

export function createConsultationApp(deps: AppDependencies) {
  const { config, audit } = deps;
  const resource = new URL(config.resourceUrl);
  const inboundResource = new URL(config.publicUrl ?? config.resourceUrl);
  const metadata = new URL(
    "/.well-known/oauth-protected-resource/mcp",
    resource,
  ).href;
  const app = createMcpExpressApp({
    host: config.host,
    allowedHosts: [
      ...new Set([
        resource.hostname,
        inboundResource.hostname,
        ...(config.adminAllowedHost ? [config.adminAllowedHost] : []),
      ]),
    ],
    allowedOrigins: [resource.hostname],
    jsonLimit: "32kb",
  });
  app.disable("x-powered-by");
  const now = deps.now ?? Date.now;
  const buckets = new Map<string, { minute: number; count: number }>();
  let concurrent = 0;
  function reply(
    res: Response,
    status: number,
    code: string,
    scope = "mcp",
  ): void {
    res.setHeader("Cache-Control", "no-store");
    if (status === 401 || status === 403) {
      const kind = status === 401 ? "invalid_token" : "insufficient_scope";
      res.setHeader(
        "WWW-Authenticate",
        'Bearer error="' +
          kind +
          '", resource_metadata="' +
          metadata +
          '", scope="' +
          scope +
          '"',
      );
    }
    if (status === 429) res.setHeader("Retry-After", "60");
    res.status(status).json({ error: code });
  }
  app.get("/health/live", (_req, res) => res.json({ status: "UP" }));
  const adminAuthorized = (req: Request, res: Response): string | undefined => {
    const configured = config.adminApiToken;
    const header = req.headers.authorization;
    const count = req.rawHeaders.filter(
      (value, index) =>
        index % 2 === 0 && value.toLowerCase() === "authorization",
    ).length;
    const bearer =
      typeof header === "string" && count === 1
        ? /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(header)?.[1]
        : undefined;
    const actor = req.headers["x-admin-subject"];
    if (
      !configured ||
      !deps.registry ||
      !bearer ||
      Buffer.byteLength(configured) !== Buffer.byteLength(bearer) ||
      !timingSafeEqual(Buffer.from(configured), Buffer.from(bearer)) ||
      typeof actor !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(actor)
    ) {
      res.status(configured ? 403 : 503).json({
        error: configured ? "FORBIDDEN" : "ADMINISTRATION_UNAVAILABLE",
      });
      return undefined;
    }
    return actor;
  };
  const auditAdmin = (actor: string, target: string, outcome: string) =>
    audit.write({
      actorSubject: actor,
      clientId: null,
      targetClientId: target,
      tool: "mcp-client-registry",
      correlationId: randomUUID(),
      outcome,
      durationMs: 0,
    });
  const clientDraft = z
    .strictObject({
      displayName: z.string().trim().min(1).max(120),
      enabled: z.boolean(),
      scopes: z
        .array(z.enum(MCP_SCOPES))
        .min(1)
        .max(MCP_SCOPES.length)
        .refine((scopes) => new Set(scopes).size === scopes.length),
    })
    .refine((value) => value.scopes.includes("mcp"));
  const clientId = (value: unknown) =>
    z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9._:-]+$/)
      .parse(value);
  const adminError = (res: Response, error: unknown) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "VALIDATION_ERROR" });
      return;
    }
    if (
      error instanceof AuditUnavailable ||
      error instanceof AccessError ||
      (error instanceof Error && error.message === "registry_limit")
    ) {
      res.status(503).json({ error: "ADMINISTRATION_UNAVAILABLE" });
      return;
    }
    if (error instanceof Error && error.message === "client_duplicate") {
      res.status(409).json({ error: "CLIENT_DUPLICATE" });
      return;
    }
    if (error instanceof Error && error.message === "client_not_found") {
      res.status(404).json({ error: "CLIENT_NOT_FOUND" });
      return;
    }
    res.status(503).json({ error: "REGISTRY_UPDATE_FAILED" });
  };
  app.get("/admin/clients", async (req, res) => {
    if (!adminAuthorized(req, res)) return;
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(await deps.registry!.list());
    } catch {
      res.status(503).json({ error: "REGISTRY_UNAVAILABLE" });
    }
  });
  app.post("/admin/clients", async (req, res) => {
    const actor = adminAuthorized(req, res);
    if (!actor) return;
    try {
      const body = z
        .strictObject({
          clientId: z
            .string()
            .min(1)
            .max(200)
            .regex(/^[A-Za-z0-9._:-]+$/),
          ...clientDraft.shape,
        })
        .refine((value) => value.scopes.includes("mcp"))
        .parse(req.body);
      await deps.registry!.create(body);
      await auditAdmin(actor, body.clientId, "CREATED");
      res.status(201).json({
        clientId: body.clientId,
        displayName: body.displayName,
        enabled: body.enabled,
        scopes: body.scopes,
      });
    } catch (error) {
      adminError(res, error);
    }
  });
  app.put("/admin/clients/:clientId", async (req, res) => {
    const actor = adminAuthorized(req, res);
    if (!actor) return;
    let target: string;
    try {
      target = clientId(req.params["clientId"]);
      const body = clientDraft.parse(req.body);
      await deps.registry!.update({ ...body, clientId: target });
      await auditAdmin(actor, target, "UPDATED");
      res.json({ clientId: target, ...body });
    } catch (error) {
      adminError(res, error);
    }
  });
  app.patch("/admin/clients/:clientId", async (req, res) => {
    const actor = adminAuthorized(req, res);
    if (!actor) return;
    try {
      const target = clientId(req.params["clientId"]);
      const { enabled } = z
        .strictObject({ enabled: z.boolean() })
        .parse(req.body);
      await deps.registry!.setEnabled(target, enabled);
      await auditAdmin(actor, target, enabled ? "ENABLED" : "SUSPENDED");
      res.json({ clientId: target, enabled });
    } catch (error) {
      adminError(res, error);
    }
  });
  app.delete("/admin/clients/:clientId", async (req, res) => {
    const actor = adminAuthorized(req, res);
    if (!actor) return;
    try {
      const target = clientId(req.params["clientId"]);
      await deps.registry!.revoke(target);
      await auditAdmin(actor, target, "REVOKED");
      res.status(204).end();
    } catch (error) {
      adminError(res, error);
    }
  });
  app.get("/public/config", (_req, res) => {
    const endpoint = config.publicUrl;
    const host = endpoint ? new URL(endpoint).hostname.toLowerCase() : "";
    const ipv4 = isIP(host) === 4 ? host.split(".").map(Number) : [];
    const privateAddress =
      ipv4.length === 4 &&
      (ipv4[0] === 10 ||
        ipv4[0] === 127 ||
        ipv4[0] === 0 ||
        (ipv4[0] === 172 && ipv4[1]! >= 16 && ipv4[1]! <= 31) ||
        (ipv4[0] === 192 && ipv4[1] === 168) ||
        ipv4[0]! >= 224);
    const local =
      !endpoint ||
      host === "localhost" ||
      !host.includes(".") ||
      host.endsWith(".local") ||
      host.endsWith(".localhost") ||
      host.endsWith(".internal") ||
      host.endsWith(".test") ||
      host.endsWith(".invalid") ||
      privateAddress ||
      (isIP(host) === 6 &&
        (host === "::1" ||
          host.startsWith("fc") ||
          host.startsWith("fd") ||
          host.startsWith("fe80:")));
    res.setHeader("Cache-Control", "no-store");
    res.json({
      endpoint: endpoint ?? null,
      protectedResourceMetadataUrl: endpoint
        ? new URL("/.well-known/oauth-protected-resource/mcp", endpoint).href
        : null,
      oauthIssuer: config.issuerUrl,
      oauthStatus:
        new URL(config.issuerUrl).protocol === "https:"
          ? "https_configured"
          : "local_development",
      endpointReachability: !endpoint
        ? "not_configured"
        : local
          ? "local_or_private"
          : new URL(endpoint).protocol === "https:"
            ? "https_configured_unverified"
            : "not_public_https",
    });
  });
  app.get("/.well-known/oauth-protected-resource/mcp", (_req, res) =>
    res.json({
      resource: resource.href,
      authorization_servers: [config.issuerUrl],
      scopes_supported: MCP_SCOPES,
      bearer_methods_supported: ["header"],
    }),
  );

  const handler = createMcpHandler(({ authInfo }) => {
    const actor = actorInfo(authInfo);
    const correlationId =
      typeof authInfo?.extra?.["correlationId"] === "string"
        ? authInfo.extra["correlationId"]
        : randomUUID();
    const server = new McpServer({
      name: "autonexus-mcp-server",
      version: "0.1.0",
    });
    const ownerReader = new OperationsReader({
      baseUrl: config.operationsBaseUrl,
      tokenProvider: () => deps.exchange.exchange(actor),
      ...(config.ownerAssertionSecret
        ? { clientAssertionSecret: config.ownerAssertionSecret }
        : {}),
      ...(deps.ownerFetch ? { fetch: deps.ownerFetch } : {}),
    });
    const service = new ConsultationService(ownerReader);
    for (const tool of TOOL_DEFINITIONS) {
      if (!actor.scopes.some((scope) => scope === tool.scope)) continue;
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          annotations: tool.annotations,
          scopeChallenge: requireScopes(tool.scope),
        },
        async (input: unknown): Promise<CallToolResult> => {
          const started = now();
          const event = {
            actorSubject: actor.subject,
            clientId: actor.clientId,
            tool: tool.name,
            correlationId,
            durationMs: 0,
          };
          try {
            await audit.write({ ...event, outcome: "REQUESTED" });
            const output = await service.execute(tool.name, input);
            const json = JSON.stringify(output);
            if (Buffer.byteLength(json) > MAX_OUTPUT_BYTES) {
              await audit.write({
                ...event,
                durationMs: now() - started,
                outcome: "RESPONSE_LIMIT",
              });
              return failureResult("RESPONSE_LIMIT");
            }
            await audit.write({
              ...event,
              durationMs: now() - started,
              outcome: output.ok ? "OK" : output.error.code,
            });
            const markdown = record(input)["responseFormat"] === "markdown";
            return {
              content: [
                {
                  type: "text",
                  text: markdown
                    ? "## " + tool.title + String.fromCharCode(10) + json
                    : json,
                },
              ],
              structuredContent: output,
              isError: !output.ok,
            };
          } catch (error) {
            const code =
              error instanceof ConsultationInputError
                ? "INVALID_ARGUMENTS"
                : safeFailure(error).code.toUpperCase();
            // Best effort: the terminal outcome must be recorded even when the call fails closed.
            await audit
              .write({ ...event, durationMs: now() - started, outcome: code })
              .catch(() => undefined);
            return failureResult(code);
          }
        },
      );
    }
    for (const tool of APPOINTMENT_REQUEST_TOOLS) {
      if (!actor.scopes.includes(tool.scope)) continue;
      if (
        tool.name === "autonexus_request_appointment" &&
        !config.ownerAssertionSecret
      )
        continue;
      const inputSchema =
        tool.name === "autonexus_request_appointment"
          ? appointmentRequestInput
          : reconcileAppointmentRequestInput;
      server.registerTool(
        tool.name,
        {
          title:
            tool.name === "autonexus_request_appointment"
              ? "Request an appointment"
              : "Check appointment request",
          description:
            tool.name === "autonexus_request_appointment"
              ? "Submit a proposal for staff review. This never reserves a slot or confirms an appointment. Reuse operationId to retry."
              : "Reconcile one previously submitted request using its original operationId.",
          inputSchema,
          outputSchema: appointmentRequestResult,
          annotations: {
            readOnlyHint: tool.name === "autonexus_get_appointment_request",
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true,
          },
          scopeChallenge: requireScopes(tool.scope),
        },
        async (input: unknown): Promise<CallToolResult> => {
          const started = now();
          const args = inputSchema.parse(input) as Record<
            string,
            string | undefined
          >;
          const operationId = String(args["operationId"]);
          const event = {
            actorSubject: actor.subject,
            clientId: actor.clientId,
            tool: tool.name,
            correlationId: randomUUID(),
            durationMs: 0,
          };
          try {
            await audit.write({ ...event, outcome: "REQUESTED" });
            const ownerToken = await deps.exchange.exchange(actor);
            const raw =
              tool.name === "autonexus_request_appointment"
                ? await ownerReader.createAppointmentRequest(
                    {
                      operationId,
                      clientId: actor.clientId,
                      customerId: String(args["customerId"]),
                      vehicleId: String(args["vehicleId"]),
                      serviceId: String(args["serviceId"]),
                      startsAt: String(args["startsAt"]),
                      timeZone: String(args["timeZone"]),
                      ...(args["notes"] ? { notes: args["notes"] } : {}),
                    },
                    ownerToken,
                    actor.subject,
                  )
                : await ownerReader.getAppointmentRequest(
                    operationId,
                    ownerToken,
                    actor.clientId,
                    actor.subject,
                  );
            const output = projectAppointmentRequest(
              raw,
              actor.clientId,
              operationId,
            );
            await audit.write({
              ...event,
              durationMs: now() - started,
              outcome: output.replayed
                ? "REPLAYED"
                : (output.request?.status ?? "RECONCILED"),
            });
            return {
              content: [{ type: "text", text: JSON.stringify(output) }],
              structuredContent: output,
            };
          } catch (error) {
            const code =
              error instanceof AppointmentRequestOwnerError
                ? error.code
                : error instanceof OperationsReadError
                  ? error.code
                  : error instanceof Error &&
                      error.message === "OWNER_INVALID_RESPONSE"
                    ? "OWNER_INVALID_RESPONSE"
                    : safeFailure(error).code;
            await audit
              .write({ ...event, durationMs: now() - started, outcome: code })
              .catch(() => undefined);
            if (
              tool.name === "autonexus_request_appointment" &&
              error instanceof AppointmentRequestOwnerError &&
              ["OWNER_TIMEOUT", "OWNER_UNAVAILABLE"].includes(error.code)
            ) {
              const output = {
                outcome: "UNKNOWN" as const,
                operationId,
                request: null,
                replayed: false,
                message:
                  "Operations did not confirm the result. Use autonexus_get_appointment_request with this same operationId before retrying.",
              };
              return {
                content: [{ type: "text", text: JSON.stringify(output) }],
                structuredContent: output,
              };
            }
            return failureResult(code.toUpperCase());
          }
        },
      );
    }
    return server;
  });
  const node = toNodeHandler(handler, { maxRequestBodySize: 32768 });
  app.all("/mcp", async (req: Request, res: Response) => {
    if (concurrent >= 8) {
      reply(res, 429, "RATE_LIMITED");
      return;
    }
    concurrent++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        concurrent--;
      }
    };
    res.once("finish", release);
    res.once("close", release);
    try {
      const origin = req.headers.origin;
      if (
        (origin !== undefined && origin !== resource.origin) ||
        Object.keys(req.query).length
      ) {
        reply(res, 403, "ORIGIN_OR_QUERY_FORBIDDEN");
        return;
      }
      const count = req.rawHeaders.filter(
        (value, index) =>
          index % 2 === 0 && value.toLowerCase() === "authorization",
      ).length;
      const header = req.headers.authorization;
      const match =
        typeof header === "string" && count === 1
          ? /^Bearer ([A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+)$/i.exec(
              header,
            )
          : null;
      if (!match?.[1]) throw new AccessError("invalid_token");
      const actor = await deps.verify(match[1]);
      if (!actor.scopes.includes("mcp"))
        throw new AccessError("insufficient_scope");
      const minute = Math.floor(now() / 60000);
      for (const [key, value] of buckets)
        if (value.minute !== minute) buckets.delete(key);
      const key = actor.clientId + ":" + actor.subject;
      const bucket = buckets.get(key) ?? { minute, count: 0 };
      if (
        (!buckets.has(key) && buckets.size >= 1024) ||
        bucket.count >= (deps.requestsPerMinute ?? 60)
      ) {
        reply(res, 429, "RATE_LIMITED");
        return;
      }
      bucket.count++;
      buckets.set(key, bucket);
      const body = record(req.body);
      const tool =
        body["method"] === "tools/call"
          ? TOOL_DEFINITIONS.find(
              (item) => item.name === record(body["params"])["name"],
            )
          : undefined;
      const appointmentTool =
        body["method"] === "tools/call"
          ? APPOINTMENT_REQUEST_TOOLS.find(
              (item) => item.name === record(body["params"])["name"],
            )
          : undefined;
      const requiredScope = tool?.scope ?? appointmentTool?.scope;
      if (
        requiredScope &&
        !actor.scopes.some((scope) => scope === requiredScope)
      ) {
        reply(res, 403, "insufficient_scope", requiredScope);
        return;
      }
      const authenticated = req as Request & { auth: AuthInfo };
      authenticated.auth = {
        token: actor.token,
        clientId: actor.clientId,
        scopes: [...actor.scopes],
        expiresAt: actor.expiresAt,
        resource,
        extra: { subject: actor.subject, correlationId: randomUUID() },
      };
      res.setHeader("Cache-Control", "no-store");
      await node(authenticated, res, req.body);
    } catch (error) {
      if (!res.headersSent) {
        const safe = safeFailure(error);
        reply(res, safe.status, safe.code);
      } else res.end();
    }
  });
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const status = record(error)["status"] === 413 ? 413 : 400;
    reply(
      res,
      status,
      status === 413 ? "REQUEST_TOO_LARGE" : "MALFORMED_REQUEST",
    );
  };
  app.use(errors);
  return app;
}
