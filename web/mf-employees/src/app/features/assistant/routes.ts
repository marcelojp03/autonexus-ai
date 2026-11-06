import { Routes } from '@angular/router';

/** CU25/CU26 assistant and narrative report, mounted under the microfrontend base href. */
export const assistantRoutes: Routes = [
  {
    path: 'assistant',
    loadComponent: () => import('./assistant.component').then((m) => m.AssistantComponent),
  },
];
