import { sessionGuard } from '../auth/session';
import { Component } from '@angular/core';
import { RouterLink, Routes } from '@angular/router';
import { employeesRoutes } from '../features/employees/routes';
import { scheduleRoutes } from '../features/schedules/routes';

@Component({
  selector: 'anx-integrated-not-found',
  imports: [RouterLink],
  template:
    '<h2>Vista no disponible</h2><p>Esta ruta no forma parte de la integración actual.</p><a routerLink="/list">Volver a empleados</a>'
})
class IntegratedNotFound {}

/** No template chrome, login guards or redirects outside this MF base path. */
export const integratedRoutes: Routes = [
  { path: '', redirectTo: 'list', pathMatch: 'full' },
  ...employeesRoutes.map(route => ({ ...route, canActivate: [sessionGuard] })),
  ...scheduleRoutes.map(route => ({ ...route, canActivate: [sessionGuard] })),
  { path: 'widgets', canActivate: [sessionGuard], loadChildren: () => import('../routes/widgets/routes').then(module => module.routes) },
  { path: 'dashboard', canActivate: [sessionGuard], loadChildren: () => import('../routes/dashboard/routes').then(module => module.routes) },
  { path: '**', component: IntegratedNotFound }
];
