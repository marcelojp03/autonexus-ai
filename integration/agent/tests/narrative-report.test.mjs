// Unit tests for CU26: the figures must be the deterministic computation, and the model may only
// write prose about them. The model and the tool source are controlled doubles.
import {test} from "node:test";
import assert from "node:assert/strict";
import {buildNarrativeReport, ReportError, allowedNumbers} from "../dist/report/narrative-report.js";
import {LlmError} from "../dist/llm/ollama.js";

const PERIOD = {from: "2026-11-05", to: "2026-11-11"};
const NOW = new Date("2026-11-11T18:30:00.000Z");

const AGENDA = [
  {assignmentId: "11111111-1111-4111-8111-111111111111", orderId: "aaaaaaaa-1111-4111-8111-111111111111",
    orderNumber: "OS-1", executionStatus: "in_progress", startsAt: "2026-11-05T13:00:00Z"},
  {assignmentId: "22222222-2222-4222-8222-222222222222", orderId: "bbbbbbbb-2222-4222-8222-222222222222",
    orderNumber: "OS-2", executionStatus: "in_progress", startsAt: "2026-11-06T13:00:00Z"},
  {assignmentId: "33333333-3333-4333-8333-333333333333", orderId: "cccccccc-3333-4333-8333-333333333333",
    orderNumber: "OS-3", executionStatus: "confirmed", startsAt: "2026-11-07T13:00:00Z"},
];

const EXECUTIONS = {
  "11111111-1111-4111-8111-111111111111": {ok: true, data: {data: {evidenceSummary: {pending: 1, available: 3, failed: 0},
    advances: [{id: "a"}, {id: "b"}, {id: "c"}, {id: "d"}]}, page: {total: 4}}},
  "22222222-2222-4222-8222-222222222222": {ok: true, data: {data: {evidenceSummary: {pending: 0, available: 2, failed: 1},
    advances: [{id: "e"}, {id: "f"}, {id: "g"}]}, page: {total: 3}}},
  "33333333-3333-4333-8333-333333333333": {ok: false, error: {code: "OWNER_UNAVAILABLE", status: 503}},
};

function stubSource() {
  const calls = [];
  return {
    calls,
    async listTools() { return []; },
    async call(name, args) {
      calls.push({name, args});
      if (name === "autonexus_list_team_agenda") {
        return {ok: true, data: {source: "operations", data: AGENDA, period: {...PERIOD, timeZone: "America/La_Paz"},
          page: {total: AGENDA.length, limit: 50, offset: 0}}};
      }
      if (name === "autonexus_get_team_execution") return EXECUTIONS[args.assignmentId] ?? {ok: false, error: {code: "OWNER_NOT_FOUND"}};
      return {ok: false, error: {code: "TOOL_NOT_AVAILABLE", status: 404}};
    },
    async close() { },
  };
}

const stubLlm = content => ({model: "qwen3.5:4b", totalTimeoutMs: 3000,
  calls: [], async chat(request) { this.calls.push(request); return {content}; }});

const build = (llm, extra = {}) => buildNarrativeReport({period: PERIOD, source: stubSource(), llm, now: () => NOW, ...extra});

test("figures are the deterministic computation over the agenda and the executions", async () => {
  const report = await build(stubLlm("Resumen."), {});
  assert.equal(report.figures.works, 3);
  assert.deepEqual(report.figures.byStatus, {in_progress: 2, confirmed: 1});
  assert.equal(report.figures.advances, 7, "4 + 3 advances; the failed execution is omitted, not estimated");
  assert.deepEqual(report.figures.evidence, {pending: 1, available: 5, failed: 1});
  assert.equal(report.figures.executionsConsulted, 2);
  assert.equal(report.figures.executionsFailed, 1);
  assert.equal(report.figures.complete, false);
  assert.deepEqual(report.figures.perWork.map(work => work.advances), [4, 3, null]);
});

test("model prose is accepted only when every figure in it was computed", async () => {
  const text = "Entre el 2026-11-05 y el 2026-11-11 se programaron 3 trabajos: 2 en ejecución y 1 confirmado. " +
    "Se registraron 7 avances y 5 evidencias disponibles, con 1 pendiente y 1 fallida.";
  const report = await build(stubLlm(text));
  assert.equal(report.narrative.path, "llm");
  assert.equal(report.narrative.model, "qwen3.5:4b");
  assert.equal(report.narrative.text, text);
  assert.equal(report.narrative.verified, true);
  const allowed = allowedNumbers(report.figures, report.period);
  for (const match of report.narrative.text.matchAll(/\d+/g)) {
    assert.ok(allowed.has(Number(match[0])), "uncomputed figure in the narrative: " + match[0]);
  }
});

test("prose with a figure that was not computed is discarded for the template", async () => {
  const report = await build(stubLlm("Se programaron 12 trabajos y 40 avances en el período."));
  assert.equal(report.narrative.path, "deterministic");
  assert.equal(report.narrative.model, null);
  assert.ok(report.warnings.some(warning => warning.startsWith("narrative_rejected_uncomputed_numbers")));
  assert.ok(!report.narrative.text.includes("12 trabajos"));
  assert.match(report.narrative.text, /7 avances/);
});

test("a financial claim in the prose is rejected: the report declares no financial data", async () => {
  const report = await build(stubLlm("Se programaron 3 trabajos y se facturaron $ 1.200 en el período."));
  assert.equal(report.narrative.path, "deterministic");
  assert.ok(report.warnings.includes("narrative_rejected_financial_claim"));
  assert.equal(report.financialData.included, false);
  assert.match(report.financialData.note, /no incluye datos financieros/i);
  assert.ok(!report.narrative.text.includes("$"));
});

test("an unavailable model still produces the deterministic report", async () => {
  const llm = {model: "qwen3.5:4b", totalTimeoutMs: 50, calls: [],
    async chat() { throw new LlmError("LLM_TIMEOUT", "no respondió"); }};
  const report = await build(llm);
  assert.equal(report.narrative.path, "deterministic");
  assert.ok(report.warnings.includes("narrative_model_unavailable:LLM_TIMEOUT"));
  assert.equal(report.figures.advances, 7);
});

test("period, generatedAt, per-section references and provenance are preserved", async () => {
  const report = await build(stubLlm("Sin novedades destacables en el período consultado."));
  assert.deepEqual(report.period, {from: "2026-11-05", to: "2026-11-11", timeZone: "America/La_Paz"});
  assert.equal(report.generatedAt, NOW.toISOString());
  assert.deepEqual(report.sections.works.references.map(reference => reference.id),
    ["aaaaaaaa-1111-4111-8111-111111111111", "bbbbbbbb-2222-4222-8222-222222222222", "cccccccc-3333-4333-8333-333333333333"]);
  assert.deepEqual(report.sections.execution.references.map(reference => reference.id), AGENDA.map(item => item.assignmentId));
  assert.equal(report.provenance.source, "operations");
  assert.equal(report.provenance.figuresComputedBy, "deterministic");
  assert.deepEqual(report.provenance.tools, ["autonexus_list_team_agenda", "autonexus_get_team_execution"]);
  assert.equal(report.provenance.promptVersion, "cu26-report-v1");
  assert.equal(report.report, "operations-narrative");
});

test("period validation rejects malformed, inverted and oversized ranges", async () => {
  for (const period of [{from: "2026-11-05", to: "2026-11-01"}, {from: "05/11/2026", to: "2026-11-11"},
    {from: "2026-01-01", to: "2026-11-11"}]) {
    await assert.rejects(async () => buildNarrativeReport({period, source: stubSource(), llm: null, now: () => NOW}),
      error => error instanceof ReportError && error.code === "INVALID_PERIOD", JSON.stringify(period));
  }
});

test("an agenda failure is an honest error, never an empty report", async () => {
  const failing = {async listTools() { return []; }, async call() { return {ok: false, error: {code: "OWNER_FORBIDDEN", status: 403}}; },
    async close() { }};
  await assert.rejects(() => buildNarrativeReport({period: PERIOD, source: failing, llm: null, now: () => NOW}),
    error => error instanceof ReportError && error.code === "AGENDA_UNAVAILABLE" && error.status === 403);
});
