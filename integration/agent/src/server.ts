/**
 * Loopback HTTP service for the CU25 assistant and the CU26 narrative report.
 *
 * The caller's own bearer token is forwarded to Operations: this process mints no identity and
 * never talks MCP. Tokens and question text are never logged; only digests, lengths and outcomes.
 */
import {createServer, type IncomingMessage, type Server, type ServerResponse} from "node:http";
import {createHash, randomUUID} from "node:crypto";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {createOllamaClient, type LlmClient} from "./llm/ollama.js";
import {ASSISTANT_PROMPT_VERSION, askWithLlm, type AssistantAnswer} from "./assistant/llm-assistant.js";
import {answerDeterministically} from "./assistant/deterministic.js";
import {createTokenSource} from "./assistant/token-source.js";
import {buildNarrativeReport, ReportError, validatePeriod} from "./report/narrative-report.js";
import {ReportJobStore, type ReportJob} from "./report/jobs.js";
import {publicJob, QUEUE_FULL, ReportJobRunner} from "./report/job-runner.js";
import {WeeklyDeliveryStore, WeeklyDeliveryStoreError} from "./report/weekly-deliveries.js";
import {createReportAuthorizer, type AuthorizeReport} from "./report/authorization.js";
import {checkReportContract} from "./report/contract.js";
import type {ToolSource} from "./sources/mcp.js";

export const DEFAULT_PORT = 3099;
export const DEFAULT_MAX_BODY_BYTES = 16_384;
const LOOPBACK = "127.0.0.1";
const BEARER = /^Bearer ([A-Za-z0-9._~+/=-]{20,})$/;
const MIN_QUERY = 3;
const MAX_QUERY = 1_000;
const WEEKLY_PATH = "/report/weekly/deliveries";
const WEEKLY_ACK = new RegExp("^/report/weekly/deliveries/([0-9a-f-]{36})/ack$", "i");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOB_PATH = /^\/report\/jobs\/([0-9a-f-]{36})$/i;

export interface ServerDeps {
  /** null disables the model: every request then answers through the deterministic planner. */
  readonly llm?: LlmClient | null;
  readonly sourceFactory?: (token: string) => ToolSource;
  readonly authorizeReport?: AuthorizeReport;
  readonly now?: () => Date;
  readonly logger?: (entry: Readonly<Record<string, unknown>>) => void;
  readonly maxBodyBytes?: number;
  /** Where the report jobs are persisted; defaults to `output/agent/jobs` under the working directory. */
  readonly jobDirectory?: string;
  /** Jobs kept on disk before the oldest finished ones are dropped. */
  readonly jobRetention?: number;
  /** Jobs waiting plus running before the caller is told to come back later. */
  readonly jobCapacity?: number;
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

type Claims = {readonly sub: string | null; readonly exp?: number; readonly roles: readonly string[]};

/** Shape check only: the owner validates the signature and the audiences. */
function readClaims(token: string): Claims | null {
  try {
    const payload = token.split(".")[1];
    if (payload === undefined) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as
      {sub?: unknown; exp?: unknown; realm_access?: {roles?: unknown}};
    const roles = Array.isArray(parsed.realm_access?.roles) ? parsed.realm_access.roles.filter((r): r is string => typeof r === "string") : [];
    return {sub: typeof parsed.sub === "string" ? parsed.sub : null,
      roles, ...(typeof parsed.exp === "number" ? {exp: parsed.exp} : {})};
  } catch { return null; }
}

const READ_ROLES = ["mcp_read_team", "mcp_read_self"];

/** The owner resource each catalogue tool reads; provenance names the source, not the payload. */
const TOOL_RESOURCES: Readonly<Record<string, string>> = Object.freeze({
  autonexus_list_orders: "/orders",
  autonexus_get_order: "/orders/{orderId}",
  autonexus_list_my_agenda: "/agenda/me",
  autonexus_list_team_agenda: "/agenda/team",
  autonexus_get_my_execution: "/executions/review-self/{assignmentId}",
  autonexus_get_team_execution: "/executions/team/{assignmentId}",
});

/**
 * Publishes the contract answer. The planner's internal record carries the reasoning steps and the
 * safety verdict; the contract publishes the reader-facing fields, and a template answer declares no
 * model because none wrote it.
 */
export function publishedAnswer(answer: AssistantAnswer, at: Date): Record<string, unknown> {
  const answered = answer.kind === "answer" || answer.kind === "clarification";
  return {
    answer: answer.text,
    refused: answer.kind === "refused" || answer.kind === "unavailable",
    toolsUsed: [...new Set(answer.tools.filter(tool => tool.ok).map(tool => tool.tool))],
    // The contract always names what wrote the text: the model, or the planner's own version.
    model: answer.path === "llm" ? (answer.model ?? answer.promptVersion) : answer.promptVersion,
    generatedAt: at.toISOString(),
    references: [],
    provenance: [...new Set(answer.tools.filter(tool => tool.ok).map(tool => tool.tool))]
      .map(tool => ({service: "operations", resource: TOOL_RESOURCES[tool] ?? tool, tool, observedAt: at.toISOString()})),
    limitations: [
      ...answer.warnings,
      ...(answered ? [] : ["La respuesta no se completó dentro de los límites del asistente."]),
      ...(answer.path === "llm" ? [] : ["La respuesta la redactó el planificador determinista"
        + (answer.fallbackFrom === undefined ? " (modelo deshabilitado)." : " (el modelo no respondió: " + answer.fallbackFrom + ").")]),
    ],
  };
}

export function createHandler(deps: ServerDeps = {}): (request: IncomingMessage, response: ServerResponse) => void {
  const sourceFactory = deps.sourceFactory ?? ((token: string): ToolSource => createTokenSource(token));
  const logger = deps.logger ?? defaultLogger;
  const maxBodyBytes = deps.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const now = deps.now ?? ((): Date => new Date());
  const llm = deps.llm === undefined ? createOllamaClient() : deps.llm;
  const authorizeReport = deps.authorizeReport ?? createReportAuthorizer({sourceFactory});

  const jobDirectory = deps.jobDirectory ?? process.env["REPORT_JOBS_DIR"] ?? resolve(process.cwd(), "output/agent/jobs");
  const jobStore = new ReportJobStore({directory: jobDirectory,
    ...(deps.jobRetention === undefined ? {} : {keep: deps.jobRetention})});
  const weeklyStore = new WeeklyDeliveryStore({directory: resolve(jobDirectory, "weekly-deliveries")});
  const jobs = new ReportJobRunner({store: jobStore, sourceFactory, build: buildNarrativeReport, llm, now,
    logger: entry => logger(entry), ...(deps.jobCapacity === undefined ? {} : {capacity: deps.jobCapacity})});
  // A job left open by a previous process cannot resume: its token was never written down.
  const interrupted = jobs.recover();
  if (interrupted > 0) logger({at: now().toISOString(), outcome: "jobs-interrupted-on-start", count: interrupted});

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
    const jobPath = JOB_PATH.exec(path);
    const weeklyAck = WEEKLY_ACK.exec(path);
    const known = path === "/assistant" || path === "/report" || path === "/report/jobs" || jobPath !== null
      || path === WEEKLY_PATH || weeklyAck !== null;

    void (async () => {
      try {
        if (path === "/health" && method === "GET") {
          complete(200, {outcome: "health"});
          sendJson(response, 200, {ok: true, service: "autonexus-agent", llm: llm !== null,
            model: llm?.model ?? null, promptVersion: ASSISTANT_PROMPT_VERSION, pendingJobs: jobs.pending});
          return;
        }
        if (!known) { fail(404, "NOT_FOUND", "Ruta no disponible."); return; }
        const allowed = path === "/report/jobs" ? "POST" : jobPath !== null ? "GET" : "POST";
        if (method !== allowed) {
          fail(405, "METHOD_NOT_ALLOWED", "Solo " + allowed + ".", {allow: allowed});
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

        // Reading a job is an access like any other: the token must be valid and the job must be the
        // caller's. A job of another account is answered as not found, never as forbidden, so the
        // endpoint does not confirm that an identifier exists.
        if (jobPath !== null) {
          const job = jobStore.load(jobPath[1] ?? "");
          if (job === null || claims.sub === null || job.subject !== claims.sub) {
            fail(404, "JOB_NOT_FOUND", "No hay un trabajo con ese identificador para esta cuenta.");
            return;
          }
          await authorizeReport(token, {from: job.from, to: job.to}, job.document);
          complete(200, {outcome: "job-status", jobId: job.jobId, jobStatus: job.status});
          sendJson(response, 200, publicJob(job));
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

        if (path === WEEKLY_PATH || weeklyAck !== null) {
          if (claims.sub === null) { fail(401, "INVALID_TOKEN", "El token no identifica una cuenta.", challenge); return; }
          if (weeklyAck !== null) {
            if (Object.keys(input).some(key => !["eventId", "status"].includes(key))
                || typeof input["eventId"] !== "string" || !UUID.test(input["eventId"])
                || !["recorded", "duplicate"].includes(String(input["status"]))) {
              fail(400, "INVALID_RECEIPT", "Se requiere un recibo de entrega válido."); return;
            }
            const entry = weeklyStore.find(claims.sub, weeklyAck[1] ?? "");
            if (entry === null) { fail(404, "DELIVERY_NOT_FOUND", "Entrega no disponible."); return; }
            await authorizeReport(token, entry.period, entry.report);
            const saved = weeklyStore.acknowledge(claims.sub, entry.operationId, input["eventId"],
              input["status"] as "recorded" | "duplicate", now().toISOString());
            const {subject: ignored, ...view} = saved;
            sendJson(response, 200, view); complete(200, {outcome: "weekly-delivered", eventId: saved.eventId}); return;
          }
          if (Object.keys(input).some(key => !["from", "to"].includes(key))) {
            fail(400, "INVALID_PERIOD", "Sólo se acepta el período candidato."); return;
          }
          const candidate = validatePeriod(String(input["from"] ?? ""), String(input["to"] ?? ""));
          const pending = weeklyStore.pending(claims.sub);
          await authorizeReport(token, pending?.period ?? candidate, pending?.report);
          let entry = weeklyStore.select(claims.sub, candidate, now().toISOString());
          if (entry.report === null) {
            const existingJob = jobStore.findByOperation(claims.sub, entry.operationId);
            if (existingJob !== null) {
              entry = weeklyStore.bindJob(claims.sub, entry.operationId, existingJob.jobId);
              if (existingJob.status === "succeeded") {
                await authorizeReport(token, entry.period, existingJob.document);
                if (checkReportContract(existingJob.document).length !== 0) throw new ReportError("INVALID_REPORT", "El documento no cumple el contrato.", 502);
                entry = weeklyStore.saveReady(claims.sub, entry.operationId, existingJob.jobId, existingJob.document);
              }
            }
          }
          await authorizeReport(token, entry.period, entry.report);
          const {subject: ignored, ...view} = entry;
          sendJson(response, 200, view); complete(200, {outcome: "weekly-delivery", eventId: entry.eventId}); return;
        }

        if (path === "/report/jobs") {
          const operationId = typeof input["operationId"] === "string" ? input["operationId"].trim() : "";
          if (!UUID.test(operationId)) {
            fail(400, "INVALID_OPERATION_ID", "Se espera un operationId UUID del cliente para no duplicar la generación.");
            return;
          }
          if (claims.sub === null) { fail(401, "INVALID_TOKEN", "El token no identifica a una cuenta.", challenge); return; }
          const prior = jobStore.findByOperation(claims.sub, operationId);
          const period = validatePeriod(prior?.from ?? String(input["from"] ?? ""), prior?.to ?? String(input["to"] ?? ""));
          await authorizeReport(token, period, prior?.document);
          // Authorization yields: another request may have created the same operation meanwhile.
          const existing = jobStore.findByOperation(claims.sub, operationId);
          if (existing !== null) {
            await authorizeReport(token, {from: existing.from, to: existing.to}, existing.document);
            complete(200, {outcome: "job-reused", jobId: existing.jobId, jobStatus: existing.status});
            sendJson(response, 200, {...publicJob(existing), reused: true});
            return;
          }
          const requestedAt = now().toISOString();
          const job: ReportJob = {jobId: randomUUID(), operationId, subject: claims.sub,
            from: period.from, to: period.to,
            tokenExpiresAt: claims.exp === undefined ? null : claims.exp * 1_000,
            requestedAt, startedAt: null, finishedAt: null, status: "queued",
            document: null, failure: null};
          const weeklyIntent = weeklyStore.find(claims.sub, operationId);
          if (weeklyIntent?.jobId) { fail(409, "WEEKLY_JOB_MISSING", "El trabajo vinculado no está disponible; requiere revisión operativa."); return; }
          if (weeklyIntent !== null) weeklyStore.bindJob(claims.sub, operationId, job.jobId);
          // Written before it is queued: a reload must find the same identifier, not a new generation.
          jobStore.save(job);
          if (!jobs.submit(job, token)) {
            jobStore.save({...job, status: "failed", finishedAt: now().toISOString(),
              failure: {code: QUEUE_FULL, message: "Hay trabajos pendientes; vuelva a intentarlo en unos minutos."}});
            fail(503, QUEUE_FULL, "Hay trabajos pendientes; vuelva a intentarlo en unos minutos.");
            return;
          }
          complete(202, {outcome: "job-created", jobId: job.jobId});
          sendJson(response, 202, {...publicJob(job), reused: false});
          return;
        }

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
            sendJson(response, forbidden ? 403 : 200, publishedAnswer(answer, now()) as Json);
            return;
          }

          const from = input["from"], to = input["to"];
          await authorizeReport(token, {from: String(from ?? ""), to: String(to ?? "")});
          const report = await buildNarrativeReport({period: {from: String(from ?? ""), to: String(to ?? "")},
            source, llm, now, ...(typeof input["maxWorks"] === "number" ? {maxWorks: input["maxWorks"] as number} : {})});
          complete(200, {outcome: "report", narrativePath: report.narrative.path, generative: report.narrative.generative,
            totalWorks: report.figures.totalWorks, claims: report.claims.length, limitations: report.limitations.length});
          sendJson(response, 200, report as unknown as Json);
        } finally {
          await source.close();
        }
      } catch (caught) {
        const weeklyFailure = caught as {code?: string; status?: number};
        if (caught instanceof WeeklyDeliveryStoreError) {
          const status = [400, 404, 409, 503].includes(weeklyFailure.status ?? 0) ? weeklyFailure.status as number : 503;
          fail(status, caught.code, "No se pudo confirmar el estado durable de la entrega semanal."); return;
        }
        if (caught instanceof ReportError) {
          const status = caught.status === 401 ? 401 : caught.status === 403 ? 403 : caught.status === 400 ? 400 : caught.status === 503 ? 503 : 502;
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
  /**
   * Address to listen on. Loopback by default; inside a container it is `0.0.0.0` so the BFF reaches it
   * over the project network, and no port is published to the host.
   */
  readonly host?: string;
}

export function startServer(options: StartOptions = {}): Server {
  const port = options.port ?? Number(process.env["AGENT_PORT"] ?? DEFAULT_PORT);
  const host = options.host ?? process.env["AGENT_HOST"] ?? LOOPBACK;
  const handler = createHandler(options);
  const server = createServer(handler);
  server.listen(port, host, () => {
    const llm = options.llm === undefined ? "env" : options.llm === null ? "disabled" : options.llm.model;
    process.stdout.write(JSON.stringify({service: "autonexus-agent", url: "http://" + host + ":" + String(port),
      llm, endpoints: ["POST /assistant", "POST /report", "POST /report/jobs", "GET /report/jobs/{jobId}", "GET /health"],
      jobs: process.env["REPORT_JOBS_DIR"] ?? "(default)"}) + String.fromCharCode(10));
  });
  return server;
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url) {
  const disabled = process.env["OLLAMA_DISABLED"] === "1";
  startServer({llm: disabled ? null : createOllamaClient()});
}
