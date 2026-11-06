/**
 * Loopback HTTP service for the CU25 assistant and the CU26 narrative report.
 *
 * The caller's own bearer token is forwarded to Operations: this process mints no identity and
 * never talks MCP. Tokens and question text are never logged; only digests, lengths and outcomes.
 */
import {createServer, type IncomingMessage, type Server, type ServerResponse} from "node:http";
import {createHash} from "node:crypto";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {createOllamaClient, type LlmClient} from "./llm/ollama.js";
import {ASSISTANT_PROMPT_VERSION, askWithLlm, type AssistantAnswer} from "./assistant/llm-assistant.js";
import {answerDeterministically} from "./assistant/deterministic.js";
import {createTokenSource} from "./assistant/token-source.js";
import {buildNarrativeReport, ReportError} from "./report/narrative-report.js";
import type {ToolSource} from "./sources/mcp.js";

export const DEFAULT_PORT = 3099;
export const DEFAULT_MAX_BODY_BYTES = 16_384;
const LOOPBACK = "127.0.0.1";
const BEARER = /^Bearer ([A-Za-z0-9._~+/=-]{20,})$/;
const MIN_QUERY = 3;
const MAX_QUERY = 1_000;

export interface ServerDeps {
  /** null disables the model: every request then answers through the deterministic planner. */
  readonly llm?: LlmClient | null;
  readonly sourceFactory?: (token: string) => ToolSource;
  readonly now?: () => Date;
  readonly logger?: (entry: Readonly<Record<string, unknown>>) => void;
  readonly maxBodyBytes?: number;
}

interface Json {readonly [key: string]: unknown}

const sha = (value: string): string => createHash("sha256").update(value).digest("hex");

function defaultLogger(entry: Readonly<Record<string, unknown>>): void {
  process.stderr.write(JSON.stringify(entry) + String.fromCharCode(10));
}

function sendJson(response: ServerResponse, status: number, body: Json, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {"content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(payload)), "cache-control": "no-store", ...headers});
  response.end(payload);
}

function error(response: ServerResponse, status: number, code: string, message: string, headers: Record<string, string> = {}): void {
  sendJson(response, status, {error: {code, message}}, headers);
}

/** Reads at most `cap` bytes; an oversized body is rejected without buffering it whole. */
async function readBody(request: IncomingMessage, cap: number): Promise<string | null> {
  const declared = Number(request.headers["content-length"] ?? "0");
  if (Number.isFinite(declared) && declared > cap) return null;
  return await new Promise<string | null>(resolveBody => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (value: string | null): void => { if (!settled) { settled = true; resolveBody(value); } };
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > cap) { finish(null); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on("end", () => finish(Buffer.concat(chunks).toString("utf8")));
    request.on("error", () => finish(null));
  });
}

type Claims = {readonly exp?: number; readonly roles: readonly string[]};

/** Shape check only: the owner validates the signature and the audiences. */
function readClaims(token: string): Claims | null {
  try {
    const payload = token.split(".")[1];
    if (payload === undefined) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as {exp?: unknown; realm_access?: {roles?: unknown}};
    const roles = Array.isArray(parsed.realm_access?.roles) ? parsed.realm_access.roles.filter((r): r is string => typeof r === "string") : [];
    return {roles, ...(typeof parsed.exp === "number" ? {exp: parsed.exp} : {})};
  } catch { return null; }
}

const READ_ROLES = ["mcp_read_team", "mcp_read_self"];

export function createHandler(deps: ServerDeps = {}): (request: IncomingMessage, response: ServerResponse) => void {
  const sourceFactory = deps.sourceFactory ?? ((token: string): ToolSource => createTokenSource(token));
  const logger = deps.logger ?? defaultLogger;
  const maxBodyBytes = deps.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const now = deps.now ?? ((): Date => new Date());
  const llm = deps.llm === undefined ? createOllamaClient() : deps.llm;

  const assist = async (query: string, source: ToolSource): Promise<AssistantAnswer> => {
    const tools = await source.listTools();
    if (llm === null) return await answerDeterministically({query, tools, source, promptVersion: "cu25-planner-v1"});
    const answer = await askWithLlm({query, tools, source, llm, now});
    if (answer.kind !== "unavailable") return answer;
    return await answerDeterministically({query, tools, source, promptVersion: ASSISTANT_PROMPT_VERSION,
      fallbackFrom: answer.stopReason});
  };

  return (request, response) => {
    const started = Date.now();
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    const method = request.method ?? "GET";
    const tokenMatch = BEARER.exec(String(request.headers["authorization"] ?? ""));
    const token = tokenMatch?.[1] ?? null;
    const tokenSha = token === null ? null : sha(token).slice(0, 16);
    const complete = (status: number, extra: Record<string, unknown> = {}): void => {
      logger({at: now().toISOString(), method, path, status, durationMs: Date.now() - started, tokenSha256: tokenSha, ...extra});
    };
    const fail = (status: number, code: string, message: string, headers: Record<string, string> = {}): void => {
      complete(status, {errorCode: code});
      error(response, status, code, message, headers);
    };
    const challenge = {"www-authenticate": "Bearer realm=\"autonexus-agent\", error=\"invalid_token\""};

    void (async () => {
      try {
        if (path === "/health" && method === "GET") {
          complete(200, {outcome: "health"});
          sendJson(response, 200, {ok: true, service: "autonexus-agent", llm: llm !== null,
            model: llm?.model ?? null, promptVersion: ASSISTANT_PROMPT_VERSION});
          return;
        }
        if (path !== "/assistant" && path !== "/report") { fail(404, "NOT_FOUND", "Ruta no disponible."); return; }
        if (method !== "POST") {
          fail(405, "METHOD_NOT_ALLOWED", "Solo POST.", {allow: "POST"});
          return;
        }
        if (token === null) { fail(401, "TOKEN_REQUIRED", "Falta el token del usuario.", challenge); return; }
        const claims = readClaims(token);
        if (claims === null) { fail(401, "INVALID_TOKEN", "El token no es un JWT legible.", challenge); return; }
        if (claims.exp !== undefined && claims.exp * 1_000 <= now().getTime()) {
          fail(401, "TOKEN_EXPIRED", "El token expiró.", challenge);
          return;
        }
        if (!claims.roles.some(role => READ_ROLES.includes(role))) {
          fail(403, "NO_READ_SCOPE", "El token no tiene un rol de lectura de AutoNexus.");
          return;
        }

        const raw = await readBody(request, maxBodyBytes);
        if (raw === null) { fail(413, "BODY_TOO_LARGE", "El cuerpo supera el límite permitido."); return; }
        let input: Json;
        try {
          const parsed: unknown = JSON.parse(raw);
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("NOT_OBJECT");
          input = parsed as Json;
        } catch { fail(400, "INVALID_BODY", "Se espera un objeto JSON."); return; }

        const source = sourceFactory(token);
        try {
          if (path === "/assistant") {
            const query = typeof input["query"] === "string" ? input["query"].trim() : "";
            if (query.length < MIN_QUERY || query.length > MAX_QUERY) {
              fail(400, "INVALID_QUERY", "La consulta debe tener entre " + String(MIN_QUERY) + " y " + String(MAX_QUERY) + " caracteres.");
              return;
            }
            const answer = await assist(query, source);
            const unauthorized = answer.tools.some(tool => tool.error === "OWNER_UNAUTHORIZED");
            if (unauthorized) { fail(401, "TOKEN_REJECTED", "El propietario rechazó el token.", challenge); return; }
            const forbidden = answer.tools.some(tool => tool.error === "OWNER_FORBIDDEN");
            complete(forbidden ? 403 : 200, {outcome: answer.kind, answerPath: answer.path, steps: answer.steps,
              stopReason: answer.stopReason, querySha256: sha(query).slice(0, 16), queryLength: query.length});
            sendJson(response, forbidden ? 403 : 200, answer as unknown as Json);
            return;
          }

          const from = input["from"], to = input["to"];
          const report = await buildNarrativeReport({period: {from: String(from ?? ""), to: String(to ?? "")},
            source, llm, now, ...(typeof input["maxWorks"] === "number" ? {maxWorks: input["maxWorks"] as number} : {})});
          complete(200, {outcome: "report", narrativePath: report.narrative.path,
            works: report.figures.works, warnings: report.warnings.length});
          sendJson(response, 200, report as unknown as Json);
        } finally {
          await source.close();
        }
      } catch (caught) {
        if (caught instanceof ReportError) {
          const status = caught.status === 401 ? 401 : caught.status === 403 ? 403 : caught.status === 400 ? 400 : 502;
          fail(status, caught.code, caught.message, status === 401 ? challenge : {});
          return;
        }
        const code = (caught as {code?: string}).code ?? "INTERNAL_ERROR";
        fail(500, "INTERNAL_ERROR", "La operación no se completó (" + code + ").");
      }
    })();
  };
}

export interface StartOptions extends ServerDeps {
  readonly port?: number;
}

export function startServer(options: StartOptions = {}): Server {
  const port = options.port ?? Number(process.env["AGENT_PORT"] ?? DEFAULT_PORT);
  const handler = createHandler(options);
  const server = createServer(handler);
  server.listen(port, LOOPBACK, () => {
    const llm = options.llm === undefined ? "env" : options.llm === null ? "disabled" : options.llm.model;
    process.stdout.write(JSON.stringify({service: "autonexus-agent", url: "http://" + LOOPBACK + ":" + String(port),
      llm, endpoints: ["POST /assistant", "POST /report", "GET /health"]}) + String.fromCharCode(10));
  });
  return server;
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url) {
  const disabled = process.env["OLLAMA_DISABLED"] === "1";
  startServer({llm: disabled ? null : createOllamaClient()});
}
