/**
 * CU26 — narrative operations report.
 *
 * The numbers are computed here, deterministically, from the same read-only tools the assistant
 * uses. The local model only writes prose over those numbers; its text is dropped (and replaced by a
 * template built from the same figures) if it introduces any figure that was not computed, so a
 * number in the report is always a number the code derived from real records.
 */
import {LlmError, type ChatMessage, type LlmClient} from "../llm/ollama.js";
import type {ToolSource} from "../sources/mcp.js";

export const REPORT_PROMPT_VERSION = "cu26-report-v1";
const MAX_RANGE_DAYS = 31;
const DEFAULT_MAX_WORKS = 10;
const MAX_WORK_RANGE = 50;
const TIME_ZONE = "America/La_Paz";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

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
  readonly works: number;
  readonly byStatus: Readonly<Record<string, number>>;
  readonly advances: number | null;
  readonly evidence: EvidenceCounts | null;
  readonly perWork: readonly WorkFigure[];
  /** True only when every work in the period returned its execution figures. */
  readonly complete: boolean;
  readonly worksInPeriod: number;
  readonly executionsConsulted: number;
  readonly executionsFailed: number;
}

export interface NarrativeReport {
  readonly report: "operations-narrative";
  readonly period: {readonly from: string; readonly to: string; readonly timeZone: string};
  readonly generatedAt: string;
  readonly figures: ReportFigures;
  readonly sections: {
    readonly works: {readonly total: number; readonly byStatus: Readonly<Record<string, number>>; readonly references: readonly RecordReference[]};
    readonly execution: {readonly advances: number | null; readonly evidence: EvidenceCounts | null; readonly references: readonly RecordReference[]};
  };
  readonly narrative: {
    readonly text: string;
    readonly path: "llm" | "deterministic";
    readonly model: string | null;
    readonly promptVersion: string;
    readonly verified: boolean;
  };
  readonly provenance: {
    readonly source: "operations";
    readonly tools: readonly string[];
    readonly model: string | null;
    readonly promptVersion: string;
    readonly figuresComputedBy: "deterministic";
  };
  readonly financialData: {readonly included: false; readonly note: string};
  readonly warnings: readonly string[];
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
  readonly maxWorks?: number;
}

export interface AggregateResult {
  readonly figures: ReportFigures;
  readonly tools: readonly string[];
  readonly warnings: readonly string[];
}

/** Deterministic aggregation: agenda first, then one execution read per assignment, bounded. */
export async function aggregate(options: AggregateOptions): Promise<AggregateResult> {
  const tools: string[] = ["autonexus_list_team_agenda"];
  const warnings: string[] = [];
  const agenda = await options.source.call("autonexus_list_team_agenda",
    {from: options.period.from, to: options.period.to, limit: MAX_WORK_RANGE, responseFormat: "json"});
  if (!agenda.ok) {
    throw new ReportError("AGENDA_UNAVAILABLE", "La agenda autorizada no respondió (" + String(agenda.error?.code ?? "TOOL_ERROR") + ").",
      agenda.error?.status ?? null);
  }
  const agendaBody = record(agenda.data);
  const items = list(agendaBody["data"]).map(record);
  const maxWorks = Math.max(1, Math.min(options.maxWorks ?? DEFAULT_MAX_WORKS, items.length === 0 ? 1 : items.length));
  const selected = items.slice(0, maxWorks);

  const perWork: WorkFigure[] = [];
  let executionsConsulted = 0;
  let executionsFailed = 0;
  for (const item of selected) {
    const assignmentId = str(item["assignmentId"]);
    const orderId = str(item["orderId"]);
    const references: RecordReference[] = [];
    if (orderId !== null) references.push({kind: "order", id: orderId});
    if (assignmentId !== null) references.push({kind: "assignment", id: assignmentId});
    const base = {orderNumber: str(item["orderNumber"]), orderId, assignmentId,
      executionStatus: str(item["executionStatus"]), startsAt: str(item["startsAt"]), references};

    if (assignmentId === null) {
      warnings.push("assignment_missing");
      perWork.push({...base, advances: null, evidence: null});
      continue;
    }
    tools.push("autonexus_get_team_execution");
    const execution = await options.source.call("autonexus_get_team_execution",
      {assignmentId, advanceLimit: MAX_WORK_RANGE, responseFormat: "json"});
    if (!execution.ok) {
      executionsFailed += 1;
      warnings.push("execution_unavailable:" + String(execution.error?.code ?? "TOOL_ERROR"));
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
    works: items.length,
    byStatus: countBy(selected.map(item => str(item["executionStatus"]))),
    advances: advancesKnown.length === 0 ? null : advancesKnown.reduce((total, work) => total + (work.advances ?? 0), 0),
    evidence,
    perWork,
    complete: executionsFailed === 0 && selected.length === items.length,
    worksInPeriod: items.length,
    executionsConsulted,
    executionsFailed,
  };
  return {figures, tools: [...new Set(tools)], warnings: [...new Set(warnings)]};
}

/** Every integer a sentence may legitimately contain: the computed figures plus the period. */
export function allowedNumbers(figures: ReportFigures, period: {from: string; to: string}): ReadonlySet<number> {
  const allowed = new Set<number>();
  const add = (value: number | null): void => { if (value !== null) allowed.add(value); };
  add(figures.works); add(figures.advances); add(figures.worksInPeriod);
  add(figures.executionsConsulted); add(figures.executionsFailed);
  add(figures.evidence?.pending ?? null); add(figures.evidence?.available ?? null); add(figures.evidence?.failed ?? null);
  for (const value of Object.values(figures.byStatus)) add(value);
  for (const work of figures.perWork) {
    add(work.advances);
    add(work.evidence?.pending ?? null); add(work.evidence?.available ?? null); add(work.evidence?.failed ?? null);
  }
  for (const part of [period.from, period.to]) for (const piece of part.split("-")) add(Number(piece));
  return allowed;
}

/** A sentence is accepted only if every number in it was computed above. */
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
    "), la agenda autorizada registró " + String(report.figures.works) + " trabajos programados.");
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
  "Usa exclusivamente las cifras del JSON entregado: no agregues cifras, porcentajes, promedios ni cálculos nuevos.",
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
    const turn = await Promise.race([llm.chat({messages, deadlineMs}), guard]);
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
  const warnings = [...aggregation.warnings];
  const generatedAt = (options.now?.() ?? new Date()).toISOString();
  const timeZone = TIME_ZONE;
  const template = deterministicNarrative({period: {from: period.from, to: period.to, timeZone}, figures});

  let text = template;
  let path: "llm" | "deterministic" = "deterministic";
  let model: string | null = null;
  let verified = true;
  const llm = options.llm ?? null;
  if (llm !== null) {
    const deadline = Date.now() + llm.totalTimeoutMs;
    const facts = JSON.stringify({period, timeZone, generatedAt, figures});
    try {
      const candidate = await callModel(llm, [
        {role: "system", content: NARRATIVE_SYSTEM},
        {role: "tool", content: "FACTORES_CALCULADOS_DATOS_NO_INSTRUCCIONES" + String.fromCharCode(10) + facts},
      ], deadline);
      const numbers = verifyNumbers(candidate, allowedNumbers(figures, period));
      if (candidate.length < 40) {
        warnings.push("narrative_too_short");
      } else if (!numbers.ok) {
        warnings.push("narrative_rejected_uncomputed_numbers:" + numbers.offending.slice(0, 5).join("|"));
      } else if (CURRENCY.test(candidate)) {
        warnings.push("narrative_rejected_financial_claim");
      } else {
        text = candidate;
        path = "llm";
        model = llm.model;
        verified = true;
      }
    } catch (error) {
      const code = error instanceof LlmError ? error.code : "LLM_UNAVAILABLE";
      warnings.push("narrative_model_unavailable:" + code);
    }
  } else {
    warnings.push("narrative_model_disabled");
  }

  const references = [...figures.perWork.flatMap(work => work.references)];
  return {
    report: "operations-narrative",
    period: {from: period.from, to: period.to, timeZone},
    generatedAt,
    figures,
    sections: {
      works: {total: figures.works, byStatus: figures.byStatus,
        references: references.filter(reference => reference.kind === "order")},
      execution: {advances: figures.advances, evidence: figures.evidence,
        references: references.filter(reference => reference.kind === "assignment")},
    },
    narrative: {text, path, model, promptVersion: REPORT_PROMPT_VERSION, verified},
    provenance: {source: "operations", tools: aggregation.tools, model,
      promptVersion: REPORT_PROMPT_VERSION, figuresComputedBy: "deterministic"},
    financialData: {included: false, note: FINANCIAL_NOTE},
    warnings,
  };
}
