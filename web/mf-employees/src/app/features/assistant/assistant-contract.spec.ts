import { expect, test } from 'vitest';

import {
  currentMonth,
  figureText,
  figuresComplete,
  FIGURES_INCOMPLETE_NOTE,
  jobFailureText,
  jobIsTerminal,
  reportAsCsv,
  reportAsJson,
  type OperationsReport,
} from './assistant.contract';

function report(overrides: Partial<OperationsReport> = {}): OperationsReport {
  return {
    period: { from: '2026-11-01', to: '2026-11-30', timeZone: 'America/La_Paz' },
    generatedAt: '2026-11-06T12:00:00Z',
    narrativePath: 'deterministic',
    model: null,
    narrativeVerified: true,
    promptVersion: 'cu26-report-v2',
    narrative: 'El taller registró 2 trabajos programados en el período.',
    figures: {
      byStatus: [{ status: 'completed', count: 2 }],
      works: [
        { orderNumber: 'OT-1', assignmentId: 'a1', executionStatus: 'completed', advances: 4,
          evidenceAvailable: 3, evidencePending: 0, evidenceFailed: 0 },
        { orderNumber: 'OT-2', assignmentId: null, executionStatus: 'completed', advances: null,
          evidenceAvailable: null, evidencePending: null, evidenceFailed: null },
      ],
      totalWorks: 2,
      advances: 4,
      evidenceAvailable: 3,
      evidencePending: 0,
      evidenceFailed: 0,
      complete: false,
      consultedExecutions: 1,
      failedExecutions: 1,
    },
    claims: [
      { indicator: 'works.total', label: 'trabajos programados', value: 2, unit: 'trabajos',
        period: { from: '2026-11-01', to: '2026-11-30' }, source: 'operations',
        tool: 'autonexus_list_team_agenda', recordRefs: [] },
      { indicator: 'execution.advances', label: 'avances, con coma', value: 4, unit: 'avances',
        period: { from: '2026-11-01', to: '2026-11-30' }, source: 'operations',
        tool: 'autonexus_get_team_execution', recordRefs: [] },
    ],
    references: [],
    provenance: [{ service: 'operations', resource: '/agenda/team', tool: 'autonexus_list_team_agenda',
      observedAt: '2026-11-06T11:59:00Z' }],
    limitations: ['execution_unavailable:OWNER_UNAVAILABLE'],
    financialData: { included: false, note: 'Este reporte no incluye datos financieros.' },
    ...overrides,
  };
}

test('a missing figure is shown as such and never as a zero', () => {
  expect(figureText(null)).toBe('sin dato');
  expect(figureText(0)).toBe('0');
  const partial = report();
  expect(figuresComplete(partial.figures)).toBe(false);
  expect(FIGURES_INCOMPLETE_NOTE).toContain('no se presentan ceros');
  const complete = report();
  expect(figuresComplete({ ...complete.figures, complete: true })).toBe(true);
});

test('a job is terminal only when it can no longer change', () => {
  expect(jobIsTerminal('QUEUED')).toBe(false);
  expect(jobIsTerminal('RUNNING')).toBe(false);
  expect(jobIsTerminal(null)).toBe(false);
  expect(jobIsTerminal('SUCCEEDED')).toBe(true);
  expect(jobIsTerminal('FAILED')).toBe(true);
  expect(jobIsTerminal('INTERRUPTED')).toBe(true);
});

test('the failure text published by the BFF wins over any local wording', () => {
  expect(jobFailureText({ status: 'FAILED', failureCode: 'AUTHORIZATION_EXPIRED',
    failureMessage: 'La autorización venció durante la generación.' })).toBe('La autorización venció durante la generación.');
  expect(jobFailureText({ status: 'INTERRUPTED', failureCode: null, failureMessage: null }))
    .toContain('reinició');
  expect(jobFailureText({ status: 'FAILED', failureCode: null, failureMessage: '  ' }))
    .toContain('no se completó');
  expect(jobFailureText({ status: 'SUCCEEDED', failureCode: null, failureMessage: null })).toBe('');
});

test('the export carries every claim with its period, source and tool', () => {
  const csv = reportAsCsv(report());
  const lines = csv.trimEnd().split('\n');
  expect(lines[0]).toBe('indicador,etiqueta,valor,unidad,desde,hasta,fuente,herramienta');
  expect(lines).toHaveLength(3);
  expect(lines[1]).toBe('works.total,trabajos programados,2,trabajos,2026-11-01,2026-11-30,operations,autonexus_list_team_agenda');
  // A label with a comma is quoted instead of breaking the columns.
  expect(lines[2]).toContain('"avances, con coma"');
});

test('the JSON export is the same document the pane rendered', () => {
  const view = report();
  expect(JSON.parse(reportAsJson(view))).toEqual(view);
});

test('the default period is the current month in the workshop time zone', () => {
  const range = currentMonth(new Date('2026-11-06T03:00:00Z'));
  expect(range).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  // 30 November 23:00 in La Paz is already 1 December in UTC: the month is still November.
  expect(currentMonth(new Date('2026-12-01T03:00:00Z'))).toEqual({ from: '2026-11-01', to: '2026-11-30' });
});
