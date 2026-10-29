import type { AgendaPage, AgendaWork } from '../src/application/agenda-gateway.js';

export const ID = '11111111-1111-4111-8111-111111111111';
export const EMPLOYEE_ID = '22222222-2222-4222-8222-222222222222';
export const OBSERVED = '2026-10-28T15:00:00Z';
export const WORK: AgendaWork = {
  assignmentId: ID, orderId: ID, orderNumber: 'OT-SYNTHETIC',
  employee: { id: EMPLOYEE_ID, fullName: 'Synthetic mechanic', status: 'active' },
  vehicle: { id: ID, plate: 'SYNTHETIC', make: 'Test', model: 'Fixture' },
  startsAt: '2026-10-28T14:00:00Z', endsAt: '2026-10-28T16:00:00Z', priority: 'alta', status: 'confirmed',
  description: 'Synthetic order', notes: null,
  services: [{ serviceId: ID, serviceName: 'Synthetic service', quantity: 1, estimatedMinutes: 120 }],
  orderVersion: 3, assignmentVersion: 2, observedAt: OBSERVED, confirmationObservation: 'pending',
};
export const PAGE: AgendaPage = {
  actor: { employeeId: EMPLOYEE_ID, fullName: 'Synthetic mechanic', status: 'active', scopes: ['self', 'team'] },
  items: [WORK], total: 1, limit: 20, offset: 0, from: '2026-10-28', to: '2026-10-28',
  timeZone: 'America/La_Paz', observedAt: OBSERVED,
};
export const EMPLOYEES_PAGE = { items: [WORK.employee], total: 1, limit: 20, offset: 0, observedAt: OBSERVED };
export const WORK_FIELDS = `assignmentId orderId orderNumber employee { id fullName status }
  vehicle { id plate make model } startsAt endsAt priority status description notes
  services { serviceId serviceName quantity estimatedMinutes } orderVersion assignmentVersion observedAt confirmationObservation`;
