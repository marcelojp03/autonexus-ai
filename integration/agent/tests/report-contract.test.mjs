// Unit tests for the report contract: the document this service publishes must satisfy the shape the
// BFF consumes, and the checker must report a missing figure instead of reading it as a zero.
import {test} from "node:test";
import assert from "node:assert/strict";
import {buildNarrativeReport} from "../dist/report/narrative-report.js";
import {checkReportContract} from "../dist/report/contract.js";

const PERIOD = {from: "2026-11-05", to: "2026-11-11"};
const NOW = new Date("2026-11-11T18:30:00.000Z");

const AGENDA = [
  {assignmentId: "11111111-1111-4111-8111-111111111111", orderId: "aaaaaaaa-1111-4111-8111-111111111111",
    orderNumber: "OS-1", executionStatus: "in_progress", startsAt: "2026-11-05T13:00:00Z"},
  {assignmentId: "22222222-2222-4222-8222-222222222222", orderId: "bbbbbbbb-2222-4222-8222-222222222222",
    orderNumber: "OS-2", executionStatus: "pending_verification", startsAt: "2026-11-06T13:00:00Z"},
];

const EXECUTIONS = {
  "11111111-1111-4111-8111-111111111111": {ok: true, data: {data: {evidenceSummary: {pending: 1, available: 2, failed: 0},
    advances: [{id: "a"}, {id: "b"}]}, page: {total: 2}}},
  "22222222-2222-4222-8222-222222222222": {ok: true, data: {data: {evidenceSummary: {pending: 0, available: 1, failed: 1}},
    advances: [{id: "c"}]}},
};

function stubSource() {
  return {
    async listTools() { return []; },
    async call(name, args) {
      if (name === "autonexus_list_team_agenda") {
        return {ok: true, data: {source: "operations", data: AGENDA, period: {...PERIOD, timeZone: "America/La_Paz"},
          observedAt: "2026-11-11T18:29:00.000Z", page: {total: AGENDA.length}}};
      }
      if (name === "autonexus_get_team_execution") {
        return EXECUTIONS[args.assignmentId] ?? {ok: false, error: {code: "OWNER_NOT_FOUND"}};
      }
      return {ok: false, error: {code: "TOOL_NOT_AVAILABLE", status: 404}};
    },
    async close() { },
  };
}

// A model that answers exactly what the test wants, so the generative and the fallback path are both
// reachable without a real endpoint.
const stubLlm = content => ({model: "qwen3.5:4b", totalTimeoutMs: 3000, async chat() { return {content}; }});
const BOUND_PROSE = "Se programaron 2 trabajos entre el 2026-11-05 y el 2026-11-11, uno en ejecución y otro pendiente de verificación.";

const build = llm => buildNarrativeReport({period: PERIOD, source: stubSource(), llm, now: () => NOW});

test("the published document satisfies the contract the BFF consumes", async () => {
  const report = await build(stubLlm(BOUND_PROSE));
  assert.deepEqual(checkReportContract(report), [], "ninguna violación del contrato");
  assert.equal(report.figures.totalWorks, 2);
  assert.equal(report.narrative.path, "llm", "el doble devuelve prosa ligada a las cifras");
  assert.equal(report.narrative.generative, true);
});

test("the deterministic fallback also satisfies the contract and declares itself generative: false", async () => {
  const report = await build(null);
  assert.deepEqual(checkReportContract(report), []);
  assert.equal(report.narrative.path, "deterministic");
  assert.equal(report.narrative.generative, false);
  assert.equal(report.narrative.model, null);
});

test("a document without totalWorks is reported, never completed with a zero", async () => {
  const report = await build(null);
  const damaged = structuredClone(report);
  delete damaged.figures.totalWorks;
  const problems = checkReportContract(damaged);
  assert.deepEqual(problems.map(problem => [problem.path, problem.problem]), [["figures.totalWorks", "missing"]]);
});

test("a total that contradicts the status counts is reported as inconsistent", async () => {
  const report = await build(null);
  const damaged = structuredClone(report);
  damaged.figures.totalWorks = 7;
  const problems = checkReportContract(damaged);
  assert.ok(problems.some(problem => problem.path === "figures.totalWorks" && problem.problem === "inconsistent"));
  assert.ok(problems.some(problem => problem.path === "figures.perWork" && problem.problem === "inconsistent"));
});

test("an evidence count that is absent is reported instead of assumed zero", async () => {
  const report = await build(null);
  const damaged = structuredClone(report);
  delete damaged.figures.evidence.failed;
  const problems = checkReportContract(damaged);
  assert.ok(problems.some(problem => problem.path === "figures.evidence.failed" && problem.problem === "missing"));
});

test("a deterministic narrative that claims a model is reported as inconsistent", async () => {
  const report = await build(null);
  const damaged = structuredClone(report);
  damaged.narrative.model = "qwen3.5:4b";
  const problems = checkReportContract(damaged);
  assert.ok(problems.some(problem => problem.path === "narrative.model" && problem.problem === "inconsistent"));
});

test("a model narrative without its model name is reported", async () => {
  const report = await build(stubLlm(BOUND_PROSE));
  const damaged = structuredClone(report);
  damaged.narrative.model = null;
  const problems = checkReportContract(damaged);
  assert.ok(problems.some(problem => problem.path === "narrative.model" && problem.problem === "missing"));
});

test("a claim without its period or its reference list is reported", async () => {
  const report = await build(stubLlm(BOUND_PROSE));
  assert.ok(report.claims.length > 0, "la prosa ligada publica afirmaciones");
  const damaged = structuredClone(report);
  delete damaged.claims[0].period;
  damaged.claims[0].recordRefs = null;
  const problems = checkReportContract(damaged);
  assert.ok(problems.some(problem => problem.path === "claims[0].period" && problem.problem === "missing"));
  assert.ok(problems.some(problem => problem.path === "claims[0].recordRefs"));
});
