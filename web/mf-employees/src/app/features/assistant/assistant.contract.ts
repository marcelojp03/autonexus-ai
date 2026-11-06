/** CU25/CU26 contract: assistant answer, narrative report and its generation job through the BFF. */

export interface AssistantRecordReference {
  readonly kind: string;
  readonly id: string;
  readonly label: string | null;
}

export interface AssistantProvenance {
  readonly service: string;
  readonly resource: string;
  readonly tool: string | null;
  readonly observedAt: string | null;
}

export interface AssistantAnswer {
  readonly answer: string;
  readonly refused: boolean;
  readonly toolsUsed: readonly string[];
  readonly model: string;
  readonly generatedAt: string;
  readonly references: readonly AssistantRecordReference[];
  readonly provenance: readonly AssistantProvenance[];
  readonly limitations: readonly string[];
}

export interface OperationsStatusCount {
  readonly status: string;
  readonly count: number;
}

/** A figure the owner could not publish stays `null`: the interface never renders it as a zero. */
export interface OperationsWorkFigure {
  readonly orderNumber: string;
  readonly assignmentId: string | null;
  readonly executionStatus: string;
  readonly advances: number | null;
  readonly evidenceAvailable: number | null;
  readonly evidencePending: number | null;
  readonly evidenceFailed: number | null;
}

export interface OperationsFigures {
  readonly byStatus: readonly OperationsStatusCount[];
  readonly works: readonly OperationsWorkFigure[];
  /** Same population as `byStatus` and `works`; the server rejects a report where they disagree. */
  readonly totalWorks: number;
  readonly advances: number | null;
  readonly evidenceAvailable: number | null;
  readonly evidencePending: number | null;
  readonly evidenceFailed: number | null;
  readonly complete: boolean;
  readonly consultedExecutions: number;
  readonly failedExecutions: number;
}

/** A quantitative statement of the narrative, bound to the figure that produced it. */
export interface ReportClaim {
  readonly indicator: string;
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly period: { readonly from: string; readonly to: string };
  readonly source: string;
  readonly tool: string;
  readonly recordRefs: readonly AssistantRecordReference[];
}

export interface ReportFinancialDeclaration {
  readonly included: boolean;
  readonly note: string;
}

export interface OperationsReport {
  readonly period: { readonly from: string; readonly to: string; readonly timeZone: string };
  readonly generatedAt: string;
  /** `llm` when the local model wrote the text, `deterministic` when the template did. */
  readonly narrativePath: string;
  readonly model: string | null;
  readonly narrativeVerified: boolean;
  readonly promptVersion: string;
  readonly narrative: string;
  readonly figures: OperationsFigures;
  readonly claims: readonly ReportClaim[];
  readonly references: readonly AssistantRecordReference[];
  readonly provenance: readonly AssistantProvenance[];
  readonly limitations: readonly string[];
  readonly financialData: ReportFinancialDeclaration;
}

export type ReportJobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'INTERRUPTED';

export interface ReportJob {
  readonly jobId: string;
  readonly status: ReportJobStatus;
  readonly period: { readonly from: string; readonly to: string; readonly timeZone: string };
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly report: OperationsReport | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
}

/** The period report covers the whole workshop, so the BFF keeps it behind this permission. */
export const REPORT_PERMISSION = 'executions:read:team';

/** A prompt, not a document: the BFF rejects longer input before reaching the assistant. */
export const MAX_QUESTION = 2000;

/** How often the interface asks for the state of a job: short reads, never a new generation. */
export const JOB_POLL_INTERVAL_MS = 2000;

/** Where the open job is remembered so a reload resumes it instead of starting another run. */
export const JOB_STORAGE_KEY = 'anx.cu26.report.job';

export const ASSISTANT_ANSWER_FIELDS =
  'answer refused toolsUsed model generatedAt references { kind id label } provenance { service resource tool observedAt } limitations';

export const OPERATIONS_REPORT_FIELDS =
  'period { from to timeZone } generatedAt narrativePath model narrativeVerified promptVersion narrative ' +
  'figures { totalWorks byStatus { status count } works { orderNumber assignmentId executionStatus advances evidenceAvailable evidencePending evidenceFailed } ' +
  'advances evidenceAvailable evidencePending evidenceFailed complete consultedExecutions failedExecutions } ' +
  'claims { indicator label value unit period { from to } source tool recordRefs { kind id label } } ' +
  'references { kind id label } provenance { service resource tool observedAt } limitations ' +
  'financialData { included note }';

export const REPORT_JOB_FIELDS =
  'jobId status requestedAt startedAt finishedAt period { from to timeZone } failureCode failureMessage ' +
  'report { ' + OPERATIONS_REPORT_FIELDS + ' }';

/** True when the job will not change any more, so the interface can stop polling. */
export function jobIsTerminal(status: ReportJobStatus | null): boolean {
  return status === 'SUCCEEDED' || status === 'FAILED' || status === 'INTERRUPTED';
}

/** First and last day of the current month in the workshop time zone. */
export function currentMonth(now: Date = new Date()): { from: string; to: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const year = Number(values['year']);
  const month = Number(values['month']);
  const format = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { from: format(new Date(year, month - 1, 1)), to: format(new Date(year, month, 0)) };
}

/** Stable Spanish text per BFF code; never echoes server messages. */
export function assistantError(failure: { code?: string; statusCode?: number } | undefined): string {
  switch (failure?.code) {
    case 'FORBIDDEN':
      return 'Esta cuenta no tiene permiso para consultar el reporte del taller.';
    case 'UNAUTHENTICATED':
      return 'La sesión no es válida. Ingresá nuevamente desde el Shell.';
    case 'VALIDATION_ERROR':
      return 'La pregunta no es válida: revisá el texto y el período.';
    case 'SERVICE_UNAVAILABLE':
      return 'El asistente no está disponible o tardó demasiado. Reintentá en unos segundos.';
    default:
      return 'No se pudo completar la consulta al asistente.';
  }
}

/** What the pane says about a job that ended without a document. */
export function jobFailureText(job: Pick<ReportJob, 'status' | 'failureCode' | 'failureMessage'>): string {
  if (job.failureMessage && job.failureMessage.trim()) return job.failureMessage;
  if (job.status === 'INTERRUPTED') return 'El servicio se reinició durante la generación; el trabajo no puede reanudarse.';
  if (job.status === 'FAILED') return 'La generación del reporte no se completó.';
  return '';
}

const REQUIRED_FIGURES = 'Las cifras de este reporte no están completas: no se presentan ceros en lugar de datos ausentes.';

/** Labels the figures so a missing value is shown as such, never as a zero. */
export function figureText(value: number | null): string {
  return value === null ? 'sin dato' : String(value);
}

export function figuresComplete(figures: OperationsFigures): boolean {
  return figures.complete && figures.advances !== null;
}

export const FIGURES_INCOMPLETE_NOTE = REQUIRED_FIGURES;

/** The whole document as a downloadable JSON: the same object the interface rendered. */
export function reportAsJson(report: OperationsReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * The claims as CSV: one line per quantitative statement, with its indicator, value, period, source and
 * tool. A spreadsheet of the figures without the prose, which is what a reader can check.
 */
export function reportAsCsv(report: OperationsReport): string {
  const header = ['indicador', 'etiqueta', 'valor', 'unidad', 'desde', 'hasta', 'fuente', 'herramienta'];
  const escape = (value: string) => (/[",\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value);
  const lines = [header.join(',')];
  for (const claim of report.claims) {
    lines.push([claim.indicator, claim.label, String(claim.value), claim.unit,
      claim.period.from, claim.period.to, claim.source, claim.tool].map(escape).join(','));
  }
  return lines.join('\n') + '\n';
}
