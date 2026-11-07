// Unit tests for CU26: the figures must be the deterministic computation, and the model may only
// write prose about them — each figure attached to the indicator it belongs to. The model and the
// tool source are controlled doubles.
import {test} from "node:test";
import assert from "node:assert/strict";
import {buildNarrativeReport, ReportError, allowedNumbers, claimPatterns, verifyClaimBinding} from "../dist/report/narrative-report.js";
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

function stubSource(items = AGENDA, page = {total: items.length, limit: 50, offset: 0}) {
  const calls = [];
  return {
    calls,
    async listTools() { return []; },
    async call(name, args) {
      calls.push({name, args});
      if (name === "autonexus_list_team_agenda") {
        return {ok: true, data: {source: "operations", data: items, period: {...PERIOD, timeZone: "America/La_Paz"},
          observedAt: "2026-11-11T18:29:00.000Z", page}};
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

for (const [status, code] of [[401, "OWNER_UNAUTHORIZED"], [403, "OWNER_FORBIDDEN"]]) {
  test("execution authorization rejection is terminal, not a partial success: " + status, async () => {
    const source = stubSource();
    const original = source.call.bind(source);
    source.call = async (name, args) => name === "autonexus_get_team_execution"
      ? {ok: false, error: {status, code}} : original(name, args);
    const llm = stubLlm("This must never be published");
    await assert.rejects(build(llm, {source}), failure => failure instanceof ReportError && failure.status === status && failure.code === code);
    assert.equal(llm.calls.length, 0, "a refused execution never reaches narrative generation");
  });
}

test("figures are the deterministic computation over the agenda and the executions", async () => {
  const report = await build(stubLlm("Resumen."), {});
  assert.equal(report.figures.totalWorks, 3);
  assert.deepEqual(report.figures.byStatus, {in_progress: 2, confirmed: 1});
  assert.equal(report.figures.advances, 7, "4 + 3 advances; the failed execution is omitted, not estimated");
  assert.deepEqual(report.figures.evidence, {pending: 1, available: 5, failed: 1});
  assert.equal(report.figures.executionsConsulted, 2);
  assert.equal(report.figures.executionsFailed, 1);
  assert.equal(report.figures.complete, false);
  assert.deepEqual(report.figures.perWork.map(work => work.advances), [4, 3, null]);
  // The published total is the same population as the status counts and the itemised works.
  const statusSum = Object.values(report.figures.byStatus).reduce((total, count) => total + count, 0);
  assert.equal(statusSum, report.figures.totalWorks);
  assert.equal(report.figures.perWork.length, report.figures.totalWorks);
});

test("model prose is accepted only when every figure is bound to its own indicator", async () => {
  const text = "Entre el 2026-11-05 y el 2026-11-11 se programaron 3 trabajos: 2 en ejecución y 1 confirmado. " +
    "Se registraron 7 avances y 5 evidencias disponibles, con 1 pendiente y 1 fallida.";
  const report = await build(stubLlm(text));
  assert.equal(report.narrative.path, "llm");
  assert.equal(report.narrative.model, "qwen3.5:4b");
  assert.equal(report.narrative.text, text);
  assert.equal(report.narrative.verified, true);
  assert.equal(report.narrative.generative, true);
  const allowed = allowedNumbers(report.figures, report.period);
  for (const match of report.narrative.text.matchAll(/\d+/g)) {
    assert.ok(allowed.has(Number(match[0])), "uncomputed figure in the narrative: " + match[0]);
  }
  // The structured claims say which indicator each figure belongs to, and where it came from.
  assert.deepEqual(report.claims.map(claim => claim.indicator),
    ["works.total", "works.byStatus.in_progress", "works.byStatus.confirmed", "execution.advances",
      "evidence.available", "evidence.pending", "evidence.failed"]);
  for (const claim of report.claims) {
    assert.deepEqual(claim.period, {from: PERIOD.from, to: PERIOD.to});
    assert.equal(claim.source, "operations");
    assert.match(claim.tool, /^autonexus_/);
    assert.ok(Array.isArray(claim.recordRefs));
    assert.ok(Number.isInteger(claim.value));
  }
  assert.equal(report.claims.find(claim => claim.indicator === "works.total").value, 3);
  assert.equal(report.claims.find(claim => claim.indicator === "execution.advances").value, 7);
});

test("prose that attaches a computed figure to the wrong indicator is discarded", async () => {
  // 7 is the advances total and 3 the works total: swapping them is a wrong claim even though both
  // integers were computed, so the text must not be published.
  const report = await build(stubLlm("En el período se registraron 7 trabajos y 3 avances en total."));
  assert.equal(report.narrative.path, "deterministic");
  assert.equal(report.narrative.model, null);
  assert.equal(report.narrative.generative, false);
  assert.ok(report.limitations.some(entry => entry.startsWith("narrative_rejected_claim_binding")),
    "the rejection reason names the misbound figure: " + JSON.stringify(report.limitations));
  assert.ok(!report.narrative.text.includes("7 trabajos"));
});

test("prose with a computed figure that names no indicator is discarded", async () => {
  const report = await build(stubLlm("Se contabilizaron 7 en total durante los días revisados."));
  assert.equal(report.narrative.path, "deterministic");
  assert.ok(report.limitations.some(entry => entry.includes("figure_without_indicator")), JSON.stringify(report.limitations));
});

test("prose with a figure that was not computed is discarded for the template", async () => {
  const report = await build(stubLlm("Se programaron 12 trabajos y 40 avances en el período."));
  assert.equal(report.narrative.path, "deterministic");
  assert.equal(report.narrative.model, null);
  assert.ok(report.limitations.some(entry => entry.startsWith("narrative_rejected_uncomputed_numbers")));
  assert.ok(!report.narrative.text.includes("12 trabajos"));
  assert.match(report.narrative.text, /7 avances/);
});

test("a financial claim in the prose is rejected: the report declares no financial data", async () => {
  const report = await build(stubLlm("Se programaron 3 trabajos y se facturaron $ 1.200 en el período."));
  assert.equal(report.narrative.path, "deterministic");
  assert.ok(report.limitations.includes("narrative_rejected_financial_claim"));
  assert.equal(report.financialData.included, false);
  assert.match(report.financialData.note, /no incluye datos financieros/i);
  assert.ok(!report.narrative.text.includes("$"));
});

test("an unavailable model still produces the deterministic report, marked as not generative", async () => {
  const llm = {model: "qwen3.5:4b", totalTimeoutMs: 50, calls: [],
    async chat() { throw new LlmError("LLM_TIMEOUT", "no respondió"); }};
  const report = await build(llm);
  assert.equal(report.narrative.path, "deterministic");
  assert.equal(report.narrative.generative, false);
  assert.equal(report.narrative.model, null);
  assert.ok(report.limitations.includes("narrative_model_unavailable:LLM_TIMEOUT"));
  assert.equal(report.figures.advances, 7);
  // The template is generated from the claims, so it must pass its own binding check.
  assert.equal(report.narrative.verified, true);
  assert.deepEqual(report.limitations.filter(entry => entry.startsWith("narrative_template_unverified")), []);
  assert.ok(report.claims.length >= 5);
});

test("period, generatedAt, references and provenance are preserved", async () => {
  const report = await build(stubLlm("Sin novedades destacables en el período consultado."));
  assert.deepEqual(report.period, {from: PERIOD.from, to: PERIOD.to, timeZone: "America/La_Paz"});
  assert.equal(report.generatedAt, NOW.toISOString());
  assert.equal(report.report, "operations-narrative");
  assert.equal(report.promptVersion, "cu26-report-v3");
  // Every work contributes its order and assignment reference, in agenda order.
  assert.deepEqual(report.references.map(reference => reference.id),
    AGENDA.flatMap(item => [item.orderId, item.assignmentId]));
  assert.deepEqual(report.provenance.map(entry => entry.tool),
    ["autonexus_list_team_agenda", "autonexus_get_team_execution"]);
  assert.equal(report.provenance[0].resource, "/agenda/team");
  assert.equal(report.provenance[0].observedAt, "2026-11-11T18:29:00.000Z");
  for (const entry of report.provenance) assert.equal(entry.service, "operations");
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

test("an agenda page that reports more works than it returned fails closed", async () => {
  await assert.rejects(() => buildNarrativeReport({period: PERIOD, source: stubSource(AGENDA, {total: 9, limit: 50, offset: 0}),
    llm: null, now: () => NOW}),
    error => error instanceof ReportError && error.code === "AGENDA_INCOMPLETE");
});

test("a work without status fails closed instead of inventing a bucket", async () => {
  const items = AGENDA.map((item, index) => (index === 2 ? {...item, executionStatus: null} : item));
  await assert.rejects(() => buildNarrativeReport({period: PERIOD, source: stubSource(items), llm: null, now: () => NOW}),
    error => error instanceof ReportError && error.code === "INCOHERENT_FIGURES" && /works_without_status/.test(error.message));
});

test("a period with more works than the detail bound fails closed instead of sampling", async () => {
  await assert.rejects(() => buildNarrativeReport({period: PERIOD, source: stubSource(), llm: null, now: () => NOW, maxWorks: 2}),
    error => error instanceof ReportError && error.code === "FIGURE_RANGE_EXCEEDED");
});

test("the claim patterns and the binding checker reject a swapped indicator on their own", () => {
  const figures = {totalWorks: 2, byStatus: {in_progress: 2}, advances: 5, evidence: null,
    perWork: [], complete: true, executionsConsulted: 3, executionsFailed: 0};
  const patterns = claimPatterns(figures, PERIOD);
  assert.equal(verifyClaimBinding("Se registraron 5 avances en 3 ejecuciones consultadas.", patterns).ok, true);
  // 5 is the advances total, not the works total: the integer was computed but the claim is wrong.
  const swapped = verifyClaimBinding("Se registraron 5 trabajos en el período.", patterns);
  assert.equal(swapped.ok, false);
  assert.match(swapped.problems.join("|"), /figure_bound_to_wrong_indicator:5/);
});

test("a paragraph that names no computed figure is not published as the narrative", async () => {
  // Prose without a single computed figure can be true and still acredita nothing: the deterministic
  // text, which cites the figures, is published instead.
  const report = await build(stubLlm("El taller tuvo una semana tranquila, sin incidencias relevantes en el periodo analizado por el equipo."), {});
  assert.equal(report.narrative.path, "deterministic");
  assert.equal(report.narrative.generative, false);
  assert.ok(report.limitations.includes("narrative_rejected_missing_total"));
});

test("the verb form of a failed evidence count binds to its own indicator", () => {
  const figures = {totalWorks: 2, byStatus: {in_progress: 1, pending_verification: 1}, advances: 32,
    evidence: {pending: 1, available: 20, failed: 4}, perWork: [], complete: true,
    executionsConsulted: 2, executionsFailed: 0};
  const patterns = claimPatterns(figures, PERIOD);
  const binding = verifyClaimBinding(
    "Se registraron 2 trabajos, con 20 evidencias disponibles, 1 evidencia pendiente y 4 evidencias fallaron en 32 avances.",
    patterns);
  assert.equal(binding.ok, true, binding.problems.join("|"));
  assert.ok(binding.indicators.includes("evidence.failed"));
});

test("the verb form of consulting executions binds the consulted count", () => {
  const figures = {totalWorks: 2, byStatus: {in_progress: 1, pending_verification: 1}, advances: 32,
    evidence: {pending: 1, available: 20, failed: 4}, perWork: [], complete: true,
    executionsConsulted: 2, executionsFailed: 0};
  const patterns = claimPatterns(figures, PERIOD);
  // The paragraph a real model produced, verb included: the count must not stay unbound.
  const binding = verifyClaimBinding(
    "En el periodo se registraron 2 trabajos programados y 1 evidencia permaneció pendiente, mientras que 4 fallaron. Además, se consultaron 2 ejecuciones sin errores.",
    patterns);
  assert.equal(binding.ok, true, binding.problems.join("|"));
  assert.ok(binding.indicators.includes("executions.consulted"));
});
