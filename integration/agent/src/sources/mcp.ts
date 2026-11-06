/** MCP tool source: the CU29 server is the only component that talks to Operations here. */
import {readFileSync} from "node:fs";
import {authorize} from "../../../../services/employees/scripts/local-pkce.mjs";
import type {ToolInfo, ToolOutcome} from "../agent.js";

export interface ToolSource {
  listTools(): Promise<readonly ToolInfo[]>;
  call(name: string, args: Record<string, unknown>): Promise<ToolOutcome>;
  close(): Promise<void>;
}

export const ORIGIN = "http://127.0.0.1:4286";
export const RESOURCE = "http://127.0.0.1:3006/mcp";
export const SCOPES: Record<string, string> = {
  chief: "openid mcp mcp:orders:read mcp:agenda:read:team mcp:executions:read:team",
  mechanicA: "openid mcp mcp:agenda:read:self mcp:executions:read:self",
};
export function accounts(): Record<string, Record<string, unknown>> {
  return JSON.parse(readFileSync("output/stack/cu16-proof.accounts.private.json", "utf8")).accounts;
}

export async function connectMcp(account: "chief" | "mechanicA"): Promise<ToolSource> {
  const fixture = accounts()[account] as {username?: string; password?: string} | undefined;
  if (!fixture?.username || !fixture.password) throw Object.assign(new Error("FIXTURE_MISSING"), {code: "SYNTHETIC_ACCOUNT_REQUIRED"});
  const tokens = await authorize({username: fixture.username!, password: fixture.password!, enabled: true}, false, {
    issuer: ORIGIN + "/identity/realms/autonexus", client: "autonexus-mcp-local-reader",
    redirect: "http://127.0.0.1:4390/auth/callback", scope: SCOPES[account], resource: RESOURCE,
  });
  const {Client, StreamableHTTPClientTransport} = await import("@modelcontextprotocol/client");
  const client = new Client({name: "autonexus-internal-assistant", version: "0.1.0"});
  await client.connect(new StreamableHTTPClientTransport(new URL(RESOURCE), {authProvider: {token: async () => tokens.access_token}}));
  return {
    async listTools() {
      const {tools} = await client.listTools();
      return tools.map(tool => ({name: tool.name, description: tool.description ?? ""}));
    },
    async call(name, args) {
      try {
        const result = await client.callTool({name, arguments: args});
        const structured = result.structuredContent as Record<string, unknown> | undefined;
        if (result.isError === true) {
          const error = structured?.["error"] as Record<string, unknown> | undefined;
          const status = typeof error?.["status"] === "number" ? {status: error["status"] as number} : {};
          return {ok: false, error: {code: String(error?.["code"] ?? "TOOL_ERROR"), ...status}};
        }
        return {ok: true, data: structured ?? null};
      } catch (error) {
        const name = (error as {name?: string}).name ?? "";
        const required = (error as {requiredScope?: string}).requiredScope;
        const denied = required !== undefined || name === "InsufficientScopeError" || /insufficient_scope/i.test(String((error as Error).message ?? ""));
        return {ok: false, error: denied ? {code: "INSUFFICIENT_SCOPE", status: 403} : {code: "TOOL_CALL_FAILED"}};
      }
    },
    async close() { await client.close(); },
  };
}
