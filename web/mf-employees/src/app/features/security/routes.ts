import { Routes } from '@angular/router';

/** CU02 security screens, mounted under the Shell base '/employees'. */
export const securityRoutes: Routes = [
  { path: 'security', loadComponent: () => import('./security.component').then(m => m.SecurityComponent) }
];
