/** CU17 jefatura contract: pending verification, decisions and workshop history. */
export interface PendingWork {
  readonly assignmentId: string;
  readonly orderNumber: string;
  readonly executionStatus: 'not_started' | 'in_progress' | 'pending_verification' | 'completed';
  readonly vehicle: { readonly plate: string; readonly make: string; readonly model: string };
  readonly employee: { readonly id: string; readonly fullName: string };
}

export interface ChecklistActivity {
  readonly id: string;
  readonly description: string;
  readonly quantity: number;
  readonly state: 'pending' | 'done';
  readonly doneBy: string | null;
}

export interface ReviewEntry {
  readonly action: 'requested' | 'approved' | 'returned';
  readonly actor: string;
  readonly reason: string | null;
  readonly occurredAt: string;
}

export interface Verification {
  readonly execution: { readonly status: string; readonly version: number; readonly startedAt: string };
  readonly checklist: readonly ChecklistActivity[];
  readonly reviews: readonly ReviewEntry[];
  readonly mandatoryPending: number;
  readonly availableEvidence: number;
}

export const PENDING_FIELDS =
  'assignmentId orderNumber executionStatus employee { id fullName } vehicle { plate make model }';

export const VERIFICATION_FIELDS =
  'execution { status version startedAt } mandatoryPending availableEvidence checklist { id description quantity state doneBy } reviews { action actor reason occurredAt }';

/** Stable Spanish text per code; never echoes server messages. */
export function verificationError(failure: { code?: string; statusCode?: number } | undefined): string {
  switch (failure?.code) {
    case 'FORBIDDEN':
    case 'EXECUTION_ACCESS_DENIED':
      return 'Esta cuenta no puede verificar este trabajo.';
    case 'SELF_VERIFICATION_FORBIDDEN':
      return 'No podés aprobar ni devolver tu propio trabajo.';
    case 'EXECUTION_WORK_NOT_FOUND':
      return 'El trabajo no está disponible para esta cuenta.';
    case 'CHECKLIST_INCOMPLETE':
      return 'Todavía hay actividades obligatorias sin realizar.';
    case 'EVIDENCE_REQUIRED':
      return 'El trabajo necesita al menos un avance y una evidencia disponible.';
    case 'VERSION_CONFLICT':
      return 'Otro cambio actualizó el trabajo. Recargá y reintentá.';
    case 'EXECUTION_STATE_CONFLICT':
      return 'El trabajo no está en un estado que permita esa decisión.';
    case 'VALIDATION_ERROR':
      return 'Revisá los datos: el motivo debe tener entre 3 y 500 caracteres.';
    default:
      return 'No se pudo completar la verificación.';
  }
}
