import { Routes } from '@angular/router';
export const agendaRoutes: Routes = [
  {
    path: 'agenda/team/:assignmentId',
    data: { scope: 'team' },
    loadComponent: () => import('./agenda.component').then(m => m.AgendaComponent)
  },
  { path: 'agenda/team', data: { scope: 'team' }, loadComponent: () => import('./agenda.component').then(m => m.AgendaComponent) },
  { path: 'agenda/:assignmentId', data: { scope: 'self' }, loadComponent: () => import('./agenda.component').then(m => m.AgendaComponent) },
  { path: 'agenda', data: { scope: 'self' }, loadComponent: () => import('./agenda.component').then(m => m.AgendaComponent) }
];
