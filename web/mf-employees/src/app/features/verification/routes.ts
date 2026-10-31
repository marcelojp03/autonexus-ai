import { Routes } from '@angular/router';

/** CU17 verification screen for the workshop head, mounted under the microfrontend base href. */
export const verificationRoutes: Routes = [
  {
    path: 'verification',
    loadComponent: () => import('./verification.component').then((m) => m.VerificationComponent),
  },
];