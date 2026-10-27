import { Routes } from '@angular/router';

/** CU04 planning screens, mounted under the Shell base '/employees'. */
export const scheduleRoutes: Routes = [
  { path: 'schedules', loadComponent: () => import('./schedules.component').then(m => m.SchedulesComponent) }
];
