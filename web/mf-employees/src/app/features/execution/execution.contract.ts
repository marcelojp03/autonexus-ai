/** CU16 web contract: the mechanic records progress and evidence for an assigned, confirmed work. */
export type EvidenceState = 'pending' | 'available' | 'failed';
export type ExecutionStatus = 'in_progress';

export interface ExecutionEvidence {
  readonly id: string;
  readonly advanceId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly state: EvidenceState;
  readonly attempt: number;
  readonly failureCode: string | null;
  readonly createdAt: string;
  readonly confirmedAt: string | null;
  readonly version: number;
}

export interface ExecutionAdvance {
  readonly id: string;
  readonly sequence: number;
  readonly description: string;
  readonly minutesWorked: number;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly version: number;
  readonly evidences: readonly ExecutionEvidence[];
}

export interface Execution {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly assignmentId: string;
  readonly employeeId: string;
  readonly status: ExecutionStatus;
  readonly startedAt: string;
  readonly version: number;
  readonly advances: readonly ExecutionAdvance[];
  readonly evidenceSummary: { readonly pending: number; readonly available: number; readonly failed: number };
}

export interface AgendaWorkRef {
  readonly assignmentId: string;
  readonly orderNumber: string;
  readonly employee: { readonly id: string; readonly status: 'active' | 'inactive' };
  readonly startsAt: string;
  readonly status: string;
  readonly executionStatus: 'not_started' | 'in_progress';
  readonly executionProgress: { readonly advances: number; readonly lastAdvanceAt: string | null; readonly availableEvidence: number };
  readonly vehicle: { readonly plate: string; readonly make: string; readonly model: string };
}

export function mayWriteExecution(
  work: AgendaWorkRef | null,
  actorEmployeeId: string | null,
  hasPermission: boolean,
): boolean {
  return hasPermission && !!work && work.employee.status === 'active' && work.employee.id === actorEmployeeId;
}

export const EXECUTION_FIELDS =
  'orderId orderNumber assignmentId employeeId status startedAt version evidenceSummary { pending available failed } advances { id sequence description minutesWorked occurredAt recordedAt version evidences { id advanceId fileName contentType sizeBytes state attempt failureCode createdAt confirmedAt version } }';

export const AGENDA_FIELDS =
  'assignmentId orderNumber startsAt status executionStatus executionProgress { advances lastAdvanceAt availableEvidence } employee { id status } vehicle { plate make model }';

/** Closed limits mirrored from the owner contract; the server still validates everything. */
export const EVIDENCE_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  'image/jpeg': 5 * 1024 * 1024,
  'image/png': 5 * 1024 * 1024,
  'image/webp': 5 * 1024 * 1024,
  'video/mp4': 20 * 1024 * 1024,
});

export function evidenceType(file: { type: string }): string | null {
  const type = file.type.trim().toLowerCase();
  return EVIDENCE_LIMITS[type] === undefined ? null : type;
}

export function evidenceSizeAllowed(size: number, type: string): boolean {
  const limit = EVIDENCE_LIMITS[type];
  return limit !== undefined && size > 0 && size <= limit;
}

/** Stable Spanish text per code; never echoes a server message or a signed URL. */
export function executionError(failure: { code?: string; statusCode?: number } | undefined): string {
  switch (failure?.code) {
    case 'FORBIDDEN':
    case 'EXECUTION_ACCESS_DENIED':
      return 'Esta cuenta no está asignada a este trabajo.';
    case 'EXECUTION_WORK_NOT_FOUND':
      return 'El trabajo o la evidencia no están disponibles para esta cuenta.';
    case 'EXECUTION_ALREADY_STARTED':
      return 'La ejecución de este trabajo ya fue iniciada.';
    case 'EXECUTION_NOT_STARTED':
      return 'Primero iniciá la ejecución del trabajo.';
    case 'VERSION_CONFLICT':
      return 'Otro cambio actualizó la ejecución. Recargá y reintentá.';
    case 'IDEMPOTENCY_CONFLICT':
      return 'La operación ya se usó con otro contenido.';
    case 'EVIDENCE_STATE_CONFLICT':
      return 'La evidencia no está en un estado que permita esta operación.';
    case 'EVIDENCE_ATTEMPTS_EXHAUSTED':
      return 'La evidencia agotó sus intentos de carga; registrá una nueva.';
    case 'EVIDENCE_STORAGE_UNAVAILABLE':
      return 'El almacenamiento privado de evidencias no está configurado. El avance se conserva, pero no se creó una evidencia ni se inició su carga.';
    case 'VALIDATION_ERROR':
      return 'Revisá los datos: descripción, minutos y archivo permitido.';
    default:
      return 'No se pudo completar la operación de ejecución.';
  }
}

export function canUpload(type: string | null, size: number): boolean {
  return type !== null && evidenceSizeAllowed(size, type);
}
