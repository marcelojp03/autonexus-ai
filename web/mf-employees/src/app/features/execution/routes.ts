import { Routes } from '@angular/router';

/** CU16 execution screens, mounted under the microfrontend base href. */
export const executionRoutes: Routes = [
  {
    path: 'execution',
    loadComponent: () => import('./execution.component').then((m) => m.ExecutionComponent),
  },
];
