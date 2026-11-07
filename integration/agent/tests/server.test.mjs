// Unit tests for the loopback HTTP service. No live Operations and no live model: the token-scoped
// source and the LLM are controlled doubles, so these assertions are about the service contract.
import {test, before, after} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {createHandler} from "../dist/server.js";
import {createReportAuthorizer} from "../dist/report/authorization.js";
import {checkReportContract} from "../dist/report/contract.js";

const NOW = new Date("2026-11-11T18:30:00.000Z");
const FORWARDED = "Bearer " + "A".repeat(40);

const jwt = payload => [Buffer.from(JSON.stringify({alg: "RS256", typ: "JWT"})).toString("base64url"),
  Buffer.from(JSON.stringify(payload)).toString("base64url"), "sig"].join(".");

const CHIEF = jwt({sub: "chief", exp: 4_102_444_800, realm_access: {roles: ["mcp_read_team"]}});
const MECHANIC = jwt({sub: "mechanicA", exp: 4_102_444_800, realm_access: {roles: ["mcp_read_self"]}});
const NO_ROLE = jwt({sub: "nadie", exp: 4_102_444_800, realm_access: {roles: ["usuario"]}});
const EXPIRED = jwt({sub: "chief", exp: 1_700_000_000});

const TEAM = [{name: "autonexus_list_team_agenda", description: "agenda"},
  {name: "autonexus_get_team_execution", description: "execution"}, {name: "autonexus_list_orders", description: "orders"}];

let log = [];
let seen = [];
let sourceBehaviour = () => ({ok: true, data: {source: "operations", data: [], page: {total: 0}}});

function source(tools = TEAM) {
  return {
    async listTools() { return tools; },
    async call(name, args) { seen.push({name, args}); return sourceBehaviour(name, args); },
    async close() { },
  };
}

const llm = (content = "Hay órdenes autorizadas en el período consultado.") => ({model: "qwen3.5:4b", totalTimeoutMs: 3000,
  async chat() { return {content, thinking: "", toolCalls: [], rawToolCalls: [], model: "qwen3.5:4b", latencyMs: 1, evalCount: 1}; }});

/** First turn asks for a tool, second turn answers: needed to reach the tool path. */
const llmWithTool = () => {
  let turn = 0;
  return {model: "qwen3.5:4b", totalTimeoutMs: 3000, async chat() {
    turn += 1;
    const toolCalls = turn === 1 ? [{id: "c1", name: "autonexus_list_orders", arguments: {}}] : [];
    return {content: turn === 1 ? "" : "Respuesta final en español.", thinking: "", toolCalls,
      rawToolCalls: toolCalls.map(call => ({id: call.id, function: {index: 0, name: call.name, arguments: call.arguments}})),
      model: "qwen3.5:4b", latencyMs: 1, evalCount: 1};
  }};
};

let baseUrl;
let server;

const start = async (deps = {}) => {
  const sourceFactory = deps.sourceFactory ?? (token => { seen.push({factoryToken: token}); return source(); });
  const handler = createHandler({
    llm: llm(),
    sourceFactory,
    authorizeReport: createReportAuthorizer({sourceFactory, fetch: async (_url, options) => {
      assert.equal(options.headers.authorization, "Bearer " + CHIEF);
      return Response.json({employeeId: "22222222-2222-4222-8222-222222222222", employeeStatus: "active",
        effective: ["agenda:read:team", "executions:read:team"]});
    }}),
    now: () => NOW,
    logger: entry => { log.push(entry); },
    ...deps,
  });
  const created = createServer(handler);
  await new Promise(ready => created.listen(0, "127.0.0.1", ready));
  return {url: "http://127.0.0.1:" + String(created.address().port), created};
};

before(async () => {
  const started = await start();
  baseUrl = started.url;
  server = started.created;
});
after(async () => { await new Promise(ready => server.close(ready)); });

const post = async (path, body, token = CHIEF, url = baseUrl) => {
  log = [];
  seen = [];
  const response = await fetch(url + path, {method: "POST",
    headers: {"content-type": "application/json", ...(token === null ? {} : {authorization: "Bearer " + token})},
    body: typeof body === "string" ? body : JSON.stringify(body)});
  return {status: response.status, headers: response.headers, body: await response.json()};
};

test("health is reachable without a token and reports the model", async () => {
  const response = await fetch(baseUrl + "/health");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.service, "autonexus-agent");
  assert.equal(body.llm, true);
  assert.equal(body.model, "qwen3.5:4b");
});

test("a missing token is rejected with 401 and a challenge", async () => {
  const response = await post("/assistant", {query: "¿Qué órdenes hay?"}, null);
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, "TOKEN_REQUIRED");
  assert.match(response.headers.get("www-authenticate") ?? "", /Bearer/);
});

test("a token that is not a readable JWT is rejected with 401", async () => {
  const response = await post("/assistant", {query: "¿Qué órdenes hay?"}, "x".repeat(30));
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, "INVALID_TOKEN");
});

test("an expired token is rejected with 401", async () => {
  const response = await post("/assistant", {query: "¿Qué órdenes hay?"}, EXPIRED);
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, "TOKEN_EXPIRED");
});

test("a token without a read role is rejected with 403", async () => {
  const response = await post("/assistant", {query: "¿Qué órdenes hay?"}, NO_ROLE);
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, "NO_READ_SCOPE");
});

test("the caller's own token is the one forwarded to the tool source", async () => {
  const response = await post("/assistant", {query: "¿Qué órdenes hay?"}, CHIEF);
  assert.equal(response.status, 200);
  // The contract publishes the reader-facing answer, not the planner's internal record.
  assert.equal(typeof response.body.answer, "string");
  assert.ok(response.body.answer.length > 0);
  assert.equal(response.body.refused, false);
  assert.equal(response.body.model, "qwen3.5:4b");
  assert.equal(typeof response.body.generatedAt, "string");
  assert.ok(Array.isArray(response.body.toolsUsed));
  assert.ok(Array.isArray(response.body.provenance));
  const forwarded = seen.find(entry => entry.factoryToken !== undefined).factoryToken;
  assert.equal(forwarded, CHIEF, "no minted identity: the caller token is forwarded verbatim");
  assert.ok(!("fallbackFrom" in response.body), "the internal record is not published");
});

test("tokens and question text never reach the log", async () => {
  const query = "¿Qué trabajos pendientes hay esta semana en el taller?";
  const response = await post("/assistant", {query}, CHIEF);
  assert.equal(response.status, 200);
  const serialized = JSON.stringify(log);
  assert.ok(!serialized.includes(CHIEF), "the token must not be logged");
  assert.ok(!serialized.includes("A".repeat(40)), "no token fragment must be logged");
  assert.ok(!serialized.includes("trabajos pendientes"), "the question text must not be logged");
  assert.ok(serialized.includes("querySha256"), "a digest is logged instead");
  assert.ok(log.some(entry => typeof entry.tokenSha256 === "string" && entry.tokenSha256.length === 16));
});

test("an oversized body is rejected with 413 before parsing", async () => {
  const started = await start({maxBodyBytes: 128});
  try {
    const response = await post("/assistant", {query: "x".repeat(500)}, CHIEF, started.url);
    assert.equal(response.status, 413);
    assert.equal(response.body.error.code, "BODY_TOO_LARGE");
  } finally { await new Promise(ready => started.created.close(ready)); }
});

test("a malformed body and a too short question are rejected with 400", async () => {
  const malformed = await post("/assistant", "{no json", CHIEF);
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.code, "INVALID_BODY");
  const short = await post("/assistant", {query: "ok"}, CHIEF);
  assert.equal(short.status, 400);
  assert.equal(short.body.error.code, "INVALID_QUERY");
});

test("a token the owner rejects becomes 401 instead of an invented answer", async () => {
  const started = await start({
    llm: llmWithTool(),
    sourceFactory: () => {
      const base = source();
      return {...base, async call() { return {ok: false, error: {code: "OWNER_UNAUTHORIZED", status: 401}}; }};
    },
  });
  try {
    const response = await post("/assistant", {query: "¿Qué órdenes hay?"}, CHIEF, started.url);
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, "TOKEN_REJECTED");
  } finally { await new Promise(ready => started.created.close(ready)); }
});

test("the assistant keeps working when the model is unavailable", async () => {
  const started = await start({llm: null});
  try {
    const response = await post("/assistant", {query: "¿Qué órdenes hay?"}, CHIEF, started.url);
    assert.equal(response.status, 200);
    // The contract always names what wrote the text: here the planner's own version, and it says so.
    assert.equal(response.body.model, "cu25-planner-v1");
    assert.ok(response.body.limitations.some(entry => entry.includes("planificador")));
  } finally { await new Promise(ready => started.created.close(ready)); }
});

test("the report is served over the caller's token with deterministic figures", async () => {
  const started = await start({llm: null, sourceFactory: () => {
    const base = source();
    return {...base, async call(name, args) {
      if (name === "autonexus_list_team_agenda") return {ok: true, data: {data: [{
        assignmentId: "11111111-1111-4111-8111-111111111111", orderId: "aaaaaaaa-1111-4111-8111-111111111111",
        orderNumber: "OS-1", executionStatus: "confirmed", startsAt: "2026-11-05T13:00:00Z"}],
        period: {from: args.from, to: args.to, timeZone: "America/La_Paz"}, page: {total: 1, limit: 50, offset: 0}}};
      return {ok: true, data: {data: {assignmentId: args.assignmentId,
        id: "33333333-3333-4333-8333-333333333333",
        evidenceSummary: {pending: 0, available: 2, failed: 0}}, page: {total: 3}}};
    }};
  }});
  try {
    const response = await post("/report", {from: "2026-11-05", to: "2026-11-11"}, CHIEF, started.url);
    assert.equal(response.status, 200);
    assert.equal(response.body.report, "operations-narrative");
    assert.deepEqual(checkReportContract(response.body), []);
    assert.equal(response.body.figures.totalWorks, 1);
    assert.equal(response.body.figures.advances, 3);
    assert.deepEqual(response.body.period, {from: "2026-11-05", to: "2026-11-11", timeZone: "America/La_Paz"});
    assert.equal(response.body.financialData.included, false);
    assert.equal(response.body.narrative.path, "deterministic");
    assert.equal(response.body.narrative.generative, false);
    assert.ok(response.body.claims.some(claim => claim.indicator === "works.total" && claim.value === 1));
  } finally { await new Promise(ready => started.created.close(ready)); }
});

test("an invalid report period is rejected with 400", async () => {
  const response = await post("/report", {from: "2026-11-11", to: "2026-11-05"}, CHIEF);
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "INVALID_PERIOD");
});

test("unknown routes and wrong methods are rejected", async () => {
  const missing = await post("/desconocido", {}, CHIEF);
  assert.equal(missing.status, 404);
  const response = await fetch(baseUrl + "/assistant", {headers: {authorization: "Bearer " + CHIEF}});
  assert.equal(response.status, 405);
  assert.equal((await response.json()).error.code, "METHOD_NOT_ALLOWED");
});

test("a token for the self scope is accepted and reaches the service", async () => {
  const response = await post("/assistant", {query: "¿Qué trabajos tengo?"}, MECHANIC);
  assert.equal(response.status, 200);
  assert.equal(seen.find(entry => entry.factoryToken !== undefined).factoryToken, MECHANIC);
});
