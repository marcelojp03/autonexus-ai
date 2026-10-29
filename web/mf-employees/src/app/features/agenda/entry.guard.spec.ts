import { TestBed } from '@angular/core/testing';
import { provideRouter, type ActivatedRouteSnapshot, type RouterStateSnapshot, type UrlTree } from '@angular/router';
import { afterEach, expect, test, vi } from 'vitest';

import { employeeEntryGuard } from './entry.guard';
import { agendaRoutes } from './routes';
import { SESSION_PORT } from '../../auth/session';
afterEach(() => TestBed.resetTestingModule());
test.each([
  [['employees:read', 'agenda:read:self'], '/list'],
  [['agenda:read:self'], '/agenda'],
  [['agenda:read:team'], '/agenda/team']
])('entry uses effective permissions %j', async (effective, expected) => {
  const requestBusiness = vi.fn().mockResolvedValue({ data: { securityCatalog: { effective } } });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: SESSION_PORT, useValue: { snapshot: () => ({ authenticated: true, identity: { subject: 'A' } }), requestBusiness } }
    ]
  });
  const result = (await TestBed.runInInjectionContext(() =>
    employeeEntryGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
  )) as UrlTree;
  expect(result.toString()).toBe(expected);
});
test('team routes precede ambiguous assignment parameter', () => {
  expect(agendaRoutes.map(route => route.path)).toEqual(['agenda/team/:assignmentId', 'agenda/team', 'agenda/:assignmentId', 'agenda']);
});
