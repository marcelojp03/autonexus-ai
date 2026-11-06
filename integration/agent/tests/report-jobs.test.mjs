// CU26 report jobs: short creation, stable identifier, polling, reuse on retry, durability of the
// finished document, ownership, capacity and the two terminal authorization cases. Everything runs
// against controlled doubles except the real job store, which is the part that must survive a reload.
import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {createServer} from "node:http";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {createHandler} from "../dist/server.js";
import {ReportJobRunner} from "../dist/report/job-runner.js";
import {ReportJobStore} from "../dist/report/jobs.js";

const NOW = new Date("2026-11-11T18:30:00.000Z");
const PERIOD = {from: "2026-11-05", to: "2026-11-11"};

const jwt = payload => [Buffer.from(JSON.stringify({alg: "RS256", typ: "JWT"})).toString("base64url"),
  Buffer.from(JSON.stringify(payload)).toString("base64url"), "sig"].join(".");

const CHIEF = jwt({sub: "chief", exp: 4_102_444_800, realm_access: {roles: ["mcp_read_team"]}});
const MECHANIC = jwt({sub: "mechanicA", exp: 4_102_444_800, realm_access: {roles: ["mcp_read_self"]}});

const AGENDA = [{assignmentId: "11111111-1111-4111-8111-111111111111",
  orderId: "aaaaaaaa-1111-4111-8111-111111111111", orderNumber: "OS-1",
  executionStatus: "confirmed", startsAt: "2026-11-05T13:00:00Z"}];

/** The owner answers the agenda and one execution, unless the test asks it to refuse. */
function sourceFactory(counter = {calls: 0}) {
  return () => ({
    async listTools() { return []; },
    async call(name) {
      counter.calls += 1;
      if (scope.deny === "unauthorized") return {ok: false, error: {code: "OWNER_UNAUTHORIZED", status: 401}};
      if (name === "autonexus_list_team_agenda") {
        return {ok: true, data: {data: AGENDA, period: {...PERIOD, timeZone: "America/La_Paz"},
          observedAt: NOW.toISOString(), page: {total: AGENDA.length}}};
      }
      return {ok: true, data: {data: {evidenceSummary: {pending: 1, available: 2, failed: 0}}, page: {total: 3}}};
    },
    async close() { },
  });
}

const scope = {deny: null};

const start = async (deps = {}) => {
  const handler = createHandler({
    llm: null,
    sourceFactory: sourceFactory(),
    now: () => NOW,
    logger: () => { },
    ...deps,
  });
  const created = createServer(handler);
  await new Promise(ready => created.listen(0, "127.0.0.1", ready));
  return {url: "http://127.0.0.1:" + String(created.address().port), created};
};

const call = async (url, path, {method = "POST", token = CHIEF, body} = {}) => {
  const response = await fetch(url + path, {method,
    headers: {"content-type": "application/json", ...(token === null ? {} : {authorization: "Bearer " + token})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  return {status: response.status, body: await response.json()};
};

const newDirectory = () => mkdtempSync(join(tmpdir(), "cu26-jobs-"));

/** Polls until the job reaches a terminal state, so no test depends on the queue's timing. */
const settle = async (url, jobId, token = CHIEF, attempts = 100) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await call(url, "/report/jobs/" + jobId, {method: "GET", token});
    if (response.status !== 200) return response;
    if (response.body.status === "succeeded" || response.body.status === "failed" || response.body.status === "interrupted") return response;
    await new Promise(done => setTimeout(done, 20));
  }
  throw new Error("the job did not reach a terminal state");
};

test("creation is short and the identifier is stable across the whole run", async () => {
  const directory = newDirectory();
  const started = await start({jobDirectory: directory});
  try {
    const operationId = randomUUID();
    const created = await call(started.url, "/report/jobs", {body: {...PERIOD, operationId}});
    assert.equal(created.status, 202);
    assert.equal(created.body.reused, false);
    assert.match(created.body.jobId, /^[0-9a-f-]{36}$/);
    const settled = await settle(started.url, created.body.jobId);
    assert.equal(settled.status, 200);
    assert.equal(settled.body.status, "succeeded");
    assert.equal(settled.body.jobId, created.body.jobId, "el identificador no cambia entre consultas");
    assert.equal(settled.body.report.figures.totalWorks, 1);
    assert.equal(settled.body.report.narrative.path, "deterministic");
    assert.equal(settled.body.report.narrative.generative, false);
    // The finished document lives on disk: a reload (a new handler over the same directory) reads it.
    const reopened = await start({jobDirectory: directory});
    try {
      const again = await call(reopened.url, "/report/jobs/" + created.body.jobId, {method: "GET"});
      assert.equal(again.status, 200);
      assert.equal(again.body.status, "succeeded");
      assert.equal(again.body.report.figures.totalWorks, 1);
    } finally { await new Promise(ready => reopened.created.close(ready)); }
  } finally { await new Promise(ready => started.created.close(ready)); }
});

test("a retry with the same operationId returns the same job instead of generating again", async () => {
  const directory = newDirectory();
  const counter = {calls: 0};
  const started = await start({jobDirectory: directory, sourceFactory: sourceFactory(counter)});
  try {
    const operationId = randomUUID();
    const first = await call(started.url, "/report/jobs", {body: {...PERIOD, operationId}});
    await settle(started.url, first.body.jobId);
    const callsAfterFirst = counter.calls;
    const second = await call(started.url, "/report/jobs", {body: {...PERIOD, operationId}});
    assert.equal(second.status, 200);
    assert.equal(second.body.reused, true);
    assert.equal(second.body.jobId, first.body.jobId, "el reintento reutiliza el mismo trabajo");
    assert.equal(counter.calls, callsAfterFirst, "no se consultó otra vez a los propietarios");
    assert.equal(readdirSync(directory).filter(name => name.endsWith(".json")).length, 1, "un solo trabajo en disco");
  } finally { await new Promise(ready => started.created.close(ready)); }
});

test("another account cannot read the job and the answer does not confirm it exists", async () => {
  const directory = newDirectory();
  const started = await start({jobDirectory: directory});
  try {
    const created = await call(started.url, "/report/jobs", {body: {...PERIOD, operationId: randomUUID()}});
    await settle(started.url, created.body.jobId);
    const foreign = await call(started.url, "/report/jobs/" + created.body.jobId, {method: "GET", token: MECHANIC});
    assert.equal(foreign.status, 404);
    assert.equal(foreign.body.error.code, "JOB_NOT_FOUND");
    const missing = await call(started.url, "/report/jobs/" + randomUUID(), {method: "GET"});
    assert.equal(missing.status, 404, "un identificador ajeno y uno inexistente responden igual");
  } finally { await new Promise(ready => started.created.close(ready)); }
});

test("the operation identifier is required, so an accidental double click cannot duplicate a run", async () => {
  const started = await start({jobDirectory: newDirectory()});
  try {
    const missing = await call(started.url, "/report/jobs", {body: PERIOD});
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error.code, "INVALID_OPERATION_ID");
    const invalid = await call(started.url, "/report/jobs", {body: {...PERIOD, operationId: "abc"}});
    assert.equal(invalid.status, 400);
  } finally { await new Promise(ready => started.created.close(ready)); }
});

test("reading a job requires a valid token with a read role", async () => {
  const started = await start({jobDirectory: newDirectory()});
  try {
    const created = await call(started.url, "/report/jobs", {body: {...PERIOD, operationId: randomUUID()}});
    const anonymous = await call(started.url, "/report/jobs/" + created.body.jobId, {method: "GET", token: null});
    assert.equal(anonymous.status, 401);
    const expired = await call(started.url, "/report/jobs/" + created.body.jobId, {method: "GET",
      token: jwt({sub: "chief", exp: 1_700_000_000, realm_access: {roles: ["mcp_read_team"]}})});
    assert.equal(expired.status, 401);
    assert.equal(expired.body.error.code, "TOKEN_EXPIRED");
    await settle(started.url, created.body.jobId);
  } finally { await new Promise(ready => started.created.close(ready)); }
});

test("an authorization refused during the generation ends the job without restarting it", async () => {
  const directory = newDirectory();
  const counter = {calls: 0};
  scope.deny = "unauthorized";
  const started = await start({jobDirectory: directory, sourceFactory: sourceFactory(counter)});
  try {
    const created = await call(started.url, "/report/jobs", {body: {...PERIOD, operationId: randomUUID()}});
    const settled = await settle(started.url, created.body.jobId);
    assert.equal(settled.body.status, "failed");
    assert.equal(settled.body.failure.code, "AUTHORIZATION_EXPIRED");
    assert.equal(counter.calls, 1, "el token rechazado no se reintenta");
    assert.equal(settled.body.report, undefined);
  } finally { scope.deny = null; await new Promise(ready => started.created.close(ready)); }
});

test("a job left running by a previous process is closed as interrupted, never resumed", async () => {
  const directory = newDirectory();
  const store = new ReportJobStore({directory});
  const jobId = randomUUID();
  store.save({jobId, operationId: randomUUID(), subject: "chief", ...PERIOD, tokenExpiresAt: null,
    requestedAt: NOW.toISOString(), startedAt: NOW.toISOString(), finishedAt: null,
    status: "running", document: null, failure: null});
  const started = await start({jobDirectory: directory});
  try {
    const read = await call(started.url, "/report/jobs/" + jobId, {method: "GET"});
    assert.equal(read.status, 200);
    assert.equal(read.body.status, "interrupted");
    assert.equal(read.body.failure.code, "INTERRUPTED_BY_RESTART");
    const stored = JSON.parse(readFileSync(join(directory, jobId + ".json"), "utf8"));
    assert.equal(stored.status, "interrupted", "el estado terminal quedó persistido");
    assert.ok(!readFileSync(join(directory, jobId + ".json"), "utf8").includes("Bearer"), "el token nunca se escribe");
  } finally { await new Promise(ready => started.created.close(ready)); }
});

test("the runner refuses to start a job whose token already expired", async () => {
  const directory = newDirectory();
  const store = new ReportJobStore({directory});
  const jobId = randomUUID();
  store.save({jobId, operationId: randomUUID(), subject: "chief", ...PERIOD,
    tokenExpiresAt: NOW.getTime() - 1_000, requestedAt: new Date(NOW.getTime() - 5_000).toISOString(),
    startedAt: null, finishedAt: null, status: "queued", document: null, failure: null});
  let built = 0;
  const runner = new ReportJobRunner({store, sourceFactory: () => { throw new Error("no debería consultarse"); },
    build: async () => { built += 1; throw new Error("no debería construirse"); },
    llm: null, now: () => NOW});
  runner.submit(store.load(jobId), "token-de-prueba-suficientemente-largo");
  await new Promise(done => setTimeout(done, 60));
  const closed = store.load(jobId);
  assert.equal(closed.status, "failed");
  assert.equal(closed.failure.code, "AUTHORIZATION_EXPIRED");
  assert.equal(built, 0, "no se ejecutó ninguna generación");
});

test("a full queue answers 503 instead of accepting work it cannot run", async () => {
  const directory = newDirectory();
  // The first job is held inside its owner read, so the second one meets a full queue.
  let release = null;
  const gate = new Promise(done => { release = done; });
  const blocked = () => ({
    async listTools() { return []; },
    async call(name) {
      await gate;
      if (name === "autonexus_list_team_agenda") {
        return {ok: true, data: {data: AGENDA, period: {...PERIOD, timeZone: "America/La_Paz"},
          observedAt: NOW.toISOString(), page: {total: AGENDA.length}}};
      }
      return {ok: true, data: {data: {evidenceSummary: {pending: 0, available: 1, failed: 0}}, page: {total: 0}}};
    },
    async close() { },
  });
  const started = await start({jobDirectory: directory, sourceFactory: blocked, jobCapacity: 1});
  try {
    const first = await call(started.url, "/report/jobs", {body: {...PERIOD, operationId: randomUUID()}});
    assert.equal(first.status, 202);
    const second = await call(started.url, "/report/jobs", {body: {...PERIOD, operationId: randomUUID()}});
    assert.equal(second.status, 503);
    assert.equal(second.body.error.code, "QUEUE_FULL");
    const stored = readdirSync(directory).filter(name => name.endsWith(".json"))
      .map(name => JSON.parse(readFileSync(join(directory, name), "utf8")));
    const rejected = stored.filter(job => job.status === "failed");
    assert.equal(rejected.length, 1, "el rechazo queda registrado, no se pierde en silencio");
    assert.equal(rejected[0].failure.code, "QUEUE_FULL");
  } finally {
    release();
    await new Promise(done => setTimeout(done, 60));
    await new Promise(ready => started.created.close(ready));
  }
});

test("a job that fails inside the runner closes as failed and does not stop the queue", async () => {
  const directory = newDirectory();
  const store = new ReportJobStore({directory});
  const broken = {jobId: randomUUID(), operationId: randomUUID(), subject: "chief", ...PERIOD, tokenExpiresAt: null,
    requestedAt: NOW.toISOString(), startedAt: null, finishedAt: null, status: "queued", document: null, failure: null};
  const healthy = {...broken, jobId: randomUUID(), operationId: randomUUID()};
  store.save(broken);
  store.save(healthy);
  let calls = 0;
  const runner = new ReportJobRunner({store, sourceFactory: () => {
    calls += 1;
    if (calls === 1) throw new Error("el propietario no responde");
    return sourceFactory()();
  }, build: async () => ({report: "operations-narrative"}), llm: null, now: () => NOW});
  runner.submit(store.load(broken.jobId), "token-de-prueba-suficientemente-largo");
  runner.submit(store.load(healthy.jobId), "token-de-prueba-suficientemente-largo");
  await new Promise(done => setTimeout(done, 200));
  const first = store.load(broken.jobId);
  const second = store.load(healthy.jobId);
  assert.equal(first.status, "failed", "el trabajo con el fallo termina");
  assert.equal(second.status, "succeeded", "el siguiente trabajo de la cola corre igual");
});

test("a store that cannot write fails loudly instead of losing the job", async () => {
  const directory = newDirectory();
  const store = new ReportJobStore({directory});
  const job = {jobId: randomUUID(), operationId: randomUUID(), subject: "chief", ...PERIOD, tokenExpiresAt: null,
    requestedAt: NOW.toISOString(), startedAt: null, finishedAt: null, status: "queued", document: null, failure: null};
  store.save(job);
  // A directory where the target file should be makes the rename impossible on every platform.
  const blocked = {...job, jobId: randomUUID()};
  const {mkdirSync} = await import("node:fs");
  mkdirSync(join(directory, blocked.jobId + ".json"));
  assert.throws(() => store.save(blocked), (failure) => failure.code === "REPORT_JOB_WRITE_FAILED");
});

test("writing a damaged job file never publishes a state the store cannot prove", async () => {
  const directory = newDirectory();
  const jobId = randomUUID();
  writeFileSync(join(directory, jobId + ".json"), '{"jobId":"' + jobId + '","status":"inventado"}', "utf8");
  const started = await start({jobDirectory: directory});
  try {
    const read = await call(started.url, "/report/jobs/" + jobId, {method: "GET"});
    assert.equal(read.status, 404);
  } finally { await new Promise(ready => started.created.close(ready)); }
});
