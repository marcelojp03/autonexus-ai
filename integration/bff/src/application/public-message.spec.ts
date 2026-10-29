import { expect, it } from 'vitest';
import { publicMessage } from './business-error.js';
it('does not attribute an Operations/Finance transport failure to Employees', () => {
  expect(publicMessage('SERVICE_UNAVAILABLE')).toBe('El servicio no está disponible. Consultá el estado antes de reintentar.');
  expect(publicMessage('PERSISTENCE_UNAVAILABLE')).toBe('El servicio propietario no está disponible.');
});
it('does not echo an unrecognized upstream detail', () => {
  expect(publicMessage('private upstream content')).toBe('No se pudo completar la operación.');
});
