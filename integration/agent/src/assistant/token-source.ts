/**
 * Token-scoped REST tool source for the local HTTP service.
 *
 * The assistant service never mints an identity: it forwards the caller's `Authorization: Bearer`
 * token to Operations and lets the owner decide. The catalogue is derived from the roles carried by
 * that same token, so what the model may call and what the owner accepts come from one source.
 */
import type {ToolInfo, ToolOutcome} from "../agent.js";
import type {ToolSource} from "../sources/mcp.js";

const DEFAULT_OPERATIONS = "http://127.0.0.1:8081";
/**
 * Budget for one owner read. A month of team agenda or a work with many advances is a heavier read than
 * a single order, and 8 s turned a slow answer into OWNER_UNAVAILABLE during the report (measured
 * 2026-11-06). It stays bounded because every call is also bounded by the caller's own deadline.
 */
const DEFAULT_TIMEOUT_MS = 20_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ORDERS: readonly ToolInfo[] = [
  {name: "autonexus_list_orders", description: "List globally authorized orders"},
  {name: "autonexus_get_order", description: "Read one authorized order"},
];
const TEAM: readonly ToolInfo[] = [
  {name: "autonexus_list_team_agenda", description: "Read the authorized team agenda"},
  {name: "autonexus_get_team_execution", description: "Read authorized team execution by assignmentId"},
];
const SELF: readonly ToolInfo[] = [
  {name: "autonexus_list_my_agenda", description: "Read the caller's own agenda"},
  {name: "autonexus_get_my_execution", description: "Read the caller's own execution by assignmentId"},
];

/** Read scope roles, as provisioned for the local synthetic accounts (CU29). */
export function catalogueForToken(accessToken: string): readonly ToolInfo[] {
  try {
    const claims = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString()) as
      {realm_access?: {roles?: string[]}};
    const roles = claims.realm_access?.roles ?? [];
    const tools: ToolInfo[] = [];
    if (roles.includes("mcp_read_team")) tools.push(...ORDERS, ...TEAM);
    if (roles.includes("mcp_read_self")) tools.push(...SELF);
    return tools;
  } catch { return []; }
}

const record = (value: unknown): Record<string, unknown> =>
  (value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const iso = (value: unknown): string => (typeof value === "string" ? value : "");
const count = (value: unknown): number => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0);
const bounded = (value: unknown, fallback: number, max: number): number => {
  const number = typeof value === "number" && Number.isInteger(value) ? value : fallback;
  return number >= 1 && number <= max ? number : fallback;
};
const summaryOf = (value: unknown): {pending: number; available: number; failed: number} => {
  const summary = record(value);
  return {pending: count(summary["pending"]), available: count(summary["available"]), failed: count(summary["failed"])};
};

const projectOrder = (value: unknown): Record<string, unknown> => {
  const order = record(value);
  return {id: order["id"], number: order["number"], status: order["status"], priority: order["priority"],
    version: order["version"], createdAt: order["createdAt"], updatedAt: order["updatedAt"],
    items: list(order["items"]).map(service => { const s = record(service);
      return {serviceId: s["serviceId"], serviceName: s["serviceName"], quantity: s["quantity"],
        estimatedMinutes: s["estimatedMinutes"]}; })};
};

const projectAgenda = (value: unknown): Record<string, unknown> => {
  const work = record(value);
  const progress = record(work["executionProgress"]);
  return {assignmentId: work["assignmentId"], orderId: work["orderId"], orderNumber: work["orderNumber"],
    employee: {id: record(work["employee"])["id"]}, startsAt: work["startsAt"], endsAt: work["endsAt"],
    priority: work["priority"], status: work["status"], orderVersion: work["orderVersion"],
    assignmentVersion: work["assignmentVersion"], observedAt: work["observedAt"],
    confirmationObservation: work["confirmationObservation"], executionStatus: work["executionStatus"],
    executionProgress: {advances: progress["advances"], lastAdvanceAt: progress["lastAdvanceAt"],
      availableEvidence: progress["availableEvidence"]}};
};

export interface TokenSourceOptions {
  readonly operationsUrl?: string;
  readonly timeoutMs?: number;
}

export function createTokenSource(accessToken: string, options: TokenSourceOptions = {}): ToolSource {
  const base = (options.operationsUrl ?? process.env["OPERATIONS_URL"] ?? DEFAULT_OPERATIONS).replace(/\/+$/, "");
  // Configurable for a slower machine; a value that is not a positive integer keeps the documented default.
  const configured = Number(process.env["OWNER_TIMEOUT_MS"]);
  const timeoutMs = options.timeoutMs
    ?? (Number.isFinite(configured) && configured >= 1_000 ? configured : DEFAULT_TIMEOUT_MS);
  const tools = catalogueForToken(accessToken);

  const get = async (path: string): Promise<ToolOutcome> => {
    let response: Response;
    try {
      response = await fetch(base + path, {method: "GET", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
        headers: {accept: "application/json", authorization: "Bearer " + accessToken}});
    } catch {
      return {ok: false, error: {code: "OWNER_UNAVAILABLE"}};
    }
    if (!response.ok) {
      const code = response.status === 403 ? "OWNER_FORBIDDEN" : response.status === 404 ? "OWNER_NOT_FOUND"
        : response.status === 401 ? "OWNER_UNAUTHORIZED" : response.status === 400 ? "VALIDATION_ERROR" : "OWNER_UNAVAILABLE";
      return {ok: false, error: {code, status: response.status}};
    }
    try {
      return {ok: true, data: await response.json()};
    } catch {
      return {ok: false, error: {code: "OWNER_UNAVAILABLE", status: response.status}};
    }
  };

  const execution = async (scope: "me" | "team", args: Readonly<Record<string, unknown>>): Promise<ToolOutcome> => {
    const assignmentId = iso(args["assignmentId"]);
    if (!UUID.test(assignmentId)) return {ok: false, error: {code: "VALIDATION_ERROR", status: 400}};
    const raw = await get("/executions/" + scope + "/" + encodeURIComponent(assignmentId));
    if (!raw.ok) return raw;
    const body = record(raw.data);
    const executionRecord = record(body["data"] ?? body);
    const advanceLimit = bounded(args["advanceLimit"], 20, 50);
    const allAdvances = list(executionRecord["advances"]);
    const advances = allAdvances.slice(0, advanceLimit).map(advance => {
      const a = record(advance);
      const evidences = list(a["evidences"]).map(e => record(e));
      return {id: a["id"], sequence: a["sequence"], minutesWorked: a["minutesWorked"], occurredAt: a["occurredAt"],
        recordedAt: a["recordedAt"], version: a["version"],
        evidenceCounts: {pending: evidences.filter(e => e["state"] === "pending").length,
          available: evidences.filter(e => e["state"] === "available").length,
          failed: evidences.filter(e => e["state"] === "failed").length}};
    });
    return {ok: true, data: {source: "operations", scope, observedAt: new Date().toISOString(), ok: true,
      data: {id: executionRecord["id"], orderId: executionRecord["orderId"], orderNumber: executionRecord["orderNumber"],
        assignmentId: executionRecord["assignmentId"] ?? assignmentId, employeeId: executionRecord["employeeId"],
        status: executionRecord["status"], startedAt: executionRecord["startedAt"], version: executionRecord["version"],
        evidenceSummary: summaryOf(executionRecord["evidenceSummary"]), advances},
      page: {total: allAdvances.length, limit: advanceLimit, offset: 0}}};
  };

  return {
    async listTools() { return tools; },
    async call(name, args) {
      if (name === "autonexus_list_orders") {
        const raw = await get("/orders?limit=" + String(bounded(args["limit"], 20, 50)) + "&offset=0");
        if (!raw.ok) return raw;
        const page = record(raw.data);
        return {ok: true, data: {source: "operations", scope: "global", observedAt: new Date().toISOString(),
          ok: true, data: list(page["items"]).map(projectOrder),
          page: {total: page["total"], limit: page["limit"], offset: page["offset"]}}};
      }
      if (name === "autonexus_get_order") {
        const orderId = iso(args["orderId"]);
        if (!UUID.test(orderId)) return {ok: false, error: {code: "VALIDATION_ERROR", status: 400}};
        const raw = await get("/orders/" + encodeURIComponent(orderId));
        if (!raw.ok) return raw;
        const body = record(raw.data);
        return {ok: true, data: {source: "operations", scope: "global", observedAt: new Date().toISOString(),
          ok: true, data: projectOrder(body["data"] ?? body)}};
      }
      if (name === "autonexus_list_team_agenda" || name === "autonexus_list_my_agenda") {
        const from = iso(args["from"]), to = iso(args["to"]);
        if (!DATE.test(from) || !DATE.test(to)) return {ok: false, error: {code: "VALIDATION_ERROR", status: 400}};
        const scope = name.endsWith("my_agenda") ? "me" : "team";
        const raw = await get("/agenda/" + scope + "?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to) +
          "&limit=" + String(bounded(args["limit"], 20, 50)) + "&offset=0");
        if (!raw.ok) return raw;
        const page = record(raw.data);
        return {ok: true, data: {source: "operations", scope, observedAt: page["observedAt"], ok: true,
          data: list(page["items"]).map(projectAgenda),
          period: {from: page["from"], to: page["to"], timeZone: page["timeZone"]},
          page: {total: page["total"], limit: page["limit"], offset: page["offset"]}}};
      }
      if (name === "autonexus_get_team_execution") return execution("team", args);
      if (name === "autonexus_get_my_execution") return execution("me", args);
      return {ok: false, error: {code: "TOOL_NOT_AVAILABLE", status: 404}};
    },
    async close() { /* stateless fetches: nothing to release */ },
  };
}
