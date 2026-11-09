// CU26 financial report (S2.15): own contract, own authorization, own job store, money as canonical
// centavo strings. Every assertion here is about separation from the operational report and about
// failing closed instead of publishing a zero.
import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, readdirSync} from "node:fs";
import {createServer} from "node:http";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {createHandler} from "../dist/server.js";
import {
  buildFinancialReport, checkFinancialReportContract, deterministicFinancialNarrative,
  FINANCIAL_DISCRIMINATOR, FINANCIAL_LIMITATION_NO_PROFITABILITY, moneyText,
  verifyFinancialNarrative,
} from "../dist/report/financial-report.js";
import {createFinancialAuthorizer} from "../dist/report/financial-authorization.js";
import {createFinancialJobStore, financialJobDirectory, publicFinancialJob} from "../dist/report/financial-jobs.js";
import {ReportJobStore} from "../dist/report/jobs.js";
import {ReportJobRunner} from "../dist/report/job-runner.js";

const PERIOD = {from: "2026-11-01", to: "2026-11-30"};
const NOW = new Date("2026-11-08T15:00:00.000Z");
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const FINANCE_TOOL = "autonexus_get_financial_summary";

const jwt = payload => [Buffer.from(JSON.stringify({alg: "RS256", typ: "JWT"})).toString("base64url"),
  Buffer.from(JSON.stringify(payload)).toString("base64url"), "sig"].join(".");
// Deliberately no mcp_read_* role: financial authority is employee grants, not JWT roles.
const CALLER = jwt({sub: "finance-user", exp: 4_102_444_800, realm_access: {roles: []}});

const summary = (overrides = {}) => ({from: PERIOD.from, to: PERIOD.to, timeZone: "America/La_Paz",
  currency: "BOB", paymentCount: 3, expenseCount: 1, receivedAmountMinor: "123456",
  expenseAmountMinor: "3456", netMovementMinor: "120000", generatedAt: "2026-11-08T12:00:00.000Z", ...overrides});

/** Controlled source: the financial tool answers what the test wants, nothing else is callable. */
const sourceFactory = (payload = summary(), onCall = () => { }) => () => ({
  async listTools() { return [{name: FINANCE_TOOL, description: "financial"}]; },
  async call(name, args) {
    onCall(name, args);
    if (name !== FINANCE_TOOL) return {ok: false, error: {code: "TOOL_NOT_AVAILABLE", status: 404}};
    if (payload instanceof Error) throw payload;
    if (payload && payload.ok === false) return payload;
    return {ok: true, data: {source: "finance", data: payload}};
  },
  async close() { },
});

const grants = (effective = ["payments:read", "expenses:read"], overrides = {}) => async () =>
  Response.json({employeeId: EMPLOYEE_ID, employeeStatus: "active", effective, ...overrides});

test("money is a canonical centavo string and the arithmetic closes in BigInt", async () => {
  const report = await buildFinancialReport({period: PERIOD, source: sourceFactory()(), llm: null, now: () => NOW});
  assert.equal(report.report, FINANCIAL_DISCRIMINATOR);
  assert.equal(report.figures.receivedMinor, "123456");
  assert.equal(report.figures.expenseMinor, "3456");
  assert.equal(report.figures.netMinor, "120000");
  assert.equal(typeof report.figures.receivedMinor, "string");
  assert.equal(moneyText(report.figures.receivedMinor), "1234.56 BOB");
  assert.equal(report.figures.paymentCount, 3);
  assert.equal(report.figures.complete, true);
  assert.deepEqual(checkFinancialReportContract(report, PERIOD), []);
  // Money claims are strings, never numbers: the contract forbids an Int amount.
  for (const claim of report.claims) assert.equal(typeof claim.value, "string");
  assert.ok(report.claims.some(claim => claim.indicator === "finance.receivedAmountMinor"));
});

test("the financial document has its own discriminator and its own checker", async () => {
  const report = await buildFinancialReport({period: PERIOD, source: sourceFactory()(), llm: null, now: () => NOW});
  // An operational document is not this type, and its checker is not this checker.
  const operational = {report: "operations-narrative", period: {...PERIOD, timeZone: "America/La_Paz"},
    figures: {totalWorks: 1}, claims: [], narrative: {path: "deterministic", model: null, verified: true,
      generative: false, text: "x"}, provenance: [], limitations: [], financialData: {included: false, note: "n"}};
  assert.ok(checkFinancialReportContract(operational).length > 0);
  // A financial document with the operational discriminator is rejected too.
  assert.ok(checkFinancialReportContract({...report, report: "operations-narrative"}).length > 0);
  // Money as a number is a type violation, not a rounding.
  const numeric = {...report, figures: {...report.figures, receivedMinor: 123456}};
  assert.ok(checkFinancialReportContract(numeric).some(problem => problem.includes("figures.receivedMinor")));
  // An amount that does not close is inconsistent.
  const broken = {...report, figures: {...report.figures, netMinor: "1"}};
  assert.ok(checkFinancialReportContract(broken).some(problem => problem.includes("netMinor:inconsistent")));
});

test("a genuine owner zero is published as a zero, and absent owner data fails the job", async () => {
  const zero = await buildFinancialReport({period: PERIOD, llm: null, now: () => NOW,
    source: sourceFactory(summary({paymentCount: 0, expenseCount: 0, receivedAmountMinor: "0",
      expenseAmountMinor: "0", netMovementMinor: "0"}))()});
  assert.equal(zero.figures.receivedMinor, "0");
  assert.equal(zero.figures.netMinor, "0");
  assert.deepEqual(checkFinancialReportContract(zero, PERIOD), []);

  // The owner did not answer at all: the job must fail, never publish zeros.
  await assert.rejects(() => buildFinancialReport({period: PERIOD, llm: null, now: () => NOW,
    source: sourceFactory({ok: false, error: {code: "OWNER_UNAVAILABLE"}})()}), /FINANCIAL_SUMMARY_UNAVAILABLE|no respondió/);
  // The owner answered without the amount fields: a contract violation, not a zero.
  await assert.rejects(() => buildFinancialReport({period: PERIOD, llm: null, now: () => NOW,
    source: sourceFactory({from: PERIOD.from, to: PERIOD.to, timeZone: "America/La_Paz", currency: "BOB",
      paymentCount: 1, expenseCount: 0, generatedAt: "2026-11-08T12:00:00.000Z"})()}), /FINANCIAL_SUMMARY_INVALID|no se publican cifras/);
  // The owner answered about another period: those figures are not the requested report.
  await assert.rejects(() => buildFinancialReport({period: PERIOD, llm: null, now: () => NOW,
    source: sourceFactory(summary({to: "2026-11-29"}))()}), /FINANCIAL_SUMMARY_INVALID|contrato financiero/);
  // An incoherent owner answer (net does not close) is refused before anything is published.
  await assert.rejects(() => buildFinancialReport({period: PERIOD, llm: null, now: () => NOW,
    source: sourceFactory(summary({netMovementMinor: "1"}))()}), /FINANCIAL_SUMMARY_INVALID|contrato/);
});

test("the narrative only writes over computed figures; a non-conforming model falls back", async () => {
  const good = "Entre el período, Finance registró 1234.56 BOB recibidos en 3 cobros y 34.56 BOB " +
    "en gastos registrados (1 gastos). La diferencia registrada es 1200.00 BOB.";
  const llm = model => ({model, totalTimeoutMs: 3000, async chat() { return {content: model === "down" ? "" : good}; }});

  const generative = await buildFinancialReport({period: PERIOD, now: () => NOW, llm: llm("controlled-model"),
    source: sourceFactory()()});
  assert.equal(generative.narrative.path, "llm");
  assert.equal(generative.narrative.model, "controlled-model");
  assert.equal(generative.narrative.generative, true);
  assert.equal(generative.narrative.verified, true);
  assert.ok(generative.limitations.includes(FINANCIAL_LIMITATION_NO_PROFITABILITY));

  // A template is never presented as generation.
  const template = await buildFinancialReport({period: PERIOD, now: () => NOW, llm: null, source: sourceFactory()()});
  assert.equal(template.narrative.path, "deterministic");
  assert.equal(template.narrative.model, null);
  assert.equal(template.narrative.generative, false);

  // A model that invents an amount, or claims profitability, is rejected with a code in limitations.
  const inventing = {model: "liar", totalTimeoutMs: 3000, async chat() {
    return {content: "Finance registró 9999.99 BOB recibidos y el taller es rentable en el período."};
  }};
  const rejected = await buildFinancialReport({period: PERIOD, now: () => NOW, llm: inventing, source: sourceFactory()()});
  assert.equal(rejected.narrative.path, "deterministic");
  assert.equal(rejected.narrative.model, null);
  assert.equal(rejected.narrative.generative, false);
  assert.ok(rejected.limitations.some(code => code.startsWith("financial_narrative_rejected")));

  // A model that is down produces the labelled template, never missing figures.
  const down = {model: "down", totalTimeoutMs: 300, async chat() { throw new Error("down"); }};
  const unavailable = await buildFinancialReport({period: PERIOD, now: () => NOW, llm: down, source: sourceFactory()()});
  assert.equal(unavailable.narrative.path, "deterministic");
  assert.ok(unavailable.limitations.some(code => code.startsWith("financial_narrative_model_unavailable")));
  assert.ok(unavailable.figures.receivedMinor === "123456");
});

test("narrative binding requires the three amounts next to their own indicator", () => {
  const figures = {receivedMinor: "123456", expenseMinor: "3456", netMinor: "120000", currency: "BOB",
    paymentCount: 3, expenseCount: 1, complete: true};
  const text = deterministicFinancialNarrative(PERIOD, figures, "2026-11-08T12:00:00.000Z");
  assert.equal(verifyFinancialNarrative(text, figures).ok, true);
  // One amount missing is enough to reject the text.
  const partial = "Finance registró 1234.56 BOB recibidos y 34.56 BOB en gastos registrados.";
  const checked = verifyFinancialNarrative(partial, figures);
  assert.equal(checked.ok, false);
  assert.ok(checked.problems.some(problem => problem.startsWith("amount_missing:")));
  // An amount bound to the wrong indicator is rejected even when the number was computed.
  assert.equal(verifyFinancialNarrative("La diferencia registrada es 1234.56 BOB, 34.56 BOB de gastos y " +
    "1200.00 BOB recibidos.", figures).ok, false);
});

test("financial authorization needs an active employee with BOTH permissions, freshly read", async () => {
  const calls = {count: 0};
  const counted = (effective) => async () => { calls.count += 1; return grants(effective)(); };
  const authorize = createFinancialAuthorizer({fetch: counted(["payments:read", "expenses:read"])});
  await authorize(CALLER, PERIOD);
  assert.equal(calls.count, 1, "una lectura sin caché por comprobación");

  for (const effective of [["payments:read"], ["expenses:read"], [], ["executions:read:team"]]) {
    const denied = createFinancialAuthorizer({fetch: counted(effective)});
    await assert.rejects(() => denied(CALLER, PERIOD), error => error.status === 403 && error.code === "FINANCIAL_ACCESS_DENIED");
  }
  // Not an active employee, or no employee binding: denied.
  const inactive = createFinancialAuthorizer({fetch: grants(["payments:read", "expenses:read"], {employeeStatus: "inactive"})});
  await assert.rejects(() => inactive(CALLER, PERIOD), error => error.status === 403);
  const unbound = createFinancialAuthorizer({fetch: grants(["payments:read", "expenses:read"], {employeeId: "nope"})});
  await assert.rejects(() => unbound(CALLER, PERIOD), error => error.status === 403);
  // A rejected token stays 401; the owner being unreachable is 503, not a denial.
  const unauthorized = createFinancialAuthorizer({fetch: async () => new Response("{}", {status: 401})});
  await assert.rejects(() => unauthorized(CALLER, PERIOD), error => error.status === 401);
  const down = createFinancialAuthorizer({fetch: async () => { throw new Error("connect ECONNREFUSED"); }});
  await assert.rejects(() => down(CALLER, PERIOD), error => error.status === 503);
});

test("a stored financial document is re-checked on every read", async () => {
  const authorize = createFinancialAuthorizer({fetch: grants()});
  const report = await buildFinancialReport({period: PERIOD, source: sourceFactory()(), llm: null, now: () => NOW});
  await authorize(CALLER, PERIOD, report);
  // An operational document is not accepted through the financial read path.
  await assert.rejects(() => authorize(CALLER, PERIOD, {report: "operations-narrative"}), error => error.status === 503);
  // A document with a tampered amount is rejected on replay.
  await assert.rejects(() => authorize(CALLER, PERIOD,
    {...report, figures: {...report.figures, netMinor: "9"}}), error => error.status === 503);
  // Another period is not this report.
  await assert.rejects(() => authorize(CALLER, {from: "2026-10-01", to: "2026-10-05"}, report),
    error => error.status === 503);
});

test("the financial store lives in its own directory", () => {
  const root = mkdtempSync(join(tmpdir(), "cu26-fin-"));
  const financial = createFinancialJobStore(root);
  assert.equal(financial.directory, financialJobDirectory(root));
  assert.ok(financial.directory.endsWith("financial-jobs"));
  assert.notEqual(financial.directory, root);
  const operational = new ReportJobStore({directory: root});
  const operationId = randomUUID();
  const job = {jobId: randomUUID(), operationId, subject: "finance-user", from: PERIOD.from, to: PERIOD.to,
    tokenExpiresAt: null, requestedAt: NOW.toISOString(), startedAt: null, finishedAt: null,
    status: "queued", document: null, failure: null};
  financial.store.save(job);
  // The operational store cannot see it, and the financial store cannot see the root's files.
  assert.equal(operational.load(job.jobId), null);
  assert.equal(operational.findByOperation("finance-user", operationId), null);
  assert.equal(financial.store.load(job.jobId)?.jobId, job.jobId);
  const other = {jobId: randomUUID(), operationId: randomUUID(), subject: "chief", from: PERIOD.from,
    to: PERIOD.to, tokenExpiresAt: null, requestedAt: NOW.toISOString(), startedAt: null, finishedAt: null,
    status: "queued", document: null, failure: null};
  operational.save(other);
  assert.equal(financial.store.findByOperation("chief", other.operationId), null);
  assert.equal(readdirSync(financial.directory).filter(name => name.endsWith(".json")).length, 1);
});

test("a financial job open at restart is interrupted and not resumed", () => {
  const root = mkdtempSync(join(tmpdir(), "cu26-fin-restart-"));
  const financial = createFinancialJobStore(root);
  const job = {jobId: randomUUID(), operationId: randomUUID(), subject: "finance-user", from: PERIOD.from,
    to: PERIOD.to, tokenExpiresAt: null, requestedAt: NOW.toISOString(), startedAt: NOW.toISOString(),
    finishedAt: null, status: "running", document: null, failure: null};
  financial.store.save(job);
  let builds = 0;
  const runner = new ReportJobRunner({store: financial.store, sourceFactory: sourceFactory(),
    build: async () => { builds += 1; return {}; }, llm: null, now: () => NOW});
  assert.equal(runner.recover(), 1);
  assert.equal(builds, 0);
  const stored = financial.store.load(job.jobId);
  assert.equal(stored?.status, "interrupted");
  assert.equal(stored?.failure?.code, "INTERRUPTED_BY_RESTART");
  assert.deepEqual(Object.keys(publicFinancialJob(stored ?? job)).includes("subject"), false);
});

const start = async (deps = {}) => {
  const handler = createHandler({
    llm: null,
    sourceFactory: sourceFactory(),
    authorizeFinancialReport: createFinancialAuthorizer({fetch: grants()}),
    now: () => NOW,
    logger: () => { },
    ...deps,
  });
  const created = createServer(handler);
  await new Promise(ready => created.listen(0, "127.0.0.1", ready));
  return {url: "http://127.0.0.1:" + String(created.address().port), created};
};

const call = async (url, path, {method = "POST", token = CALLER, body} = {}) => {
  const response = await fetch(url + path, {method,
    headers: {"content-type": "application/json", ...(token === null ? {} : {authorization: "Bearer " + token})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  return {status: response.status, body: await response.json()};
};

const settleFinancial = async (url, jobId, token = CALLER, attempts = 100) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await call(url, "/report/financial/jobs/" + jobId, {method: "GET", token});
    if (response.status !== 200) return response;
    if (["succeeded", "failed", "interrupted"].includes(response.body.status)) return response;
    await new Promise(done => setTimeout(done, 20));
  }
  throw new Error("the financial job did not reach a terminal state");
};

test("the financial route publishes its own document and reuses the same job", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cu26-fin-http-"));
  const previous = process.env["FINANCE_API_URL"];
  process.env["FINANCE_API_URL"] = "http://finance.invalid";
  const started = await start({jobDirectory: directory});
  try {
    const operationId = randomUUID();
    const created = await call(started.url, "/report/financial/jobs", {body: {...PERIOD, operationId}});
    assert.equal(created.status, 202);
    assert.equal(created.body.reused, false);
    const settled = await settleFinancial(started.url, created.body.jobId);
    assert.equal(settled.body.status, "succeeded");
    assert.equal(settled.body.report.report, FINANCIAL_DISCRIMINATOR);
    assert.equal(settled.body.report.figures.receivedMinor, "123456");
    assert.deepEqual(checkFinancialReportContract(settled.body.report, PERIOD), []);
    // Every read re-runs the financial authorization, and the document is re-checked.
    const reread = await call(started.url, "/report/financial/jobs/" + created.body.jobId, {method: "GET"});
    assert.equal(reread.status, 200);
    // Retrying the creation returns the same job and the same document.
    const again = await call(started.url, "/report/financial/jobs", {body: {...PERIOD, operationId}});
    assert.equal(again.status, 200);
    assert.equal(again.body.jobId, created.body.jobId);
    assert.equal(again.body.reused, true);
    assert.deepEqual(again.body.report, settled.body.report);
    // Another period under the same identifier is a conflict.
    const conflict = await call(started.url, "/report/financial/jobs",
      {body: {from: "2026-10-01", to: "2026-10-05", operationId}});
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, "OPERATION_CONFLICT");
    // A financial job is not an operational job: the operational route never answers with its document.
    // (Without an operational read role the route answers 403 before looking at the identifier.)
    const crossed = await call(started.url, "/report/jobs/" + created.body.jobId, {method: "GET"});
    assert.ok([403, 404].includes(crossed.status), "un trabajo financiero no se publica por la ruta operativa");
    assert.equal(crossed.body.report, undefined);
    const wrongType = await call(started.url, "/report/financial/jobs", {body: {...PERIOD, operationId: randomUUID()}});
    assert.equal(wrongType.status, 202);
  } finally {
    if (previous === undefined) delete process.env["FINANCE_API_URL"]; else process.env["FINANCE_API_URL"] = previous;
    await new Promise(ready => started.created.close(ready));
  }
});

test("a revoked financial permission answers 403 and publishes no figures", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cu26-fin-denied-"));
  const previous = process.env["FINANCE_API_URL"];
  process.env["FINANCE_API_URL"] = "http://finance.invalid";
  const started = await start({jobDirectory: directory,
    authorizeFinancialReport: createFinancialAuthorizer({fetch: grants(["payments:read"])})});
  try {
    const created = await call(started.url, "/report/financial/jobs", {body: {...PERIOD, operationId: randomUUID()}});
    assert.equal(created.status, 403);
    assert.equal(created.body.error.code, "FINANCIAL_ACCESS_DENIED");
    assert.equal(created.body.report, undefined, "una denegación no publica cifras");
    // The operational permission does not open the financial type.
    const operationalOnly = await start({jobDirectory: mkdtempSync(join(tmpdir(), "cu26-fin-op-")),
      authorizeFinancialReport: createFinancialAuthorizer({fetch: grants(["executions:read:team", "agenda:read:team"])})});
    try {
      const denied = await call(operationalOnly.url, "/report/financial/jobs",
        {body: {...PERIOD, operationId: randomUUID()}});
      assert.equal(denied.status, 403);
    } finally { await new Promise(ready => operationalOnly.created.close(ready)); }
  } finally {
    if (previous === undefined) delete process.env["FINANCE_API_URL"]; else process.env["FINANCE_API_URL"] = previous;
    await new Promise(ready => started.created.close(ready));
  }
});

test("without a configured owner the financial route fails closed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cu26-fin-unset-"));
  const previous = process.env["FINANCE_API_URL"];
  delete process.env["FINANCE_API_URL"];
  const started = await start({jobDirectory: directory});
  try {
    const response = await call(started.url, "/report/financial/jobs", {body: {...PERIOD, operationId: randomUUID()}});
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, "FINANCIAL_SOURCE_UNAVAILABLE");
  } finally {
    if (previous !== undefined) process.env["FINANCE_API_URL"] = previous;
    await new Promise(ready => started.created.close(ready));
  }
});

test("una advertencia de rentabilidad no se confunde con una afirmación", async () => {
  const {claimsProfitability} = await import("../dist/report/financial-report.js");
  assert.equal(claimsProfitability("La diferencia registrada no es rentabilidad ni saldo bancario."), false);
  assert.equal(claimsProfitability("No representa utilidad: es sólo movimiento registrado."), false);
  assert.equal(claimsProfitability("El reporte no es flujo de caja."), false);
  assert.equal(claimsProfitability("La rentabilidad del taller fue alta en el período."), true);
  assert.equal(claimsProfitability("No es rentabilidad. La ganancia real creció."), true);
});
test("un neto negativo se liga a su indicador y la plantilla queda verificada", async () => {
  const {verifyFinancialNarrative} = await import("../dist/report/financial-report.js");
  const figures = {receivedMinor: "5000", expenseMinor: "8302", netMinor: "-3302", currency: "BOB",
    paymentCount: 1, expenseCount: 3, complete: true};
  const text = "Finance registró 50.00 BOB recibidos en 1 cobro y 83.02 BOB en gastos registrados (3 gastos). "
    + "La diferencia registrada es -33.02 BOB. No es rentabilidad ni saldo bancario.";
  const check = verifyFinancialNarrative(text, figures);
  assert.equal(check.ok, true, JSON.stringify(check.problems));
  assert.ok(check.indicators.includes("finance.netMovementMinor"));
});

test("una afirmación de rentabilidad se rechaza aunque la redacción sea variada", async () => {
  const {claimsProfitability} = await import("../dist/report/financial-report.js");
  assert.equal(claimsProfitability("El taller fue rentable en el periodo."), true);
  assert.equal(claimsProfitability("No es rentabilidad. La ganancia real creció."), true);
  assert.equal(claimsProfitability("El taller no registró pérdidas: la utilidad del ejercicio creció."), true);
  assert.equal(claimsProfitability("La diferencia no es rentabilidad ni saldo bancario."), false);
  assert.equal(claimsProfitability("No representa utilidad: es movimiento registrado."), false);
});