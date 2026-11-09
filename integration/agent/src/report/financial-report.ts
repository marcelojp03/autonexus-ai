/**
 * CU26 — financial report (S2.15).
 *
 * This is a report TYPE of its own, not a variant of the operational report: its own discriminator,
 * its own version, its own contract checker, its own claims (money as canonical centavo strings) and
 * its own limitations. Nothing here reuses `OperationsReport` or `checkReportContract`.
 *
 * The only source is the Finance owner summary reached through the assistant's bearer-forwarding tool
 * (`autonexus_get_financial_summary` -> GET /financial-summary). That owner already computes the
 * figures; this file publishes exactly those numbers and never fills a gap with a zero: if the owner
 * does not answer, the job fails closed. Money never passes through `number`.
 */
import {LlmError, type ChatMessage, type LlmClient} from "../llm/ollama.js";
import type {ToolSource} from "../sources/mcp.js";
import {FINANCIAL_TOOL, validateFinancialSummary, type FinancialSummary} from "../assistant/financial-summary.js";
import {ReportError, TIME_ZONE, validatePeriod} from "./narrative-report.js";

export const FINANCIAL_REPORT_VERSION = "cu26-financial-report-v1";
export const FINANCIAL_DISCRIMINATOR = "financial-narrative";
/** Stable indicator ids: these are the only figures a financial narrative may name. */
export const RECEIVED_INDICATOR = "finance.receivedAmountMinor";
export const EXPENSE_INDICATOR = "finance.expenseAmountMinor";
export const NET_INDICATOR = "finance.netMovementMinor";
export const PAYMENT_COUNT_INDICATOR = "finance.paymentCount";
export const EXPENSE_COUNT_INDICATOR = "finance.expenseCount";
export const FINANCIAL_LIMITATION_NO_PROFITABILITY =
  "movimiento_neto_no_es_rentabilidad_ni_saldo_bancario";
export const FINANCIAL_LIMITATION_SCOPE =
  "solo_cobros_y_gastos_registrados_del_periodo_no_obligaciones_ni_cotizaciones";
export const FINANCIAL_LIMITATION_NO_FILTERS =
  "sin_filtro_por_categoria_empleado_o_indicador_el_propietario_no_los_publica";

const CLAIM_WINDOW = 80;
const CLAIM_CLAUSE_PENALTY = 25;
const CLAUSE_BREAK = /[,;:.!?()«»“”"]|\by\b/;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
/** An instant is the owner's own timestamp, not a figure of the report. */
const ISO_INSTANT = /\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g;
const CANONICAL_MINOR = /^(0|[1-9]\d*)$/;
const SIGNED_MINOR = /^(0|-?[1-9]\d*)$/;

export interface FinancialFigures {
  /** Canonical string of integer centavos BOB, exactly as the owner computed it. */
  readonly receivedMinor: string;
  readonly expenseMinor: string;
  readonly netMinor: string;
  readonly currency: "BOB";
  readonly paymentCount: number;
  readonly expenseCount: number;
  /** True only when the owner answered for the requested period and the arithmetic closes in BigInt. */
  readonly complete: boolean;
}

export interface FinancialClaim {
  readonly indicator: string;
  readonly label: string;
  /** Canonical string: centavos for money, decimal integer for counts. Never a JSON number. */
  readonly value: string;
  /** `centavos BOB` for money, `cobros`/`gastos` for counts. */
  readonly unit: string;
  readonly period: {readonly from: string; readonly to: string};
  readonly source: "finance";
  readonly tool: string;
  readonly recordRefs: readonly never[];
}

export interface FinancialReport {
  readonly report: typeof FINANCIAL_DISCRIMINATOR;
  readonly reportVersion: string;
  readonly period: {readonly from: string; readonly to: string; readonly timeZone: string};
  /** The owner's own computation instant: what "the figures are current as of" means here. */
  readonly generatedAt: string;
  readonly promptVersion: string;
  readonly figures: FinancialFigures;
  readonly claims: readonly FinancialClaim[];
  readonly narrative: {
    readonly text: string;
    readonly path: "llm" | "deterministic";
    readonly model: string | null;
    readonly verified: boolean;
    readonly generative: boolean;
  };
  readonly references: readonly never[];
  readonly provenance: ReadonlyArray<{readonly service: "finance"; readonly resource: string;
    readonly tool: string; readonly observedAt: string | null}>;
  readonly limitations: readonly string[];
}

const record = (value: unknown): Record<string, unknown> =>
  (value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});

/** Centavos rendered as `1234.56 BOB`, computed with BigInt so no float is ever involved. */
export function moneyText(minor: string): string {
  const value = BigInt(minor);
  const absolute = value < 0n ? -value : value;
  return (value < 0n ? "-" : "") + String(absolute / 100n) + "." +
    String(absolute % 100n).padStart(2, "0") + " BOB";
}

/** `12` y `34` → `1234n` centavos. Los dígitos se concatenan, nunca se dividen: no hay float. */
const toCents = (units: string, decimals: string, negative = false): bigint => {
  const amount = BigInt(units + decimals.padStart(2, "0"));
  return negative ? -amount : amount;
};

export function financialClaims(period: {from: string; to: string}, figures: FinancialFigures): FinancialClaim[] {
  const base = {period: {from: period.from, to: period.to}, source: "finance" as const,
    tool: FINANCIAL_TOOL, recordRefs: [] as const};
  return [
    {...base, indicator: RECEIVED_INDICATOR, label: "cobros registrados (recibido)",
      value: figures.receivedMinor, unit: "centavos BOB"},
    {...base, indicator: EXPENSE_INDICATOR, label: "gastos registrados",
      value: figures.expenseMinor, unit: "centavos BOB"},
    {...base, indicator: NET_INDICATOR, label: "movimiento neto registrado (recibido − gastos)",
      value: figures.netMinor, unit: "centavos BOB"},
    {...base, indicator: PAYMENT_COUNT_INDICATOR, label: "cantidad de cobros registrados",
      value: String(figures.paymentCount), unit: "cobros"},
    {...base, indicator: EXPENSE_COUNT_INDICATOR, label: "cantidad de gastos registrados",
      value: String(figures.expenseCount), unit: "gastos"},
  ];
}

/**
 * Reads the owner summary into figures. An absent, contradictory or out-of-period field is a failure:
 * the report does not publish figures it cannot prove, and it never reads an absence as `0`.
 */
export function financialFigures(summary: FinancialSummary | null, period: {from: string; to: string}): FinancialFigures {
  if (summary === null) throw new ReportError("FINANCIAL_SUMMARY_INVALID",
    "El resumen del propietario no cumple el contrato financiero: no se publican cifras.", null);
  if (summary.from !== period.from || summary.to !== period.to) {
    throw new ReportError("FINANCIAL_PERIOD_MISMATCH",
      "El propietario respondió por otro período: no se publican cifras ajenas a la solicitud.", null);
  }
  const received = BigInt(summary.receivedAmountMinor);
  const expense = BigInt(summary.expenseAmountMinor);
  const net = BigInt(summary.netMovementMinor);
  if (received - expense !== net) {
    throw new ReportError("INCOHERENT_FINANCIAL_FIGURES",
      "El resumen del propietario no cierra (recibido − gasto ≠ neto) en BigInt: se rechaza el reporte.",
      null);
  }
  return {receivedMinor: summary.receivedAmountMinor, expenseMinor: summary.expenseAmountMinor,
    netMinor: summary.netMovementMinor, currency: "BOB", paymentCount: summary.paymentCount,
    expenseCount: summary.expenseCount, complete: true};
}

export interface FinancialNarrativeCheck {
  readonly ok: boolean;
  readonly problems: readonly string[];
  readonly indicators: readonly string[];
}

interface IndicatorTerm {
  readonly indicator: string;
  readonly value: bigint | number;
  readonly money: boolean;
  readonly terms: readonly RegExp[];
}

function terms(figures: FinancialFigures): IndicatorTerm[] {
  return [
    {indicator: RECEIVED_INDICATOR, value: BigInt(figures.receivedMinor), money: true,
      terms: [/\brecibid[oa]s?\b/gi, /\bcobrad[oa]s?\b/gi, /\bcobros?\b/gi, /\bingresos?\b/gi, /\brecibimos\b/gi]},
    {indicator: EXPENSE_INDICATOR, value: BigInt(figures.expenseMinor), money: true,
      terms: [/\bgastos?\b/gi, /\begresos?\b/gi, /\bgastad[oa]s?\b/gi]},
    {indicator: NET_INDICATOR, value: BigInt(figures.netMinor), money: true,
      terms: [/\bneto\b/gi, /\bmovimiento\b/gi, /\bdiferencia\b/gi, /\bdiferencia\w*\b/gi]},
    {indicator: PAYMENT_COUNT_INDICATOR, value: figures.paymentCount, money: false,
      terms: [/\bcobros?\b/gi, /\bpagos?\b/gi]},
    {indicator: EXPENSE_COUNT_INDICATOR, value: figures.expenseCount, money: false,
      terms: [/\bgastos?\b/gi, /\begresos?\b/gi]},
  ];
}

/**
 * Binds every amount of the prose to the indicator that produced it. A figure that is not one of the
 * computed indicators, or that sits next to another indicator, is not publishable: the narrative is
 * rejected and the deterministic template is published instead. The three amounts must all appear.
 */
export function verifyFinancialNarrative(text: string, figures: FinancialFigures): FinancialNarrativeCheck {
  const cleaned = text.replace(ISO_INSTANT, " ").replace(ISO_DATE, " ");
  const problems: string[] = [];
  const asserted: string[] = [];
  const known = terms(figures);
  const occurrences: Array<{start: number; end: number; term: IndicatorTerm}> = [];
  for (const term of known) {
    for (const pattern of term.terms) {
      pattern.lastIndex = 0;
      for (const match of cleaned.matchAll(pattern)) {
        if (typeof match.index !== "number" || match[0].length === 0) continue;
        occurrences.push({start: match.index, end: match.index + match[0].length, term});
      }
    }
  }
  const bind = (start: number, end: number, literal: string, wanted: bigint | number): boolean => {
    const scored = occurrences.map(occurrence => {
      const following = occurrence.start >= end;
      const gap = following ? cleaned.slice(end, occurrence.start) : cleaned.slice(occurrence.end, start);
      const distance = following ? occurrence.start - end : Math.max(0, start - occurrence.end);
      return {term: occurrence.term, score: distance + (CLAUSE_BREAK.test(gap) ? CLAIM_CLAUSE_PENALTY : 0)};
    }).filter(candidate => candidate.score <= CLAIM_WINDOW);
    if (scored.length === 0) { problems.push("figure_without_indicator:" + literal); return false; }
    const best = Math.min(...scored.map(candidate => candidate.score));
    const nearest = scored.filter(candidate => candidate.score <= best + 6);
    if (!nearest.some(candidate => candidate.term.value === wanted)) {
      problems.push("figure_bound_to_wrong_indicator:" + literal);
      return false;
    }
    const matched = nearest.find(candidate => candidate.term.value === wanted) as {term: IndicatorTerm};
    if (!asserted.includes(matched.term.indicator)) asserted.push(matched.term.indicator);
    return true;
  };

  const consumed: Array<[number, number]> = [];
  // El neto puede ser negativo: sin signo, la propia plantilla no podría ligar su importe.
  const moneyPattern = /(-|\u2212)?\s*(\d{1,3}(?:\.\d{3})*|\d+)[.,](\d{2})\s*(?:BOB|Bs\.?|bolivianos?)/gi;
  for (const match of cleaned.matchAll(moneyPattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    consumed.push([start, end]);
    const literal = match[0];
    let value: bigint;
    try {
      value = toCents((match[2] ?? "").replace(/\./g, ""), match[3] ?? "00", (match[1] ?? "").length > 0);
    } catch {
      problems.push("figure_unreadable:" + literal);
      continue;
    }
    const money = known.filter(term => term.money);
    if (!money.some(term => term.value === value)) {
      problems.push("figure_not_computed:" + literal);
      continue;
    }
    bind(start, end, literal, value);
  }
  for (const match of cleaned.matchAll(/\b\d+\b/g)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (consumed.some(([from, to]) => start >= from && end <= to)) continue;
    const value = Number(match[0]);
    const counts = known.filter(term => !term.money);
    if (!counts.some(term => term.value === value)) { problems.push("figure_not_computed:" + match[0]); continue; }
    bind(start, end, match[0], value);
  }
  for (const indicator of [RECEIVED_INDICATOR, EXPENSE_INDICATOR, NET_INDICATOR]) {
    if (!asserted.includes(indicator)) problems.push("amount_missing:" + indicator);
  }
  return {ok: problems.length === 0, problems, indicators: asserted};
}

/** Claims published for a text: exactly the indicators the prose actually named. */
export function publishedFinancialClaims(period: {from: string; to: string},
  figures: FinancialFigures, indicators: readonly string[]): FinancialClaim[] {
  const asserted = new Set(indicators);
  return financialClaims(period, figures).filter(claim => asserted.has(claim.indicator));
}

/** Template built from the computed figures only; used as-is when the model is down or non-conforming. */
export function deterministicFinancialNarrative(period: {from: string; to: string},
  figures: FinancialFigures, ownerGeneratedAt: string): string {
  return "Entre el " + period.from + " y el " + period.to + " (America/La_Paz), Finance registró " +
    moneyText(figures.receivedMinor) + " recibidos en " + String(figures.paymentCount) +
    " cobros y " + moneyText(figures.expenseMinor) + " en gastos registrados (" +
    String(figures.expenseCount) + " gastos). La diferencia registrada es " +
    moneyText(figures.netMinor) + ". No es rentabilidad, utilidad, flujo de caja ni saldo bancario: " +
    "el resumen del propietario se calculó el " + ownerGeneratedAt.slice(0, 10) + " y sólo comprende importes registrados.";
}

const FINANCIAL_SYSTEM = [
  "Redactas un resumen financiero de un taller mecánico a partir de cifras ya calculadas.",
  "OBLIGATORIO: escribe cada importe con su formato exacto, por ejemplo 1234.56 BOB, usando punto decimal y dos decimales.",
  "Escribe cada importe junto a su indicador: recibido/cobros para el total recibido, gastos para el total gastado, diferencia registrada para el neto.",
  "Nombra las cantidades con dígitos junto a cobros y gastos.",
  "Usa exclusivamente las cifras entregadas: no agregues importes, porcentajes, promedios, proyecciones ni cálculos nuevos.",
  "No afirmes rentabilidad, utilidad, ganancia, flujo de caja, saldo bancario ni salud financiera.",
  "No menciones fechas: el documento ya muestra el período.",
  "Escribe en español, en un solo párrafo de 50 a 110 palabras, sin listas.",
].join("\n");

async function callModel(llm: LlmClient, messages: readonly ChatMessage[], deadlineMs: number): Promise<string> {
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) throw new LlmError("LLM_TIMEOUT", "The financial report deadline elapsed.");
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new LlmError("LLM_TIMEOUT", "The financial report deadline elapsed.")), remaining);
  });
  try {
    const turn = await Promise.race([llm.chat({messages, deadlineMs, think: false}), guard]);
    return turn.content.trim();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const PROFITABILITY = /\b(rentabilidad|rentables?|utilidad(?:es)?|ganancias?|flujo de caja|saldo bancario|salud financiera|liquidez)\b/i;
/**
 * Una advertencia no es una afirmación: «no es rentabilidad» debe publicarse. Se descartan las
 * apariciones negadas o enumeradas tras «ni» y sólo se rechaza lo que quede como aserción propia.
 */
const NEGATED_PROFITABILITY = /\b(?:no|ni|sin|tampoco)\s+(?:(?:es|son|representa|constituye|implica|significa|debe\s+interpretarse\s+como|se\s+debe\s+interpretar\s+como)\s+)?(?:(?:un|una|el|la|los|las)\s+)?(rentabilidad|rentables?|utilidad(?:es)?|ganancias?|flujo\s+de\s+caja|saldo\s+bancario|salud\s+financiera|liquidez)\b/gi;
export function claimsProfitability(text: string): boolean {
  return PROFITABILITY.test(text.replace(NEGATED_PROFITABILITY, " "));
}

export interface FinancialReportOptions {
  readonly period: {readonly from: string; readonly to: string};
  readonly source: ToolSource;
  readonly llm?: LlmClient | null;
  readonly now?: () => Date;
}

/**
 * Owner read. The tool re-checks the employee grants with this same bearer before calling Finance, so
 * authorization is revalidated at execution too, not only when the job was created. A rejected
 * authorization stays 401/403 so the job closes with a terminal code.
 */
async function readOwnerSummary(period: {from: string; to: string}, source: ToolSource): Promise<FinancialSummary> {
  const outcome = await source.call(FINANCIAL_TOOL, {from: period.from, to: period.to, responseFormat: "json"});
  if (!outcome.ok) {
    const status = outcome.error?.status;
    const code = outcome.error?.code ?? "TOOL_ERROR";
    if (status === 401 || code === "OWNER_UNAUTHORIZED") {
      throw new ReportError("OWNER_UNAUTHORIZED", "El propietario rechazó el token financiero.", 401);
    }
    if (status === 403 || code === "OWNER_FORBIDDEN") {
      throw new ReportError("FINANCIAL_ACCESS_DENIED", "La cuenta no conserva ambos permisos financieros.", 403);
    }
    throw new ReportError("FINANCIAL_SUMMARY_UNAVAILABLE",
      "El resumen del propietario financiero no respondió (" + code + ").", null);
  }
  const body = record(outcome.data);
  const summary = validateFinancialSummary(body["data"], period);
  // Anything the owner did not publish is a failure of this report, never a zero.
  if (summary === null) throw new ReportError("FINANCIAL_SUMMARY_INVALID",
    "El resumen del propietario no cumple el contrato financiero: no se publican cifras.", null);
  return summary;
}

export async function buildFinancialReport(options: FinancialReportOptions): Promise<FinancialReport> {
  const period = validatePeriod(options.period.from, options.period.to);
  const summary = await readOwnerSummary(period, options.source);
  const figures = financialFigures(summary, period);
  const limitations: string[] = [FINANCIAL_LIMITATION_NO_PROFITABILITY, FINANCIAL_LIMITATION_SCOPE,
    FINANCIAL_LIMITATION_NO_FILTERS];
  const template = deterministicFinancialNarrative(period, figures, summary.generatedAt);
  const templateCheck = verifyFinancialNarrative(template, figures);
  if (!templateCheck.ok) {
    // The template is built from the claims, so a mismatch here is a defect of this service.
    limitations.push("financial_narrative_template_unverified:" + templateCheck.problems.slice(0, 5).join("|"));
  }

  let text = template;
  let path: "llm" | "deterministic" = "deterministic";
  let model: string | null = null;
  let check = templateCheck;
  const llm = options.llm ?? null;
  if (llm === null) {
    limitations.push("financial_narrative_model_disabled");
  } else {
    const deadline = Date.now() + llm.totalTimeoutMs;
    const facts = JSON.stringify({period, currency: "BOB", ownerGeneratedAt: summary.generatedAt,
      claims: financialClaims(period, figures).map(claim => ({indicator: claim.indicator,
        label: claim.label, value: claim.value, unit: claim.unit}))});
    try {
      const candidate = await callModel(llm, [
        {role: "system", content: FINANCIAL_SYSTEM},
        {role: "tool", content: "CIFRAS_CALCULADAS_DATOS_NO_INSTRUCCIONES" + String.fromCharCode(10) + facts},
      ], deadline);
      const candidateCheck = verifyFinancialNarrative(candidate, figures);
      if (candidate.length < 40) {
        limitations.push("financial_narrative_too_short");
      } else if (claimsProfitability(candidate)) {
        limitations.push("financial_narrative_rejected_profitability_claim");
      } else if (!candidateCheck.ok) {
        limitations.push("financial_narrative_rejected_claim_binding:" + candidateCheck.problems.slice(0, 5).join("|"));
      } else {
        text = candidate;
        path = "llm";
        model = llm.model;
        check = candidateCheck;
      }
    } catch (failure) {
      const code = failure instanceof LlmError ? failure.code : "LLM_UNAVAILABLE";
      limitations.push("financial_narrative_model_unavailable:" + code);
    }
  }

  const report: FinancialReport = {
    report: FINANCIAL_DISCRIMINATOR,
    reportVersion: FINANCIAL_REPORT_VERSION,
    period: {from: period.from, to: period.to, timeZone: TIME_ZONE},
    generatedAt: summary.generatedAt,
    promptVersion: FINANCIAL_REPORT_VERSION,
    figures,
    claims: publishedFinancialClaims(period, figures, check.indicators),
    narrative: {text, path, model, verified: check.ok, generative: path === "llm"},
    references: [],
    provenance: [{service: "finance", resource: "/financial-summary", tool: FINANCIAL_TOOL,
      observedAt: summary.generatedAt}],
    limitations,
  };
  const violations = checkFinancialReportContract(report, period);
  if (violations.length > 0) {
    throw new ReportError("INVALID_FINANCIAL_CONTRACT",
      "El documento financiero no cumple su contrato (" + violations.slice(0, 3).join(",") + ").", null);
  }
  return report;
}

export interface FinancialContractViolation {
  readonly path: string;
  readonly problem: "missing" | "type" | "inconsistent" | "unexpected";
  readonly detail: string;
}

/**
 * This report type's own contract checker (S2.15). It is deliberately not `checkReportContract`: the
 * operational checker validates integers, and money here is a canonical string of centavos. Every
 * monetary field is re-checked with BigInt, and a claim that is not one of the computed indicators is
 * a violation instead of a warning.
 */
export function checkFinancialReportContract(value: unknown,
  period?: {from: string; to: string}): string[] {
  const violations: FinancialContractViolation[] = [];
  const push = (path: string, problem: FinancialContractViolation["problem"], detail: string): void => {
    violations.push({path, problem, detail});
  };
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return ["(document):type"];
  }
  const body = value as Record<string, unknown>;
  if (body["report"] !== FINANCIAL_DISCRIMINATOR) push("report", "unexpected", "discriminador ajeno");
  if (body["reportVersion"] !== FINANCIAL_REPORT_VERSION) push("reportVersion", "unexpected", "versión ajena");
  const documentPeriod = record(body["period"]);
  const from = documentPeriod["from"], to = documentPeriod["to"];
  if (typeof from !== "string" || typeof to !== "string") push("period", "missing", "período no publicado");
  else if (period !== undefined && (from !== period.from || to !== period.to)) push("period", "inconsistent", "otro período");
  if (documentPeriod["timeZone"] !== TIME_ZONE) push("period.timeZone", "unexpected", "zona ajena");
  if (typeof body["generatedAt"] !== "string" || Number.isNaN(Date.parse(String(body["generatedAt"])))) {
    push("generatedAt", "missing", "instante del propietario ausente");
  }
  if (typeof body["promptVersion"] !== "string") push("promptVersion", "missing", "versión ausente");

  const figures = record(body["figures"]);
  const money = (key: string, signed: boolean): bigint | null => {
    const found = figures[key];
    if (found === undefined) { push("figures." + key, "missing", "importe no publicado"); return null; }
    if (typeof found !== "string" || !(signed ? SIGNED_MINOR : CANONICAL_MINOR).test(found)) {
      push("figures." + key, "type", "se espera string canónico de centavos");
      return null;
    }
    return BigInt(found);
  };
  const received = money("receivedMinor", false);
  const expense = money("expenseMinor", false);
  const net = money("netMinor", true);
  if (received !== null && expense !== null && net !== null && received - expense !== net) {
    push("figures.netMinor", "inconsistent", "recibido − gasto ≠ neto en BigInt");
  }
  for (const key of ["paymentCount", "expenseCount"]) {
    const found = figures[key];
    if (typeof found !== "number" || !Number.isInteger(found) || found < 0) {
      push("figures." + key, "type", "se espera entero >= 0");
    }
  }
  if (figures["currency"] !== "BOB") push("figures.currency", "unexpected", "moneda ajena");
  if (figures["complete"] !== true) push("figures.complete", "inconsistent", "el propietario no completó el período");

  const narrative = record(body["narrative"]);
  const path = narrative["path"];
  if (path !== "llm" && path !== "deterministic") push("narrative.path", "type", "se espera llm o deterministic");
  if (typeof narrative["text"] !== "string" || String(narrative["text"]).trim().length === 0) {
    push("narrative.text", "missing", "texto no publicado");
  }
  if (path === "deterministic" && narrative["model"] !== null) push("narrative.model", "inconsistent", "plantilla con modelo");
  if (path === "llm" && (typeof narrative["model"] !== "string" || !String(narrative["model"]).trim())) {
    push("narrative.model", "missing", "narración del modelo sin modelo");
  }
  if (path === "deterministic" && narrative["generative"] !== false) push("narrative.generative", "inconsistent", "plantilla marcada generativa");
  if (path === "llm" && narrative["generative"] !== true) push("narrative.generative", "inconsistent", "texto del modelo no marcado generativo");
  if (typeof narrative["verified"] !== "boolean") push("narrative.verified", "type", "se espera booleano");

  const claims = body["claims"];
  if (!Array.isArray(claims)) push("claims", "type", "se espera lista");
  else {
    const expected = new Map(financialClaims({from: String(from), to: String(to)}, {
      receivedMinor: String(figures["receivedMinor"] ?? "0"), expenseMinor: String(figures["expenseMinor"] ?? "0"),
      netMinor: String(figures["netMinor"] ?? "0"), currency: "BOB",
      paymentCount: Number(figures["paymentCount"] ?? 0), expenseCount: Number(figures["expenseCount"] ?? 0),
      complete: true,
    }).map(claim => [claim.indicator, claim.value] as [string, string]));
    for (const [index, entry] of claims.entries()) {
      const claim = record(entry);
      const where = "claims[" + String(index) + "]";
      if (claim["source"] !== "finance") push(where + ".source", "unexpected", "fuente ajena al reporte financiero");
      if (claim["tool"] !== FINANCIAL_TOOL) push(where + ".tool", "unexpected", "herramienta ajena");
      const indicator = claim["indicator"];
      if (typeof indicator !== "string") { push(where + ".indicator", "missing", "indicador ausente"); continue; }
      const value = claim["value"];
      if (typeof value !== "string") { push(where + ".value", "type", "se espera string canónico, nunca número"); continue; }
      if (expected.get(indicator) !== value) push(where + ".value", "inconsistent", "la afirmación no coincide con la cifra");
      if (typeof claim["unit"] !== "string" || !String(claim["unit"]).trim()) push(where + ".unit", "missing", "unidad ausente");
      if (typeof claim["label"] !== "string" || !String(claim["label"]).trim()) push(where + ".label", "missing", "etiqueta ausente");
      const claimPeriod = record(claim["period"]);
      if (claimPeriod["from"] !== from || claimPeriod["to"] !== to) push(where + ".period", "inconsistent", "otro período");
      if (!Array.isArray(claim["recordRefs"])) push(where + ".recordRefs", "type", "se espera lista");
    }
  }
  const provenance = body["provenance"];
  if (!Array.isArray(provenance) || provenance.length === 0) push("provenance", "missing", "procedencia ausente");
  else if (provenance.some(entry => record(entry)["service"] !== "finance")) {
    push("provenance", "unexpected", "procedencia ajena al propietario financiero");
  }
  if (!Array.isArray(body["references"])) push("references", "type", "se espera lista");
  const limitations = body["limitations"];
  if (!Array.isArray(limitations)) push("limitations", "type", "se espera lista");
  else if (!limitations.includes(FINANCIAL_LIMITATION_NO_PROFITABILITY)) {
    push("limitations", "missing", "falta la limitación de rentabilidad/saldo");
  }
  return violations.map(violation => violation.path + ":" + violation.problem);
}
