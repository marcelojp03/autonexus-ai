import { expect, test } from 'vitest';

import {
  FINANCIAL_FILTERS_DECLARED,
  FINANCIAL_JOB_FIELDS,
  FINANCIAL_JOB_STORAGE_KEY,
  FINANCIAL_SCOPE_DECLARED,
  financialError,
  financialFailureText,
  financialJobIsTerminal,
  financialReportAsCsv,
  financialReportAsJson,
  moneyCloses,
  moneyText,
  type FinancialReport,
} from './financial.contract';

function report(overrides: Partial<FinancialReport> = {}): FinancialReport {
  return {
    period: { from: '2026-11-01', to: '2026-11-30', timeZone: 'America/La_Paz' },
    generatedAt: '2026-11-08T12:00:00Z',
    narrativePath: 'deterministic',
    model: null,
    narrativeVerified: true,
    promptVersion: 'cu26-financial-report-v1',
    narrative: 'Entre el 2026-11-01 y el 2026-11-30 Finance registró Bs 1.234,56 recibidos.',
    figures: {
      receivedMinor: '123456', expenseMinor: '3456', netMinor: '120000',
      currency: 'BOB', paymentCount: 6, expenseCount: 2, complete: true,
    },
    claims: [
      { indicator: 'finance.receivedAmountMinor', label: 'cobros registrados (recibido)', value: '123456',
        unit: 'centavos BOB', period: { from: '2026-11-01', to: '2026-11-30' }, source: 'finance',
        tool: 'autonexus_get_financial_summary', recordRefs: [] },
      { indicator: 'finance.paymentCount', label: 'cantidad de cobros registrados', value: '6',
        unit: 'cobros', period: { from: '2026-11-01', to: '2026-11-30' }, source: 'finance',
        tool: 'autonexus_get_financial_summary', recordRefs: [] },
    ],
    references: [],
    provenance: [{ service: 'finance', resource: '/financial-summary',
      tool: 'autonexus_get_financial_summary', observedAt: '2026-11-08T12:00:00Z' }],
    limitations: ['movimiento_neto_no_es_rentabilidad_ni_saldo_bancario'],
    ...overrides,
  };
}

test('an amount is rendered from centavos with BigInt, never as a float', () => {
  expect(moneyText('0')).toBe('Bs 0,00');
  expect(moneyText('5')).toBe('Bs 0,05');
  expect(moneyText('123456')).toBe('Bs 1.234,56');
  expect(moneyText('-1200')).toBe('Bs -12,00');
  // Float arithmetic would drift here; the string path cannot.
  expect(moneyText('9007199254740993')).toBe('Bs 90.071.992.547.409,93');
  expect(moneyText('not-a-number')).toBe('sin dato');
});

test('the received − expense identity is checked on the strings', () => {
  expect(moneyCloses(report().figures)).toBe(true);
  expect(moneyCloses({ ...report().figures, netMinor: '1' })).toBe(false);
  expect(moneyCloses({ ...report().figures, netMinor: 'no' })).toBe(false);
});

test('the JSON export is the document itself, without derived fields', () => {
  const json = JSON.parse(financialReportAsJson(report())) as Record<string, unknown>;
  expect(json['figures']).toEqual(report().figures);
  expect(json['claims']).toEqual(report().claims);
  expect(typeof (json['figures'] as { receivedMinor: unknown }).receivedMinor).toBe('string');
});

test('the CSV export carries the exact centavos value, never a rounded amount', () => {
  const csv = financialReportAsCsv(report());
  const lines = csv.trim().split('\n');
  expect(lines[0]).toBe('indicador,etiqueta,valor,unidad,desde,hasta,fuente,herramienta');
  expect(lines[1]).toContain('finance.receivedAmountMinor');
  expect(lines[1]).toContain('123456');
  expect(lines[2]).toContain('finance.paymentCount');
  expect(lines[2]).toContain(',6,cobros,');
});

test('a financial job stops polling only in a terminal state', () => {
  expect(financialJobIsTerminal('QUEUED')).toBe(false);
  expect(financialJobIsTerminal('RUNNING')).toBe(false);
  expect(financialJobIsTerminal('SUCCEEDED')).toBe(true);
  expect(financialJobIsTerminal('FAILED')).toBe(true);
  expect(financialJobIsTerminal('INTERRUPTED')).toBe(true);
  expect(financialJobIsTerminal(null)).toBe(false);
});

test('a job without a document explains itself instead of showing zeros', () => {
  expect(financialFailureText({ status: 'INTERRUPTED', failureCode: 'INTERRUPTED_BY_RESTART', failureMessage: null }))
    .toContain('no puede reanudarse');
  expect(financialFailureText({ status: 'FAILED', failureCode: 'FINANCIAL_ACCESS_DENIED',
    failureMessage: 'La cuenta no conserva los dos permisos financieros (cobros y gastos) que exige este reporte.' }))
    .toContain('permisos financieros');
});

test('a revoked financial permission is reported as such, never as a generic failure', () => {
  expect(financialError({ code: 'FORBIDDEN', statusCode: 403 })).toContain('permisos financieros');
  expect(financialError({ code: 'UNAUTHENTICATED', statusCode: 401 })).toContain('sesión');
  expect(financialError(undefined)).toContain('reporte financiero');
});

test('the section declares the missing filters instead of simulating them', () => {
  expect(FINANCIAL_FILTERS_DECLARED).toContain('No hay filtro por categoría');
  expect(FINANCIAL_SCOPE_DECLARED).toContain('no es rentabilidad');
  expect(FINANCIAL_JOB_STORAGE_KEY).not.toBe('anx.cu26.report.job');
  expect(FINANCIAL_JOB_FIELDS).toContain('figures { receivedMinor expenseMinor netMinor');
  expect(FINANCIAL_JOB_FIELDS).not.toContain('totalWorks');
});
