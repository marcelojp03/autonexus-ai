/** CU25/CU26 contract: assistant answer and narrative report through the BFF GraphQL surface. */

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

export interface OperationsWorkFigure {
  readonly orderNumber: string;
  readonly assignmentId: string | null;
  readonly executionStatus: string;
  readonly advances: number;
  readonly evidenceAvailable: number;
  readonly evidencePending: number;
  readonly evidenceFailed: number;
}

export interface OperationsFigures {
  readonly byStatus: readonly OperationsStatusCount[];
  readonly works: readonly OperationsWorkFigure[];
  readonly totalWorks: number;
}

export interface OperationsReport {
  readonly period: { readonly from: string; readonly to: string };
  readonly generatedAt: string;
  readonly model: string;
  readonly narrative: string;
  readonly figures: OperationsFigures;
  readonly references: readonly AssistantRecordReference[];
  readonly provenance: readonly AssistantProvenance[];
  readonly limitations: readonly string[];
}

/** The period report covers the whole workshop, so the BFF keeps it behind this permission. */
export const REPORT_PERMISSION = 'executions:read:team';

/** A prompt, not a document: the BFF rejects longer input before reaching the assistant. */
export const MAX_QUESTION = 2000;

export const ASSISTANT_ANSWER_FIELDS =
  'answer refused toolsUsed model generatedAt references { kind id label } provenance { service resource tool observedAt } limitations';

export const OPERATIONS_REPORT_FIELDS =
  'period { from to } generatedAt model narrative figures { totalWorks byStatus { status count } works { orderNumber assignmentId executionStatus advances evidenceAvailable evidencePending evidenceFailed } } references { kind id label } provenance { service resource tool observedAt } limitations';

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
