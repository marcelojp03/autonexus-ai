/** CU23 web contract: the analysis surface consumed through the BFF. */

export const PERMISSIONS = 'query SecurityPermissions { securityCatalog { effective } }';

export const MODEL = `query VisionModel {
  visionModel { ready modelVersion labels insufficientData reason }
}`;

export const WORKS = `query VisionWorks($from: Date, $to: Date, $limit: Int) {
  myAgenda(from: $from, to: $to, limit: $limit) {
    items {
      assignmentId
      orderId
      orderNumber
      startsAt
      status
      executionStatus
      executionProgress { availableEvidence advances lastAdvanceAt }
      vehicle { plate make model }
    }
  }
}`;

export const EXECUTION = `query VisionExecution($assignmentId: UUID!) {
  myExecution(assignmentId: $assignmentId) {
    orderNumber
    assignmentId
    status
    evidenceSummary { pending available failed }
    advances {
      id
      sequence
      description
      evidences { id fileName contentType sizeBytes state }
    }
  }
}`;

const ANALYSIS_FIELDS = `analysisId assignmentId evidenceId orderId modelVersion task threshold insufficientData imageSha256 createdAt replayed
  labels { name score threshold flagged } flagged`;

export const ANALYSES = 'query VisionAnalyses($assignmentId: ID!) { assignmentAnalyses(assignmentId: $assignmentId) { assignmentId items { ' + ANALYSIS_FIELDS + ' } } }';

export const ANALYZE = 'mutation AnalyzeEvidence($assignmentId: ID!, $evidenceId: ID!) { analyzeEvidence(assignmentId: $assignmentId, evidenceId: $evidenceId) { ' + ANALYSIS_FIELDS + ' } }';

/** Workshop calendar day (America/La Paz) as YYYY-MM-DD; never UTC midnight. */
export function workshopDate(date = new Date(), days = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = type => parts.find(part => part.type === type).value;
  const calendar = new Date(value('year') + '-' + value('month') + '-' + value('day') + 'T12:00:00Z');
  calendar.setUTCDate(calendar.getUTCDate() + days);
  return calendar.toISOString().slice(0, 10);
}

export const percent = score => Math.round(Number(score) * 1000) / 10;

export const LABEL_TEXT = {
  crack: 'Grieta',
  dent: 'Golpe',
  glass_shatter: 'Cristal roto',
  lamp_broken: 'Luminaria rota',
  scratch: 'Rayón',
  tire_flat: 'Neumático desinflado',
};

export const labelText = name => LABEL_TEXT[name] ?? name;

/** "Posible golpe (0,82) y rayón (0,61)" — a review signal, never a verdict. */
export function summary(analysis) {
  const flagged = (analysis?.labels ?? []).filter(label => label.flagged);
  if (!flagged.length) return 'Sin señales sobre el umbral del modelo';
  return flagged.map(label => labelText(label.name) + ' (' + percent(label.score) + '%)').join(' · ');
}

const FAILURES = {
  FORBIDDEN: 'No tenés permiso para analizar evidencias de este trabajo.',
  MODEL_NOT_READY: 'El modelo visual no está disponible en este despliegue. No se generan puntajes sin modelo.',
  IMAGE_INVALID: 'La imagen no se pudo procesar: no es un JPEG o PNG válido.',
  IMAGE_TOO_LARGE: 'La imagen supera el tamaño aceptado para el análisis.',
  EVIDENCE_NOT_AVAILABLE: 'La evidencia ya no está disponible o no pertenece a un trabajo a tu alcance.',
  ASSIGNMENT_NOT_FOUND: 'El trabajo no existe o no está a tu alcance.',
  ANALYSIS_NOT_FOUND: 'El análisis solicitado no existe.',
  VALIDATION_ERROR: 'La solicitud no es válida.',
  PERSISTENCE_UNAVAILABLE: 'No se pudo guardar el análisis. Reintentá en unos segundos.',
  SERVICE_UNAVAILABLE: 'Un servicio necesario no está disponible. Reintentá en unos segundos.',
};

export const explain = error => FAILURES[error?.extensions?.code ?? error?.code] ?? error?.message ?? 'No se pudo completar la operación.';

export const canAnalyze = (permissions, model) =>
  Array.isArray(permissions) && permissions.includes('intelligence:analyze') && Boolean(model?.ready);
