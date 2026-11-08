/** Business failure propagated from the Employees REST API with a stable, public code. */
export class BusinessError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'BusinessError';
  }
}

const MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  COLLECTION_CONTEXT_UNAVAILABLE: 'No se puede verificar la obligación de cobro en este momento.',
  OBLIGATION_NOT_FOUND: 'No hay una obligación de cobro disponible para esta orden.',
  ORDER_NOT_FINALIZED: 'La orden todavía no admite cobro.',
  OBLIGATION_MISMATCH: 'No se pudo verificar la obligación pactada de la orden.',
  BALANCE_INCONSISTENT: 'El saldo requiere revisión antes de registrar otro cobro.',
  PAYMENT_AMOUNT_INVALID: 'El importe recibido no es válido.',
  PAYMENT_PARTIAL_UNSUPPORTED: 'Este incremento sólo admite cancelar el saldo completo.',
  PAYMENT_EXCEEDS_BALANCE: 'El importe supera el saldo pendiente.',
  NO_BALANCE_DUE: 'La orden no tiene saldo pendiente de cobro.',
  PAYMENT_REFERENCE_UNVERIFIED: 'La referencia requiere comprobación humana antes de registrar el cobro.',
  PAYMENT_REFERENCE_ALREADY_USED: 'La referencia ya fue registrada y no puede reutilizarse.',
  PAYMENT_NOT_FOUND: 'El cobro o su comprobante no están disponibles.',
  EXPENSE_NOT_FOUND: 'El gasto no está disponible.',
  EXPENSE_CATEGORY_INVALID: 'La categoría de gasto no está disponible.',
  EXPENSE_POSSIBLE_DUPLICATE: 'Existe un posible gasto duplicado. Consultá el resultado de la operación antes de confirmar una intención distinta.',
  DOCUMENT_NOT_FOUND: 'El respaldo documental no está disponible.',
  DOCUMENT_NOT_AVAILABLE: 'El respaldo todavía no está disponible para adjuntar.',
  DOCUMENT_TYPE_NOT_ALLOWED: 'El tipo de respaldo documental no está permitido.',
  DOCUMENT_STORAGE_UNAVAILABLE: 'El almacenamiento privado de respaldos no está configurado o no responde.',
  AGENDA_ACCESS_DENIED: 'La cuenta no tiene acceso a esta agenda.',
  AGENDA_WORK_NOT_FOUND: 'El trabajo no está disponible en esta agenda.',
  AGENDA_DEPENDENCY_UNAVAILABLE: 'No se puede consultar la agenda en este momento.',
  AGENDA_STATE_UNAVAILABLE: 'No se pudo verificar el estado actual de la agenda.',
  EXECUTION_ACCESS_DENIED: 'La cuenta no tiene acceso a la ejecución de este trabajo.',
  EXECUTION_WORK_NOT_FOUND: 'El trabajo o la evidencia no están disponibles para esta cuenta.',
  EXECUTION_ALREADY_STARTED: 'La ejecución de este trabajo ya fue iniciada.',
  EXECUTION_NOT_STARTED: 'La ejecución todavía no fue iniciada.',
  EXECUTION_STATE_UNAVAILABLE: 'No se pudo verificar el estado actual de la ejecución.',
  EXECUTION_DEPENDENCY_UNAVAILABLE: 'No se puede resolver la identidad del mecánico en este momento.',
  EVIDENCE_STATE_CONFLICT: 'La evidencia no está en un estado que permita esta operación.',
  EVIDENCE_ATTEMPTS_EXHAUSTED: 'La evidencia agotó sus intentos de carga.',
  EVIDENCE_STORAGE_UNAVAILABLE: 'El almacenamiento privado de evidencias no está configurado o no responde.',
  CU15_DISABLED: 'La confirmación de servicios no está habilitada.',
  CONFIRMATION_NOT_FOUND: 'La confirmación no existe.',
  OPERATION_NOT_FOUND: 'La operación aún no tiene un resultado registrado.',
  OVERLAY_NOT_FOUND: 'El sobre de sincronización no está disponible para esta cuenta.',
  CONFIRMATION_TERMINAL: 'La confirmación ya finalizó.',
  ORDER_NOT_CONFIRMABLE: 'La orden no admite confirmación en su estado actual.',
  ORDER_CONFIRMATION_IN_PROGRESS: 'La orden tiene una confirmación en curso.',
  ORDER_ALREADY_CONFIRMED: 'La orden ya está confirmada.',
  AFFECTS_PENDING_CONFIRMATION: 'El cambio afecta una confirmación pendiente.',
  AFFECTS_PENDING_ASSIGNMENT: 'El cambio afecta una reserva o asignación vigente.',
  VALIDATION_ERROR: 'La solicitud no es válida.',
  EMPLOYEE_NOT_FOUND: 'El empleado no existe.',
  DUPLICATE_DOCUMENT: 'El documento ya está registrado.',
  DUPLICATE_EMAIL: 'El email ya está registrado.',
  VERSION_CONFLICT: 'La versión cambió. Recargá el registro y reintentá.',
  IDEMPOTENCY_CONFLICT: 'La operación ya se usó con otro contenido.',
  SELF_DEACTIVATION_FORBIDDEN: 'No podés desactivar tu propia cuenta.',
  ACCESS_REQUEST_CANNOT_BE_REVOKED: 'El acceso solicitado no puede revocarse.',
  ACCESS_NOT_REQUESTED: 'El empleado no tiene acceso solicitado.',
  EMPLOYEE_INACTIVE: 'El empleado está inactivo y no admite planificación.',
  SHIFT_OVERLAP: 'El turno se superpone con otro turno del mismo día.',
  ABSENCE_OVERLAP: 'La ausencia se superpone con otra ausencia registrada.',
  AFFECTS_CONFIRMED_ASSIGNMENT: 'El cambio afecta asignaciones confirmadas; requiere reconocimiento explícito.',
  SHIFT_NOT_FOUND: 'El turno no existe.',
  ABSENCE_NOT_FOUND: 'La ausencia no existe.',
  PERSISTENCE_UNAVAILABLE: 'El servicio propietario no está disponible.',
  UNAUTHENTICATED: 'La sesión no es válida. Ingresá nuevamente.',
  FORBIDDEN: 'La cuenta no tiene permiso para esta operación.',
  SERVICE_UNAVAILABLE: 'El servicio no está disponible. Consultá el estado antes de reintentar.',
  BAD_REQUEST: 'La operación GraphQL no es válida.',
});

export function publicMessage(code: string): string {
  return MESSAGES[code] ?? 'No se pudo completar la operación.';
}

export function isPublicBusinessCode(code: string): boolean {
  return Object.hasOwn(MESSAGES, code);
}
