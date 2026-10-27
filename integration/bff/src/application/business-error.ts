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
  PERSISTENCE_UNAVAILABLE: 'El servicio de empleados no está disponible.',
  UNAUTHENTICATED: 'La sesión no es válida. Ingresá nuevamente.',
  FORBIDDEN: 'La cuenta no tiene permiso para esta operación.',
  SERVICE_UNAVAILABLE: 'El servicio de empleados no está disponible.',
  BAD_REQUEST: 'La operación GraphQL no es válida.',
});

export function publicMessage(code: string): string {
  return MESSAGES[code] ?? 'No se pudo completar la operación.';
}
