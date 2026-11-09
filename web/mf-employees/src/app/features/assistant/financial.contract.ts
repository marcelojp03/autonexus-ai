/**
 * CU26 financial report contract (S2.15) — the financial type, separate from the operational one.
 *
 * Money arrives as a canonical string of integer centavos BOB and is only ever rendered through
 * `BigInt`. It is never parsed into a `number`, so the interface cannot print a rounded amount.
 */

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

export interface FinancialFigures {
  /** Centavos BOB as text, exactly as the owner computed them. */
  readonly receivedMinor: string;
  readonly expenseMinor: string;
  readonly netMinor: string;
  readonly currency: string;
  readonly paymentCount: number;
  readonly expenseCount: number;
  readonly complete: boolean;
}

export interface FinancialClaim {
  readonly indicator: string;
  readonly label: string;
  readonly value: string;
  readonly unit: string;
  readonly period: { readonly from: string; readonly to: string };
  readonly source: string;
  readonly tool: string;
  readonly recordRefs: readonly AssistantRecordReference[];
}

export interface FinancialReport {
  readonly period: { readonly from: string; readonly to: string; readonly timeZone: string };
  readonly generatedAt: string;
  readonly narrativePath: string;
  readonly model: string | null;
  readonly narrativeVerified: boolean;
  readonly promptVersion: string;
  readonly narrative: string;
  readonly figures: FinancialFigures;
  readonly claims: readonly FinancialClaim[];
  readonly references: readonly AssistantRecordReference[];
  readonly provenance: readonly AssistantProvenance[];
  readonly limitations: readonly string[];
}

export type FinancialJobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'INTERRUPTED';

export interface FinancialJob {
  readonly jobId: string;
  readonly status: FinancialJobStatus;
  readonly period: { readonly from: string; readonly to: string; readonly timeZone: string };
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly report: FinancialReport | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
}

export const FINANCIAL_REPORT_FIELDS =
  'period { from to timeZone } generatedAt narrativePath model narrativeVerified promptVersion narrative ' +
  'figures { receivedMinor expenseMinor netMinor currency paymentCount expenseCount complete } ' +
  'claims { indicator label value unit period { from to } source tool recordRefs { kind id label } } ' +
  'references { kind id label } provenance { service resource tool observedAt } limitations';

export const FINANCIAL_JOB_FIELDS =
  'jobId status requestedAt startedAt finishedAt period { from to timeZone } failureCode failureMessage ' +
  'report { ' + FINANCIAL_REPORT_FIELDS + ' }';

/** Where the open financial job is remembered so a reload resumes it instead of regenerating. */
export const FINANCIAL_JOB_STORAGE_KEY = 'anx.cu26.financial.job';

/** How often the section asks for the state of its job: short reads, never a new generation. */
export const FINANCIAL_JOB_POLL_INTERVAL_MS = 2000;

/**
 * Declared, not simulated: the owner summary publishes no category, employee or indicator breakdown, so
 * this section offers only the period. Offering the filters would mean inventing the figures behind them.
 */
export const FINANCIAL_FILTERS_DECLARED =
  'Sólo se ofrece el período. No hay filtro por categoría, empleado ni indicador porque el resumen del ' +
  'propietario financiero no publica esos desgloses; no se simulan.';

export const FINANCIAL_SCOPE_DECLARED =
  'Comprende cobros y gastos registrados del período. La diferencia registrada no es rentabilidad, ' +
  'utilidad, flujo de caja ni saldo bancario.';

/** Renders centavos as `Bs 1.234,56` using BigInt only: an amount never passes through a float. */
export function moneyText(minor: string): string {
  let value: bigint;
  try {
    value = BigInt(minor);
  } catch {
    return 'sin dato';
  }
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const units = (absolute / 100n).toString();
  const decimals = (absolute % 100n).toString().padStart(2, '0');
  let grouped = '';
  for (let index = 0; index < units.length; index += 1) {
    const fromEnd = units.length - index;
    grouped += units[index];
    if (fromEnd > 1 && fromEnd % 3 === 1) grouped += '.';
  }
  return 'Bs ' + (negative ? '-' : '') + grouped + ',' + decimals;
}

/** True when the received − expense = net identity holds, checked with BigInt on the raw strings. */
export function moneyCloses(figures: FinancialFigures): boolean {
  try {
    return BigInt(figures.receivedMinor) - BigInt(figures.expenseMinor) === BigInt(figures.netMinor);
  } catch {
    return false;
  }
}

export function financialJobIsTerminal(status: FinancialJobStatus | null): boolean {
  return status === 'SUCCEEDED' || status === 'FAILED' || status === 'INTERRUPTED';
}

export function financialFailureText(job: Pick<FinancialJob, 'status' | 'failureCode' | 'failureMessage'>): string {
  if (job.failureMessage && job.failureMessage.trim()) return job.failureMessage;
  if (job.status === 'INTERRUPTED') return 'El servicio se reinició durante la generación; el trabajo no puede reanudarse.';
  if (job.status === 'FAILED') return 'La generación del reporte financiero no se completó.';
  return '';
}

/** Stable Spanish text per BFF code; the server's own message is never echoed. */
export function financialError(failure: { code?: string; statusCode?: number } | undefined): string {
  switch (failure?.code) {
    case 'FORBIDDEN':
      return 'Esta cuenta no es un empleado vigente con los dos permisos financieros (cobros y gastos).';
    case 'UNAUTHENTICATED':
      return 'La sesión no es válida. Ingresá nuevamente desde el Shell.';
    case 'VALIDATION_ERROR':
      return 'Revisá el período: dos fechas válidas, con hasta 31 días.';
    case 'SERVICE_UNAVAILABLE':
      return 'El servicio financiero no está disponible o tardó demasiado. Reintentá en segundos.';
    default:
      return 'No se pudo completar el reporte financiero.';
  }
}

/** The document as a downloadable JSON: exactly what the section rendered, nothing derived. */
export function financialReportAsJson(report: FinancialReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * The document as CSV: one row per claim with its exact value, plus the three amounts as published.
 * Amounts keep their canonical centavos string in the `valor` column so a spreadsheet cannot round them.
 */
export function financialReportAsCsv(report: FinancialReport): string {
  const header = ['indicador', 'etiqueta', 'valor', 'unidad', 'desde', 'hasta', 'fuente', 'herramienta'];
  const escape = (value: string) => (/[",\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value);
  const lines = [header.join(',')];
  for (const claim of report.claims) {
    lines.push([claim.indicator, claim.label, claim.value, claim.unit, claim.period.from, claim.period.to,
      claim.source, claim.tool].map(escape).join(','));
  }
  return lines.join('\n') + '\n';
}

/** First and last day of the current month in the workshop time zone (same rule as the operational pane). */
export function currentMonth(now: Date = new Date()): { from: string; to: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const year = Number(values['year']);
  const month = Number(values['month']);
  const format = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { from: format(new Date(year, month - 1, 1)), to: format(new Date(year, month, 0)) };
}
