/**
 * Direct REST tool source: proves CU25 keeps working when the MCP server is stopped.
 * Uses the confidential local reader client (same delegated synthetic identity) and the same
 * six read operations, with an explicit allowlist projection and no writes.
 */
import {readFileSync} from "node:fs";
import {authorize} from "../../../../services/employees/scripts/local-pkce.mjs";
import {accounts, ORIGIN, type ToolSource} from "./mcp.js";
import type {ToolInfo, ToolOutcome} from "../agent.js";

const OPERATIONS = "http://127.0.0.1:8081";
const SCOPE = "openid n8n:api:read";
const TOOLS: readonly ToolInfo[] = [
  {name: "autonexus_list_orders", description: "List globally authorized orders"},
  {name: "autonexus_list_team_agenda", description: "Read the authorized team agenda"},
  {name: "autonexus_get_team_execution", description: "Read authorized team execution by assignmentId"},
];

const record = (value: unknown): Record<string, unknown> => (value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const iso = (value: unknown): string => (typeof value === "string" ? value : "");

export async function createRestSource(account: "chief" | "mechanicA"): Promise<ToolSource> {
  const fixture = accounts()[account] as {username?: string; password?: string} | undefined;
  const secret = JSON.parse(readFileSync("output/mcp-read/fixture/n8n-client.private.json", "utf8"));
  if (!fixture?.username || !fixture.password || !secret?.clientSecret) throw Object.assign(new Error("FIXTURE_MISSING"), {code: "SYNTHETIC_ACCOUNT_REQUIRED"});
  const tokens = await authorize({username: fixture.username, password: fixture.password, enabled: true}, false, {
    issuer: ORIGIN + "/identity/realms/autonexus", client: secret.clientId, clientSecret: secret.clientSecret,
    redirect: "http://127.0.0.1:5678/rest/oauth2-credential/callback", scope: SCOPE,
  });
  const get = async (path: string): Promise<ToolOutcome> => {
    const response = await fetch(OPERATIONS + path, {method: "GET", redirect: "error", signal: AbortSignal.timeout(8000),
      headers: {accept: "application/json", authorization: "Bearer " + tokens.access_token}});
    if (!response.ok) {
      const code = response.status === 403 ? "OWNER_FORBIDDEN" : response.status === 404 ? "OWNER_NOT_FOUND" : response.status === 401 ? "OWNER_UNAUTHORIZED" : "OWNER_UNAVAILABLE";
      return {ok: false, error: {code, status: response.status}};
    }
    return {ok: true, data: await response.json()};
  };
  return {
    async listTools() { return TOOLS; },
    async call(name, args) {
      if (name === "autonexus_list_orders") {
        const raw = await get("/orders?limit=" + String(args["limit"] ?? 20) + "&offset=0");
        if (!raw.ok) return raw;
        const page = record(raw.data);
        const items = list(page["items"]).map(item => {
          const order = record(item);
          return {id: order["id"], number: order["number"], status: order["status"], priority: order["priority"],
            version: order["version"], createdAt: order["createdAt"], updatedAt: order["updatedAt"],
            items: list(order["items"]).map(service => { const s = record(service);
              return {serviceId: s["serviceId"], serviceName: s["serviceName"], quantity: s["quantity"], estimatedMinutes: s["estimatedMinutes"]}; })};
        });
        return {ok: true, data: {source: "operations", scope: "global", observedAt: new Date().toISOString(),
          ok: true, data: items, page: {total: page["total"], limit: page["limit"], offset: page["offset"]}}};
      }
      if (name === "autonexus_list_team_agenda") {
        const from = iso(args["from"]), to = iso(args["to"]);
        const raw = await get("/agenda/team?from=" + from + "&to=" + to + "&limit=" + String(args["limit"] ?? 20) + "&offset=0");
        if (!raw.ok) return raw;
        const page = record(raw.data);
        const items = list(page["items"]).map(item => {
          const work = record(item);
          const progress = record(work["executionProgress"]);
          return {assignmentId: work["assignmentId"], orderId: work["orderId"], orderNumber: work["orderNumber"],
            employee: {id: record(work["employee"])["id"]}, startsAt: work["startsAt"], endsAt: work["endsAt"],
            priority: work["priority"], status: work["status"], orderVersion: work["orderVersion"],
            assignmentVersion: work["assignmentVersion"], observedAt: work["observedAt"],
            confirmationObservation: work["confirmationObservation"], executionStatus: work["executionStatus"],
            executionProgress: {advances: progress["advances"], lastAdvanceAt: progress["lastAdvanceAt"], availableEvidence: progress["availableEvidence"]}};
        });
        return {ok: true, data: {source: "operations", scope: "team", observedAt: page["observedAt"], ok: true,
          data: items, period: {from: page["from"], to: page["to"], timeZone: page["timeZone"]},
          page: {total: page["total"], limit: page["limit"], offset: page["offset"]}}};
      }
      if (name === "autonexus_get_team_execution") {
        const assignmentId = iso(args["assignmentId"]);
        if (!/^[0-9a-f-]{36}$/i.test(assignmentId)) return {ok: false, error: {code: "VALIDATION_ERROR", status: 400}};
        const raw = await get("/executions/team/" + encodeURIComponent(assignmentId));
        if (!raw.ok) return raw;
        const execution = record(raw.data);
        const advances = list(execution["advances"]).slice(0, Number(args["advanceLimit"] ?? 10)).map(advance => {
          const a = record(advance);
          const evidences = list(a["evidences"]).map(e => record(e));
          return {id: a["id"], sequence: a["sequence"], minutesWorked: a["minutesWorked"], occurredAt: a["occurredAt"],
            recordedAt: a["recordedAt"], version: a["version"],
            evidenceCounts: {pending: evidences.filter(e => e["state"] === "pending").length,
              available: evidences.filter(e => e["state"] === "available").length,
              failed: evidences.filter(e => e["state"] === "failed").length}};
        });
        return {ok: true, data: {source: "operations", scope: "team", observedAt: new Date().toISOString(), ok: true,
          data: {id: execution["id"], orderId: execution["orderId"], orderNumber: execution["orderNumber"],
            assignmentId: execution["assignmentId"], employeeId: execution["employeeId"], status: execution["status"],
            startedAt: execution["startedAt"], version: execution["version"],
            evidenceSummary: execution["evidenceSummary"], advances},
          page: {total: list(execution["advances"]).length, limit: Number(args["advanceLimit"] ?? 10), offset: 0}}};
      }
      return {ok: false, error: {code: "TOOL_NOT_AVAILABLE", status: 404}};
    },
    async close() { /* stateless fetches */ },
  };
}
