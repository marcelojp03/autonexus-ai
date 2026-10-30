import { Component } from '@angular/core';
import { RouterLink, Routes } from '@angular/router';

import { sessionGuard } from '../auth/session';
import { employeeEntryGuard } from '../features/agenda/entry.guard';
import { agendaRoutes } from '../features/agenda/routes';
import { employeesRoutes } from '../features/employees/routes';
import { executionRoutes } from '../features/execution/routes';
import { scheduleRoutes } from '../features/schedules/routes';
import { securityRoutes } from '../features/security/routes';

@Component({
  selector: 'anx-integrated-not-found',
  imports: [RouterLink],
  template:
    '<h2>Vista no disponible</h2><p>Esta ruta no forma parte de la integración actual.</p><a routerLink="/list">Volver a empleados</a>'
})
class IntegratedNotFound {}

/** No template chrome, login guards or redirects outside this MF base path. */
export const integratedRoutes: Routes = [
  { path: '', pathMatch: 'full', canActivate: [employeeEntryGuard], component: IntegratedNotFound },
  ...agendaRoutes.map(route => ({ ...route, canActivate: [sessionGuard] })),
  ...executionRoutes.map(route => ({ ...route, canActivate: [sessionGuard] })),
  ...employeesRoutes.map(route => ({ ...route, canActivate: [sessionGuard] })),
  ...scheduleRoutes.map(route => ({ ...route, canActivate: [sessionGuard] })),
  ...securityRoutes.map(route => ({ ...route, canActivate: [sessionGuard] })),
  { path: 'widgets', canActivate: [sessionGuard], loadChildren: () => import('../routes/widgets/routes').then(module => module.routes) },
  {
    path: 'dashboard',
    canActivate: [sessionGuard],
    loadChildren: () => import('../routes/dashboard/routes').then(module => module.routes)
  },
  { path: '**', component: IntegratedNotFound }
];
