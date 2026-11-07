import {test} from "node:test";
import assert from "node:assert/strict";
import {createReportAuthorizer} from "../dist/report/authorization.js";
import {buildNarrativeReport, ReportError} from "../dist/report/narrative-report.js";

const period = {from: "2026-11-05", to: "2026-11-11"};
const assignmentId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const executionId = "eeeeeeee-1111-4111-8111-111111111111";
const grants = {employeeId: "aaaaaaaa-1111-4111-8111-111111111111", employeeStatus: "active",
  effective: ["agenda:read:team", "executions:read:team"]};
const token = "untrusted-issued-token";
const agenda = {ok: true, data: {data: [{assignmentId, orderNumber: "OS-1",
  orderId: "bbbbbbbb-1111-4111-8111-111111111111", executionStatus: "in_progress"}],
  period, page: {total: 1}}};
const execution = {ok: true, data: {data: {id: executionId, assignmentId, advances: [],
  evidenceSummary: {pending: 0, available: 0, failed: 0}}, page: {total: 0}}};

function fixture(options = {}) {
  const calls = [], requests = [];
  let closed = 0;
  const source = {
    async listTools() { throw new Error("A catalogue or JWT is not an authorization proof"); },
    async call(name, args) {
      calls.push({name, args});
      if (options.throwCall) throw new Error("owner transport failed");
      return name === "autonexus_list_team_agenda" ? (options.agenda ?? agenda) : (options.execution ?? execution);
    },
    async close() { closed++; if (options.throwClose) throw new Error("close failed"); },
  };
  const authorize = createReportAuthorizer({
    sourceFactory(value) { assert.equal(value, token); return source; },
    async fetch(url, init) {
      requests.push({url, init});
      if (options.throwFetch) throw new Error("owner transport failed");
      return new Response(options.invalidJson ? "not json" : JSON.stringify(options.grants ?? grants),
        {status: options.status ?? 200});
    },
  });
  return {authorize, calls, requests, get closed() { return closed; }};
}

const document = await buildNarrativeReport({period, llm: null, source: {
  async listTools() { return []; },
  async call(name) { return name === "autonexus_list_team_agenda" ? agenda : execution; },
  async close() {},
}});
const emptyDocument = await buildNarrativeReport({period, llm: null, source: {
  async listTools() { return []; },
  async call() { return {ok: true, data: {data: [], page: {total: 0}, period}}; },
  async close() {},
}});
const rejectsStatus = (promise, status) => assert.rejects(promise, error => error instanceof ReportError && error.status === status);

test("saved report checks agenda and the execution record before returning the cached document", async () => {
  const f = fixture({execution: {ok: false, error: {code: "OWNER_FORBIDDEN", status: 403}}});
  let returned = false;
  await rejectsStatus((async () => { await f.authorize(token, period, document); returned = true; })(), 403);
  assert.equal(returned, false);
  assert.deepEqual(f.calls.map(call => call.name), ["autonexus_list_team_agenda", "autonexus_get_team_execution"]);
  assert.equal(f.calls[1].args.assignmentId, assignmentId);
  assert.equal(f.closed, 1);
});

test("authorized saved report uses the caller token and closes its source", async () => {
  const f = fixture();
  await f.authorize(token, period, document);
  assert.equal(f.closed, 1);
  assert.ok(f.requests[0].url.endsWith("/security/permissions"));
  assert.equal(f.requests[0].init.headers.authorization, "Bearer " + token);
  assert.equal(f.requests[0].init.redirect, "error");
});

test("removed assignment is denied even if the current agenda is empty and still authorized", async () => {
  const f = fixture({agenda: {ok: true, data: {data: []}},
    execution: {ok: false, error: {code: "OWNER_NOT_FOUND", status: 404}}});
  await rejectsStatus(f.authorize(token, period, document), 403);
  assert.equal(f.calls[1].args.assignmentId, assignmentId);
  assert.equal(f.closed, 1);
});

for (const [status, code, expected] of [[401, "OWNER_UNAUTHORIZED", 401], [403, "OWNER_FORBIDDEN", 403],
  [503, "OWNER_UNAVAILABLE", 503], [undefined, "OWNER_UNAVAILABLE", 503]]) {
  test("execution owner failure is closed: " + code + "/" + status, async () => {
    const f = fixture({execution: {ok: false, error: {code, status}}});
    await rejectsStatus(f.authorize(token, period, document), expected);
    assert.equal(f.closed, 1);
  });
}

for (const status of [401, 403, 503]) {
  test("permissions owner HTTP " + status + " is closed", async () => {
    const f = fixture({status});
    await rejectsStatus(f.authorize(token, period, document), status);
    assert.equal(f.calls.length, 0);
  });
}

for (const change of [{effective: ["agenda:read:team"]}, {effective: ["executions:read:team"]},
  {employeeId: null}, {employeeStatus: "inactive"}]) {
  test("current grant or binding removed: " + JSON.stringify(change), async () => {
    const f = fixture({grants: {...grants, ...change}});
    const jwt = ["header", Buffer.from(JSON.stringify({scope: "agenda:read:team executions:read:team",
      realm_access: {roles: ["mcp_read_team"]}})).toString("base64url"), "signature"].join(".");
    await rejectsStatus(f.authorize(jwt, period, document), 403);
    assert.equal(f.calls.length, 0, "JWT claims cannot replace the current owner grant");
  });
}

test("new creation checks both scopes without inventing an assignment ID", async () => {
  const f = fixture();
  await f.authorize(token, period);
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.calls.map(call => call.name), ["autonexus_list_team_agenda"]);
  assert.equal(f.closed, 1);
});

test("empty saved report requires the full contract scope but no execution record", async () => {
  const f = fixture();
  await f.authorize(token, period, emptyDocument);
  assert.equal(f.calls.length, 1);
  const denied = fixture({grants: {...grants, effective: ["agenda:read:team"]}});
  await rejectsStatus(denied.authorize(token, period, emptyDocument), 403);
});

test("every distinct saved assignment is checked, including claim-only references", async () => {
  const saved = structuredClone(document);
  saved.claims[0].recordRefs.push({kind: "assignment", id: secondId});
  const f = fixture();
  // The second call returns a mismatched assignment, which must not authorize the second ID.
  await rejectsStatus(f.authorize(token, period, saved), 503);
  assert.deepEqual(f.calls.slice(1).map(call => call.args.assignmentId), [assignmentId, secondId]);
  assert.equal(f.closed, 1);
});

test("partial report keeps a visible unstarted assignment without treating its null metrics as execution data", async () => {
  const both = {...agenda, data: {...agenda.data, data: [...agenda.data.data,
    {...agenda.data.data[0], assignmentId: secondId, executionStatus: "not_started"}], page: {total: 2}}};
  const missing = {ok: false, error: {code: "OWNER_NOT_FOUND", status: 404}};
  const source = {async listTools() { return []; }, async close() {},
    async call(name, args) { return name === "autonexus_list_team_agenda" ? both : args.assignmentId === secondId ? missing : execution; }};
  const partial = await buildNarrativeReport({period, llm: null, source});
  assert.equal(partial.figures.complete, false);
  assert.equal(partial.figures.perWork.find(work => work.assignmentId === secondId).advances, null);
  let effective = grants;
  const authorize = createReportAuthorizer({sourceFactory: () => source,
    fetch: async () => new Response(JSON.stringify(effective), {status: 200})});
  await authorize(token, period, partial);
  effective = {...grants, effective: ["agenda:read:team"]};
  await rejectsStatus(authorize(token, period, partial), 403);
  effective = grants;
  both.data.data = [both.data.data[0]]; both.data.page.total = 1;
  await rejectsStatus(authorize(token, period, partial), 403);
});

test("unmatched execution references and unsupported scopes fail closed", async () => {
  for (const mutate of [saved => saved.references.push({kind: "execution", id: secondId}),
    saved => { saved.provenance[0].tool = "autonexus_get_my_execution"; },
    saved => { saved.period.from = "2026-11-04"; },
    saved => { saved.figures.perWork[0].assignmentId = null; }]) {
    const saved = structuredClone(document);
    mutate(saved);
    const f = fixture();
    await rejectsStatus(f.authorize(token, period, saved), 503);
    assert.equal(f.closed, 1);
  }
});

test("malformed owner responses and thrown transports fail closed", async () => {
  for (const options of [{throwFetch: true}, {invalidJson: true}, {grants: {}}, {throwCall: true}, {throwClose: true}]) {
    const f = fixture(options);
    await rejectsStatus(f.authorize(token, period, document), 503);
    assert.equal(f.closed, options.throwFetch || options.invalidJson || options.grants ? 0 : 1);
  }
});

test("close failure cannot mask an execution authorization denial", async () => {
  const f = fixture({throwClose: true, execution: {ok: false, error: {status: 401}}});
  await rejectsStatus(f.authorize(token, period, document), 401);
  assert.equal(f.closed, 1);
});

test("current grants are read afresh on every replay", async () => {
  let current = grants;
  const authorize = createReportAuthorizer({sourceFactory: () => ({
    async listTools() { return []; },
    async call(name) { return name === "autonexus_list_team_agenda" ? agenda : execution; },
    async close() {},
  }), fetch: async () => new Response(JSON.stringify(current))});
  await authorize(token, period, document);
  current = {...grants, effective: ["agenda:read:team"]};
  await rejectsStatus(authorize(token, period, document), 403);
});
