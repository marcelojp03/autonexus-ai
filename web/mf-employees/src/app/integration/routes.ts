import { sessionGuard } from '../auth/session';
import { Component } from '@angular/core';
import { RouterLink, Routes } from '@angular/router';

@Component({
  selector: 'anx-integrated-not-found',
  imports: [RouterLink],
  template:
    '<h2>Vista no disponible</h2><p>Esta primera integración solo incluye vistas demo.</p><a routerLink="/widgets">Volver a componentes demo</a>'
})
class IntegratedNotFound {}

/** No template chrome, login guards or redirects outside this MF base path. */
export const integratedRoutes: Routes = [
  { path: '', redirectTo: 'widgets', pathMatch: 'full' },
  { path: 'widgets', canActivate: [sessionGuard], loadChildren: () => import('../routes/widgets/routes').then(module => module.routes) },
  { path: 'dashboard', canActivate: [sessionGuard], loadChildren: () => import('../routes/dashboard/routes').then(module => module.routes) },
  { path: '**', component: IntegratedNotFound }
];
