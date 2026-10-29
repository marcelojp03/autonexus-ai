import { expect, test } from 'vitest';

import { civilToday, validRange, agendaError, employeeLanding } from './agenda.contract';
test('La Paz civil date ignores browser timezone', () => {
  expect(civilToday(new Date('2026-11-01T02:00:00Z'))).toBe('2026-10-31');
});
test('inclusive range permits 31 days and validates dates', () => {
  expect(validRange('2026-01-01', '2026-01-31')).toBe(true);
  expect(validRange('2026-01-01', '2026-02-01')).toBe(false);
  expect(validRange('2026-02-30', '2026-03-01')).toBe(false);
  expect(validRange('2026-03-02', '2026-03-01')).toBe(false);
});
test('landing preserves administration and team-only permissions', () => {
  expect(employeeLanding(['employees:read', 'agenda:read:self'])).toBe('list');
  expect(employeeLanding(['agenda:read:team'])).toBe('agenda/team');
  expect(employeeLanding(['agenda:read:self'])).toBe('agenda');
});
test('safe errors distinguish denied, missing, consistency and dependency', () => {
  expect(agendaError({ code: 'AGENDA_ACCESS_DENIED', statusCode: 403 })).toContain('vínculo');
  expect(agendaError({ code: 'AGENDA_WORK_NOT_FOUND', statusCode: 404 })).toContain('no está disponible');
  expect(agendaError({ code: 'AGENDA_STATE_UNAVAILABLE', statusCode: 503 })).toContain('cambiaron');
  expect(agendaError({ code: 'AGENDA_DEPENDENCY_UNAVAILABLE', statusCode: 503 })).toContain('dependencia');
});
