import { sessionGuard } from '../auth/session';
import { Component } from '@angular/core';
import { RouterLink, Routes } from '@angular/router';
import { operationsRoutes } from '../features/operations/routes';

@Component({
  selector: 'anx-integrated-not-found',
  imports: [RouterLink],
  template:
    '<h2>Vista no disponible</h2><p>Esta primera integración solo incluye vistas demo.</p><a routerLink="/widgets">Volver a componentes demo</a>'
})
class IntegratedNotFound {}

/** No template chrome, login guards or redirects outside this MF base path. */
export const integratedRoutes: Routes = [
  { path: '', redirectTo: 'appointments', pathMatch: 'full' },
  ...operationsRoutes.map(route => ({ ...route, canActivate: [sessionGuard, ...(route.canActivate ?? [])] })),
  { path: 'widgets', canActivate: [sessionGuard], loadChildren: () => import('../routes/widgets/routes').then(module => module.routes) },
  { path: 'dashboard', canActivate: [sessionGuard], loadChildren: () => import('../routes/dashboard/routes').then(module => module.routes) },
  { path: '**', component: IntegratedNotFound }
];
