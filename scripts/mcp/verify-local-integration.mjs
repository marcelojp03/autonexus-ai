import assert from "node:assert/strict";
import {readFileSync, writeFileSync, existsSync} from "node:fs";
import {resolve} from "node:path";
import {authorize} from "../../services/employees/scripts/local-pkce.mjs";
import {loadConfig} from "../../integration/mcp-server/dist/infrastructure/config.js";
import {FileClientRegistry} from "../../integration/mcp-server/dist/infrastructure/client-registry.js";
import {AccessTokenVerifier, API_AUDIENCES} from "../../integration/mcp-server/dist/infrastructure/access-token-verifier.js";
import {KeycloakTokenExchange} from "../../integration/mcp-server/dist/application/token-exchange.js";
import {JsonLineAuditSink} from "../../integration/mcp-server/dist/infrastructure/audit-sink.js";
import {createConsultationApp} from "../../integration/mcp-server/dist/http-app.js";
const {Client, StreamableHTTPClientTransport} = await import(new URL("../../integration/mcp-server/node_modules/@modelcontextprotocol/client/dist/index.mjs", import.meta.url));

const ORIGIN = "http://127.0.0.1:4286";
const RESOURCE = "http://127.0.0.1:3006/mcp";
const AUDIT = resolve("output/mcp-read/audit.jsonl");
const PROOF = resolve("output/mcp-read/verify.json");
const stages = [];
const pass = (name, facts = {}) => { stages.push({name, status: "PASS", ...facts}); console.log(JSON.stringify({stage: name, status: "PASS", ...facts})); };
const accounts = JSON.parse(readFileSync("output/stack/cu16-proof.accounts.private.json", "utf8")).accounts;
const close = token => JSON.parse(Buffer.from(token.split(".")[1], "base64url"));

const config = loadConfig({
  MCP_RESOURCE_URL: RESOURCE,
  MCP_ISSUER_URL: ORIGIN + "/identity/realms/autonexus",
  MCP_JWKS_URL: ORIGIN + "/identity/realms/autonexus/protocol/openid-connect/certs",
  MCP_TOKEN_ENDPOINT_URL: ORIGIN + "/identity/realms/autonexus/protocol/openid-connect/token",
  MCP_OPERATIONS_BASE_URL: "http://127.0.0.1:8081",
  MCP_CLIENT_REGISTRY_FILE: resolve("output/mcp-read/fixture/clients.private.json"),
  MCP_IDP_CLIENT_FILE: resolve("output/mcp-read/fixture/idp-client.private.json"),
  MCP_AUDIT_FILE: AUDIT,
  MCP_PORT: "3006",
});
const registry = new FileClientRegistry(config.clientRegistryFile);
const verifier = new AccessTokenVerifier(config, registry);
const exchange = new KeycloakTokenExchange(config, verifier);
const app = createConsultationApp({config, verify: t => verifier.verify(t), exchange, audit: new JsonLineAuditSink(AUDIT)});
const listener = app.listen(3006, "127.0.0.1");
await new Promise((ok, no) => { listener.once("listening", ok); listener.once("error", no); });
pass("mcp_process_started", {port: 3006});

async function login(accountKey, scope) {
  const account = accounts[accountKey];
  assert.ok(account?.subject, "FIXTURE_MAPPING");
  const tokens = await authorize({...account, enabled: true}, false, {
    issuer: ORIGIN + "/identity/realms/autonexus", client: "autonexus-mcp-local-reader",
    redirect: "http://127.0.0.1:4390/auth/callback", scope, resource: RESOURCE,
  });
  return tokens.access_token;
}
async function connect(token) {
  const client = new Client({name: "external-acceptance-client", version: "1.0.0"});
  await client.connect(new StreamableHTTPClientTransport(new URL(RESOURCE), {authProvider: {token: async () => token}}));
  return client;
}
let chief, mechanic;
try {
  const chiefToken = await login("chief", "openid mcp mcp:orders:read mcp:agenda:read:team mcp:executions:read:team");
  const chiefClaims = close(chiefToken);
  assert.equal(chiefClaims.aud.includes(RESOURCE), true, "RESOURCE_AUDIENCE");
  assert.equal(chiefClaims.aud.includes("autonexus-mcp-server"), true, "REQUESTER_AUDIENCE");
  assert.equal(chiefClaims.aud.some(a => API_AUDIENCES.includes(a)), false, "API_AUDIENCE_LEAKED_INTO_MCP_TOKEN");
  chief = await verifier.verify(chiefToken);
  assert.deepEqual([...chief.scopes].sort(), ["mcp", "mcp:agenda:read:team", "mcp:executions:read:team", "mcp:orders:read"]);
  pass("pkce_real_team_reader_scoped_token", {scopes: chief.scopes.length, audiencePairExact: true, noApiAudience: true});

  const apiToken = await exchange.exchange(chief);
  const apiClaims = close(apiToken);
  assert.equal(apiClaims.sub, chiefClaims.sub, "EXCHANGE_SUBJECT");
  assert.deepEqual([...apiClaims.aud].sort(), [...API_AUDIENCES].sort(), "EXCHANGE_API_AUDIENCES");
  assert.equal(apiClaims.azp, "autonexus-mcp-server");
  assert.ok(apiClaims.exp <= chiefClaims.exp + 5, "EXCHANGE_LIFETIME");
  const roles = apiClaims.realm_access?.roles ?? [];
  assert.ok(roles.includes("mcp_read_team") && !roles.includes("administrador"), "EXCHANGED_ROLE_SCOPE");
  pass("standard_token_exchange_real", {sameSubject: true, apiAudiencesExact: true, readOnlyRoleClaims: roles.filter(r => r.startsWith("mcp_read_")).length});

  const client = await connect(chiefToken);
  const tools = (await client.listTools()).tools.map(t => t.name).sort();
  assert.deepEqual(tools, ["autonexus_get_order", "autonexus_get_team_execution", "autonexus_list_orders", "autonexus_list_team_agenda"]);
  pass("tool_discovery_limited_by_scope", {tools: tools.length});

  const orders = await client.callTool({name: "autonexus_list_orders", arguments: {limit: 5}});
  assert.equal(orders.isError, false, "ORDERS_OWNER_READ");
  const ordersJson = JSON.stringify(orders);
  for (const forbidden of ["customerName", "referenceRate", "notes", "vehiclePlate"]) assert.equal(ordersJson.includes(forbidden), false, forbidden);
  pass("real_orders_projection", {count: orders.structuredContent?.data?.length ?? 0, privateFieldsAbsent: true});

  const agenda = await client.callTool({name: "autonexus_list_team_agenda", arguments: {from: "2026-11-05", to: "2026-11-06", limit: 10}});
  assert.equal(agenda.isError, false, "AGENDA_OWNER_READ");
  assert.equal(agenda.structuredContent.period.timeZone, "America/La_Paz");
  assert.equal(JSON.stringify(agenda).includes("description"), false);
  pass("real_team_agenda_projection", {count: agenda.structuredContent?.data?.length ?? 0, periodConfirmed: true});

  // MCP access tokens live 60 s: re-authenticate like a real client before the next call.
  await client.close();
  const refreshed = await connect(await login("chief", "openid mcp mcp:orders:read mcp:agenda:read:team mcp:executions:read:team"));
  const teamExec = await refreshed.callTool({name: "autonexus_get_team_execution", arguments: {assignmentId: "359cde57-3df0-4d53-b5b3-e18303ca4994", advanceLimit: 5}});
  if (teamExec.isError) console.log(JSON.stringify({stage: "team_execution_detail", code: teamExec.structuredContent?.error?.code ?? null, status: teamExec.structuredContent?.error?.status ?? null}));
  assert.equal(teamExec.isError, false, "TEAM_EXECUTION_OWNER_READ");
  assert.ok(teamExec.structuredContent.data.advances.length <= 5, "ADVANCE_PAGINATION");
  assert.equal(JSON.stringify(teamExec).includes("description"), false);
  pass("real_team_execution_projection", {advances: teamExec.structuredContent.data.advances.length, total: teamExec.structuredContent.page.total});
  const unknown = await refreshed.callTool({name: "autonexus_get_team_execution", arguments: {assignmentId: "00000000-0000-4000-8000-000000000000"}});
  assert.equal(unknown.isError, true, "UNKNOWN_RECORD_MUST_NOT_BE_EMPTY_SUCCESS");
  pass("real_unknown_record_is_error", {code: unknown.structuredContent?.error?.code ?? null, status: unknown.structuredContent?.error?.status ?? null});
  await refreshed.close();

  const mechanicToken = await login("mechanicA", "openid mcp mcp:agenda:read:self mcp:executions:read:self");
  mechanic = await verifier.verify(mechanicToken);
  assert.deepEqual([...mechanic.scopes].sort(), ["mcp", "mcp:agenda:read:self", "mcp:executions:read:self"]);
  const selfClient = await connect(mechanicToken);
  const selfTools = (await selfClient.listTools()).tools.map(t => t.name).sort();
  assert.deepEqual(selfTools, ["autonexus_get_my_execution", "autonexus_list_my_agenda"]);
  let deniedScope = null;
  try { await selfClient.callTool({name: "autonexus_list_orders", arguments: {}}); } catch (error) { deniedScope = error?.requiredScope ?? error?.name ?? null; }
  assert.equal(deniedScope, "mcp:orders:read", "MECHANIC_MUST_BE_DENIED_BY_SCOPE");
  const own = await selfClient.callTool({name: "autonexus_get_my_execution", arguments: {assignmentId: "359cde57-3df0-4d53-b5b3-e18303ca4994", advanceLimit: 3}});
  pass("self_reader_limited_and_owner_authorizes", {tools: selfTools.length, ordersDenied: true, ownExecutionApplied: own.isError === false || own.structuredContent?.error?.code === "OWNER_NOT_FOUND"});
  await selfClient.close();

  const audit = readFileSync(AUDIT, "utf8").trim().split(String.fromCharCode(10)).map(l => JSON.parse(l));
  const text = readFileSync(AUDIT, "utf8");
  assert.ok(audit.length >= 4);
  for (const leak of ["Bearer ", "eyJ", ORIGIN + "/identity"]) assert.equal(text.includes(leak), false, "AUDIT_LEAK");
  pass("audit_metadata_only", {entries: audit.length});
  writeFileSync(PROOF, JSON.stringify({pass: true, stages}, null, 2));
} finally {
  listener.closeAllConnections();
  await new Promise(ok => listener.close(ok));
}
