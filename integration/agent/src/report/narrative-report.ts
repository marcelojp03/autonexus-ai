/**
 * CU26 — narrative operations report.
 *
 * The numbers are computed here, deterministically, from the same read-only tools the assistant
 * uses. The local model only writes prose over those numbers; its text is dropped (and replaced by a
 * template built from the same figures) unless every figure in it is (a) a computed figure and
 * (b) attached to the indicator that figure belongs to. A number in the report is always a number
 * this code derived from real records, published next to the indicator, period and source that
 * produced it, so the reader can check the prose against the figures.
 */
import {LlmError, type ChatMessage, type LlmClient} from "../llm/ollama.js";
import type {ToolSource} from "../sources/mcp.js";

export const REPORT_PROMPT_VERSION = "cu26-report-v3";
const MAX_RANGE_DAYS = 31;
const MAX_WORK_RANGE = 50;
export const TIME_ZONE = "America/La_Paz";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A number is bound to the nearest indicator term inside this distance. */
const BIND_WINDOW = 60;
/** Quantities normally precede their noun ("7 avances"), so a preceding term must be closer. */
const PRECEDING_PENALTY = 25;
/** A term in another clause ("…, 1 pendiente") is not the indicator of this number. */
const CLAUSE_PENALTY = 25;
const CLAUSE_BREAK = /[,;:.!?()«»“”"]|\by\b/;
/** The period is checked as a period, not as a figure. */
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;

export class ReportError extends Error {
  readonly code: string;
  readonly status: number | null;
  constructor(code: string, message: string, status: number | null = null) {
    super(message);
    this.name = "ReportError";
    this.code = code;
    this.status = status;
  }
}

export type ReferenceKind = "order" | "assignment" | "execution";
export interface RecordReference {
  readonly kind: ReferenceKind;
  readonly id: string;
}

export interface EvidenceCounts {
  readonly pending: number;
  readonly available: number;
  readonly failed: number;
}

export interface WorkFigure {
  readonly orderNumber: string | null;
  readonly orderId: string | null;
  readonly assignmentId: string | null;
  readonly executionStatus: string | null;
  readonly startsAt: string | null;
  /** null when the owner did not return the execution: the figure is omitted, never estimated. */
  readonly advances: number | null;
  readonly evidence: EvidenceCounts | null;
  readonly references: readonly RecordReference[];
}

export interface ReportFigures {
  /** Works in the period and in the figure set: equals `byStatus` sum and `perWork` length. */
  readonly totalWorks: number;
  readonly byStatus: Readonly<Record<string, number>>;
  /** null only when no work returned its execution figures. */
  readonly advances: number | null;
  readonly evidence: EvidenceCounts | null;
  readonly perWork: readonly WorkFigure[];
  /** True only when every work in the period returned its execution figures. */
  readonly complete: boolean;
  readonly executionsConsulted: number;
  readonly executionsFailed: number;
}

/**
 * One quantitative statement of the report, bound to the indicator it belongs to. The prose is only
 * published when each of its numbers matches the value of the indicator named next to it.
 */
export interface ReportClaim {
  /** Stable indicator id: `works.total`, `works.byStatus.<status>`, `execution.advances`, … */
  readonly indicator: string;
  /** Indicator as it reads in the prose. */
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly period: {readonly from: string; readonly to: string};
  readonly source: "operations";
  /** Closed tool of the catalogue that produced the figure. */
  readonly tool: string;
  readonly recordRefs: readonly RecordReference[];
}

/** Owner read that produced a figure, published as provenance. */
export interface SourceProvenance {
  readonly service: "operations";
  readonly resource: string;
  readonly tool: string;
  readonly observedAt: string | null;
}

export interface NarrativeReport {
  readonly report: "operations-narrative";
  readonly period: {readonly from: string; readonly to: string; readonly timeZone: string};
  readonly generatedAt: string;
  readonly promptVersion: string;
  readonly figures: ReportFigures;
  readonly claims: readonly ReportClaim[];
  readonly narrative: {
    readonly text: string;
    readonly path: "llm" | "deterministic";
    readonly model: string | null;
    readonly verified: boolean;
    /** False for the template: prose built from the computed figures is not generative evidence. */
    readonly generative: boolean;
  };
  readonly references: readonly RecordReference[];
  readonly provenance: readonly SourceProvenance[];
  readonly financialData: {readonly included: false; readonly note: string};
  readonly limitations: readonly string[];
}

const record = (value: unknown): Record<string, unknown> =>
  (value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
const int = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null);

const validDate = (value: unknown): string | null => {
  if (typeof value !== "string" || !DATE.test(value)) return null;
  const time = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? value : null;
};

export function validatePeriod(from: unknown, to: unknown): {from: string; to: string} {
  const start = validDate(from), end = validDate(to);
  if (start === null || end === null) throw new ReportError("INVALID_PERIOD", "El período requiere fechas AAAA-MM-DD válidas.", 400);
  if (start > end) throw new ReportError("INVALID_PERIOD", "El período está invertido.", 400);
  const days = (Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86_400_000 + 1;
  if (days > MAX_RANGE_DAYS) throw new ReportError("INVALID_PERIOD", "El período no puede superar " + String(MAX_RANGE_DAYS) + " días.", 400);
  return {from: start, to: end};
}

function evidenceOf(value: unknown): EvidenceCounts | null {
  const body = record(value);
  const pending = int(body["pending"]), available = int(body["available"]), failed = int(body["failed"]);
  if (pending === null || available === null || failed === null) return null;
  return {pending, available, failed};
}

function countBy(values: readonly (string | null)[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    if (value === null) continue;
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

export interface AggregateOptions {
  readonly period: {readonly from: string; readonly to: string};
  readonly source: ToolSource;
  /** Hard bound on the works the report itemises; exceeding it fails closed instead of sampling. */
  readonly maxWorks?: number;
}

export interface AggregateResult {
  readonly figures: ReportFigures;
  readonly tools: readonly string[];
  readonly limitations: readonly string[];
  readonly provenance: readonly SourceProvenance[];
}

/**
 * Deterministic aggregation: agenda first, then one execution read per assignment. Every work of the
 * period is itemised: a partial figure set would publish a total the reader cannot check.
 */
export async function aggregate(options: AggregateOptions): Promise<AggregateResult> {
  const tools: string[] = ["autonexus_list_team_agenda"];
  const limitations: string[] = [];
  const agenda = await options.source.call("autonexus_list_team_agenda",
    {from: options.period.from, to: options.period.to, limit: MAX_WORK_RANGE, responseFormat: "json"});
  if (!agenda.ok) {
    throw new ReportError("AGENDA_UNAVAILABLE", "La agenda autorizada no respondió (" + String(agenda.error?.code ?? "TOOL_ERROR") + ").",
      agenda.error?.status ?? null);
  }
  const agendaBody = record(agenda.data);
  const agendaPage = record(agendaBody["page"]);
  const observedAgenda = str(agendaBody["observedAt"]);
  const items = list(agendaBody["data"]).map(record);
  const reported = int(agendaPage["total"]);
  if (reported !== null && reported !== items.length) {
    throw new ReportError("AGENDA_INCOMPLETE",
      "La agenda informó " + String(reported) + " trabajos y devolvió " + String(items.length) +
      ": el reporte no publica un total parcial.", null);
  }
  const bound = Math.max(1, options.maxWorks ?? MAX_WORK_RANGE);
  if (items.length > bound) {
    throw new ReportError("FIGURE_RANGE_EXCEEDED",
      "El período tiene " + String(items.length) + " trabajos y el límite de detalle es " + String(bound) + ".", 400);
  }

  const perWork: WorkFigure[] = [];
  let executionsConsulted = 0;
  let executionsFailed = 0;
  for (const item of items) {
    const assignmentId = str(item["assignmentId"]);
    const orderId = str(item["orderId"]);
    const references: RecordReference[] = [];
    if (orderId !== null) references.push({kind: "order", id: orderId});
    if (assignmentId !== null) references.push({kind: "assignment", id: assignmentId});
    const base = {orderNumber: str(item["orderNumber"]), orderId, assignmentId,
      executionStatus: str(item["executionStatus"]), startsAt: str(item["startsAt"]), references};

    if (assignmentId === null) {
      limitations.push("assignment_missing");
      perWork.push({...base, advances: null, evidence: null});
      continue;
    }
    tools.push("autonexus_get_team_execution");
    const execution = await options.source.call("autonexus_get_team_execution",
      {assignmentId, advanceLimit: MAX_WORK_RANGE, responseFormat: "json"});
    if (!execution.ok) {
      if (execution.error?.status === 401 || execution.error?.status === 403
        || execution.error?.code === "OWNER_UNAUTHORIZED" || execution.error?.code === "OWNER_FORBIDDEN") {
        throw new ReportError(execution.error?.code ?? "EXECUTION_ACCESS_DENIED",
          "El propietario rechazó la autorización de ejecución.",
          execution.error?.status === 401 || execution.error?.code === "OWNER_UNAUTHORIZED" ? 401 : 403);
      }
      executionsFailed += 1;
      limitations.push("execution_unavailable:" + String(execution.error?.code ?? "TOOL_ERROR"));
      perWork.push({...base, advances: null, evidence: null});
      continue;
    }
    executionsConsulted += 1;
    const body = record(execution.data);
    const page = record(body["page"]);
    const executionRecord = record(body["data"]);
    const advances = int(page["total"]) ?? int(list(executionRecord["advances"]).length);
    perWork.push({...base, advances, evidence: evidenceOf(executionRecord["evidenceSummary"])});
  }

  const advancesKnown = perWork.filter(work => work.advances !== null);
  const evidenceKnown = perWork.filter(work => work.evidence !== null);
  const evidence: EvidenceCounts | null = evidenceKnown.length === 0 ? null : {
    pending: evidenceKnown.reduce((total, work) => total + (work.evidence?.pending ?? 0), 0),
    available: evidenceKnown.reduce((total, work) => total + (work.evidence?.available ?? 0), 0),
    failed: evidenceKnown.reduce((total, work) => total + (work.evidence?.failed ?? 0), 0),
  };

  const figures: ReportFigures = {
    totalWorks: items.length,
    byStatus: countBy(perWork.map(work => work.executionStatus)),
    advances: advancesKnown.length === 0 ? null : advancesKnown.reduce((total, work) => total + (work.advances ?? 0), 0),
    evidence,
    perWork,
    complete: executionsFailed === 0,
    executionsConsulted,
    executionsFailed,
  };
  assertCoherentFigures(figures);

  const provenance: SourceProvenance[] = [
    {service: "operations", resource: "/agenda/team", tool: "autonexus_list_team_agenda", observedAt: observedAgenda},
  ];
  if (executionsConsulted > 0) {
    provenance.push({service: "operations", resource: "/executions/team/{assignmentId}",
      tool: "autonexus_get_team_execution", observedAt: null});
  }
  return {figures, tools: [...new Set(tools)], limitations: [...new Set(limitations)], provenance};
}

/**
 * The three totals the report publishes must be the same set of works. A mismatch means the figures
 * describe different populations, so the report fails closed instead of publishing a total the rest
 * of the document contradicts (and never fills the gap with a zero).
 */
export function assertCoherentFigures(figures: ReportFigures): void {
  const statusSum = Object.values(figures.byStatus).reduce((total, count) => total + count, 0);
  const reasons: string[] = [];
  if (statusSum !== figures.totalWorks) reasons.push("byStatus=" + String(statusSum) + " totalWorks=" + String(figures.totalWorks));
  if (figures.perWork.length !== figures.totalWorks) reasons.push("perWork=" + String(figures.perWork.length) + " totalWorks=" + String(figures.totalWorks));
  const unclassified = figures.perWork.filter(work => work.executionStatus === null).length;
  if (unclassified > 0) reasons.push("works_without_status=" + String(unclassified));
  const unidentified = figures.perWork.filter(work => work.orderNumber === null).length;
  if (unidentified > 0) reasons.push("works_without_order_number=" + String(unidentified));
  if (reasons.length > 0) {
    throw new ReportError("INCOHERENT_FIGURES",
      "Las cifras del reporte no son coherentes (" + reasons.join("; ") + "): se rechaza el reporte en lugar de rellenar ceros.", null);
  }
}

interface ClaimPattern extends ReportClaim {
  readonly terms: readonly RegExp[];
}

const escapeTerm = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The raw status published by Operations, tolerant to the separator and to a Spanish rendering. */
const statusTerms = (status: string): RegExp[] => {
  const terms = [new RegExp("\\b" + escapeTerm(status).replace(/_/g, "[ _]") + "\\b", "gi")];
  const aliases = STATUS_ALIASES[status] ?? [];
  for (const alias of aliases) terms.push(new RegExp("\\b" + escapeTerm(alias), "gi"));
  return terms;
};
const STATUS_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  not_started: ["sin iniciar", "no iniciad", "sin empezar"],
  in_progress: ["en ejecución", "en ejecucion", "en progreso", "en curso", "en marcha"],
  confirmed: ["confirmad"],
  completed: ["completad", "finalizad", "terminad"],
  cancelled: ["cancelad", "anulad"],
  pending_verification: ["pendiente de verificación", "pendientes de verificación", "por verificar"],
});

const referencesOf = (works: readonly WorkFigure[]): RecordReference[] => works.flatMap(work => work.references);

/** Every figure of the report as a claim, with the prose terms that name its indicator. */
export function claimPatterns(figures: ReportFigures, period: {from: string; to: string}): ClaimPattern[] {
  const patterns: ClaimPattern[] = [];
  const push = (claim: Omit<ClaimPattern, "period" | "source" | "terms">, terms: readonly RegExp[]): void => {
    patterns.push({...claim, period: {from: period.from, to: period.to}, source: "operations", terms});
  };
  push({indicator: "works.total", label: "trabajos programados", value: figures.totalWorks, unit: "trabajos",
    tool: "autonexus_list_team_agenda", recordRefs: referencesOf(figures.perWork)}, [/\btrabajos?\b/gi, /\bprogramad[oa]s?\b/gi]);
  for (const [status, count] of Object.entries(figures.byStatus)) {
    push({indicator: "works.byStatus." + status, label: "trabajos en " + status, value: count, unit: "trabajos",
      tool: "autonexus_list_team_agenda",
      recordRefs: referencesOf(figures.perWork.filter(work => work.executionStatus === status))}, statusTerms(status));
  }
  const executionRefs = referencesOf(figures.perWork.filter(work => work.assignmentId !== null));
  if (figures.advances !== null) {
    push({indicator: "execution.advances",
      label: figures.complete ? "avances" : "avances en las ejecuciones consultadas",
      value: figures.advances, unit: "avances", tool: "autonexus_get_team_execution", recordRefs: executionRefs},
      [/\bavances?\b/gi, /\bprogresos?\b/gi]);
  }
  if (figures.evidence !== null) {
    const evidenceClaim = (state: string, label: string, value: number, term: RegExp): void => {
      push({indicator: "evidence." + state, label, value, unit: "evidencias",
        tool: "autonexus_get_team_execution", recordRefs: executionRefs}, [term]);
    };
    evidenceClaim("available", "evidencias disponibles", figures.evidence.available, /\bdisponibles?\b/gi);
    evidenceClaim("pending", "evidencias pendientes", figures.evidence.pending, /\bpendientes?\b/gi);
    // "fallidas" and the verb form the prompt invites ("4 evidencias fallaron") both name the figure:
    // without the verb form the figure binds to the previous indicator and the paragraph is rejected.
    evidenceClaim("failed", "evidencias fallidas", figures.evidence.failed, /\bfallid[ao]s?\b|\bfall(?:aron|an|ó|o)\b/gi);
  }
  push({indicator: "executions.consulted", label: "ejecuciones consultadas", value: figures.executionsConsulted,
    unit: "ejecuciones", tool: "autonexus_get_team_execution", recordRefs: executionRefs},
    // "ejecuciones consultadas" and the verb form the prose uses ("se consultaron 2 ejecuciones") both
    // name the figure; without the verb the number stayed unbound and the paragraph was rejected.
    [/\bejecuciones? consultadas?\b/gi, /\bconsultad[oa]s?\b/gi, /\bconsult(?:aron|an|ó|o)\b/gi]);
  push({indicator: "executions.failed", label: "ejecuciones con error", value: figures.executionsFailed,
    unit: "ejecuciones", tool: "autonexus_get_team_execution", recordRefs: executionRefs},
    [/\bcon error\b/gi, /\bejecuciones? fallidas?\b/gi]);
  return patterns;
}

export interface ClaimBinding {
  readonly ok: boolean;
  readonly problems: readonly string[];
  readonly indicators: readonly string[];
}

const published = (pattern: ClaimPattern): ReportClaim => ({
  indicator: pattern.indicator, label: pattern.label, value: pattern.value, unit: pattern.unit,
  period: pattern.period, source: pattern.source, tool: pattern.tool, recordRefs: pattern.recordRefs,
});

/**
 * Binds every number of the prose to the indicator named next to it. A number that matches a
 * computed figure but is attached to another indicator ("7 avances" written as "7 trabajos") is a
 * wrong claim even when the integer was computed, so it is rejected.
 */
export function verifyClaimBinding(text: string, patterns: readonly ClaimPattern[]): ClaimBinding {
  const cleaned = text.replace(ISO_DATE, " ");
  const problems: string[] = [];
  const indicators: string[] = [];
  const occurrences: Array<{start: number; end: number; pattern: ClaimPattern}> = [];
  for (const pattern of patterns) {
    for (const term of pattern.terms) {
      term.lastIndex = 0;
      for (const match of cleaned.matchAll(term)) {
        if (typeof match.index !== "number" || match[0].length === 0) continue;
        occurrences.push({start: match.index, end: match.index + match[0].length, pattern});
      }
    }
  }
  for (const match of cleaned.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const literal = match[0];
    if (cleaned.slice(end, end + 1) === "%") { problems.push("figure_percentage:" + literal); continue; }
    const value = Number(literal.split(/[.,]/)[0]);
    const scored = occurrences
      .map(occurrence => {
        const following = occurrence.start >= end;
        const gap = following ? cleaned.slice(end, occurrence.start) : cleaned.slice(occurrence.end, start);
        const distance = following ? occurrence.start - end : Math.max(0, start - occurrence.end) + PRECEDING_PENALTY;
        return {pattern: occurrence.pattern, score: distance + (CLAUSE_BREAK.test(gap) ? CLAUSE_PENALTY : 0)};
      })
      .filter(candidate => candidate.score <= BIND_WINDOW);
    if (scored.length === 0) { problems.push("figure_without_indicator:" + literal); continue; }
    const best = Math.min(...scored.map(candidate => candidate.score));
    const nearest = scored.filter(candidate => candidate.score <= best + 6);
    const matched = nearest.find(candidate => candidate.pattern.value === value);
    if (!matched) {
      const named = [...new Set(nearest.map(candidate => candidate.pattern.indicator + "=" + String(candidate.pattern.value)))];
      problems.push("figure_bound_to_wrong_indicator:" + literal + "[" + named.join("|") + "]");
      continue;
    }
    if (!indicators.includes(matched.pattern.indicator)) indicators.push(matched.pattern.indicator);
  }
  return {ok: problems.length === 0, problems, indicators};
}

/** Every integer a sentence may legitimately contain: the computed figures plus the period. */
export function allowedNumbers(figures: ReportFigures, period: {from: string; to: string}): ReadonlySet<number> {
  const allowed = new Set<number>();
  const add = (value: number | null): void => { if (value !== null) allowed.add(value); };
  add(figures.totalWorks); add(figures.advances); add(figures.executionsConsulted); add(figures.executionsFailed);
  add(figures.evidence?.pending ?? null); add(figures.evidence?.available ?? null); add(figures.evidence?.failed ?? null);
  for (const value of Object.values(figures.byStatus)) add(value);
  for (const work of figures.perWork) {
    add(work.advances);
    add(work.evidence?.pending ?? null); add(work.evidence?.available ?? null); add(work.evidence?.failed ?? null);
  }
  for (const part of [period.from, period.to]) for (const piece of part.split("-")) add(Number(piece));
  return allowed;
}

/** Coarse check kept next to the binding: a number that no computation produced is not publishable. */
export function verifyNumbers(text: string, allowed: ReadonlySet<number>): {ok: boolean; offending: readonly string[]} {
  const offending: string[] = [];
  for (const match of text.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const integer = Number(match[0].split(/[.,]/)[0]);
    if (!allowed.has(integer)) offending.push(match[0]);
  }
  return {ok: offending.length === 0, offending};
}

const CURRENCY = /\$|\bBs\.?\b|\bUSD\b|\bbolivianos?\b|\bimportes?\b/i;
const FINANCIAL_NOTE = "Este reporte no incluye datos financieros: el alcance de solo lectura no expone importes, tarifas ni cotizaciones, y no se estiman.";

function statusSentence(figures: ReportFigures): string {
  const entries = Object.entries(figures.byStatus).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  if (entries.length === 0) return "No hubo trabajos con estado registrado en el período.";
  return "Por estado de ejecución: " + entries.map(([status, count]) => String(count) + " en " + status).join(", ") + ".";
}

/** Template used as-is when the model is unavailable or writes a figure that was not computed. */
export function deterministicNarrative(report: {period: {from: string; to: string; timeZone: string}; figures: ReportFigures}): string {
  const lines: string[] = [];
  lines.push("Entre el " + report.period.from + " y el " + report.period.to + " (" + report.period.timeZone +
    "), la agenda autorizada registró " + String(report.figures.totalWorks) + " trabajos programados.");
  lines.push(statusSentence(report.figures));
  const advances = report.figures.advances;
  const evidence = report.figures.evidence;
  if (advances !== null) {
    lines.push("Se contabilizaron " + String(advances) + " avances de ejecución en " + String(report.figures.executionsConsulted) + " ejecuciones consultadas.");
  }
  if (evidence !== null) {
    lines.push("Evidencias: " + String(evidence.available) + " disponibles, " + String(evidence.pending) + " pendientes y " +
      String(evidence.failed) + " fallidas.");
  }
  if (!report.figures.complete) {
    lines.push("Algunas ejecuciones no devolvieron sus cifras (" + String(report.figures.executionsFailed) +
      " con error), por lo que esos totales se omiten en lugar de estimarse.");
  }
  lines.push(FINANCIAL_NOTE);
  return lines.join(" ");
}

const NARRATIVE_SYSTEM = [
  "Redactas el resumen narrativo de un reporte de taller.",
  "OBLIGATORIO: escribe cada cifra con dígitos, por ejemplo 2 trabajos, 32 avances, 20 evidencias disponibles. Nunca escribas cifras con palabras.",
  "Nombra el indicador junto a la cifra: trabajos programados, trabajos en <estado>, avances, evidencias disponibles, evidencias pendientes, evidencias fallidas, ejecuciones consultadas.",
  "Usa exclusivamente las cifras del JSON entregado: no agregues cifras, porcentajes, promedios ni cálculos nuevos.",
  "Cada cifra debe ir junto al indicador al que pertenece: no atribuyas un total a otro concepto.",
  "No menciones fechas ni el período: el reporte ya lo muestra aparte.",
  "No menciones dinero, importes, tarifas, cotizaciones ni facturación.",
  "Si un dato viene en null, no lo menciones ni lo estimes.",
  "Escribe en español, en un solo párrafo de 60 a 120 palabras, sin listas y sin inventar causas.",
].join("\n");

async function callModel(llm: LlmClient, messages: readonly ChatMessage[], deadlineMs: number): Promise<string> {
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) throw new LlmError("LLM_TIMEOUT", "The report deadline elapsed.");
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new LlmError("LLM_TIMEOUT", "The report deadline elapsed.")), remaining);
  });
  try {
    // The trace is off for this task: the paragraph is verified against the figures anyway, and with the
    // trace on the model spent the whole token budget reasoning and returned no text.
    const turn = await Promise.race([llm.chat({messages, deadlineMs, think: false}), guard]);
    return turn.content.trim();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface NarrativeReportOptions extends AggregateOptions {
  readonly llm?: LlmClient | null;
  readonly now?: () => Date;
  readonly maxWorks?: number;
}

export async function buildNarrativeReport(options: NarrativeReportOptions): Promise<NarrativeReport> {
  const period = validatePeriod(options.period.from, options.period.to);
  const aggregation = await aggregate({period, source: options.source, ...(options.maxWorks === undefined ? {} : {maxWorks: options.maxWorks})});
  const figures = aggregation.figures;
  const limitations = [...aggregation.limitations];
  const generatedAt = (options.now?.() ?? new Date()).toISOString();
  const timeZone = TIME_ZONE;
  const patterns = claimPatterns(figures, period);
  const allowed = allowedNumbers(figures, period);
  const template = deterministicNarrative({period: {from: period.from, to: period.to, timeZone}, figures});
  const templateBinding = verifyClaimBinding(template, patterns);
  const templateNumbers = verifyNumbers(template, allowed);
  if (!templateBinding.ok || !templateNumbers.ok) {
    // The template is generated from the claims, so a mismatch is a defect in this service.
    limitations.push("narrative_template_unverified:" + [...templateBinding.problems, ...templateNumbers.offending].slice(0, 5).join("|"));
  }

  let text = template;
  let path: "llm" | "deterministic" = "deterministic";
  let model: string | null = null;
  let binding: ClaimBinding = templateBinding;
  const llm = options.llm ?? null;
  if (llm !== null) {
    const deadline = Date.now() + llm.totalTimeoutMs;
    const facts = JSON.stringify({period, timeZone, generatedAt,
      claims: patterns.map(claim => ({indicator: claim.indicator, label: claim.label, value: claim.value, unit: claim.unit}))});
    try {
      const candidate = await callModel(llm, [
        {role: "system", content: NARRATIVE_SYSTEM},
        {role: "tool", content: "FACTORES_CALCULADOS_DATOS_NO_INSTRUCCIONES" + String.fromCharCode(10) + facts},
      ], deadline);
      const numbers = verifyNumbers(candidate, allowed);
      const candidateBinding = verifyClaimBinding(candidate, patterns);
      if (process.env["CU26_LOG_CANDIDATE"] === "1") {
        // Operator aid: the paragraph is the report's own text, never a token or a private record.
        process.stderr.write(JSON.stringify({at: new Date().toISOString(), outcome: "narrative-candidate",
          length: candidate.length, binding: candidateBinding.problems.slice(0, 5),
          indicators: candidateBinding.indicators, candidate}) + String.fromCharCode(10));
      }
      if (candidate.length < 40) {
        limitations.push("narrative_too_short");
      } else if (!numbers.ok) {
        limitations.push("narrative_rejected_uncomputed_numbers:" + numbers.offending.slice(0, 5).join("|"));
      } else if (CURRENCY.test(candidate)) {
        limitations.push("narrative_rejected_financial_claim");
      } else if (!candidateBinding.ok) {
        limitations.push("narrative_rejected_claim_binding:" + candidateBinding.problems.slice(0, 5).join("|"));
      } else if (figures.totalWorks > 0 && !candidateBinding.indicators.includes("works.total")) {
        // A paragraph that names no computed figure cannot be checked against the report: it may be
        // true prose, but it is not evidence of the figures, so the deterministic text is published.
        limitations.push("narrative_rejected_missing_total");
      } else {
        text = candidate;
        path = "llm";
        model = llm.model;
        binding = candidateBinding;
      }
    } catch (error) {
      const code = error instanceof LlmError ? error.code : "LLM_UNAVAILABLE";
      limitations.push("narrative_model_unavailable:" + code);
    }
  } else {
    limitations.push("narrative_model_disabled");
  }

  const asserted = new Set(binding.indicators);
  const claims = patterns.filter(pattern => asserted.has(pattern.indicator)).map(published);
  const references = figures.perWork.flatMap(work => work.references);
  return {
    report: "operations-narrative",
    period: {from: period.from, to: period.to, timeZone},
    generatedAt,
    promptVersion: REPORT_PROMPT_VERSION,
    figures,
    claims,
    narrative: {text, path, model, verified: binding.ok && templateNumbers.ok,
      generative: path === "llm"},
    references,
    provenance: aggregation.provenance,
    financialData: {included: false, note: FINANCIAL_NOTE},
    limitations,
  };
}
