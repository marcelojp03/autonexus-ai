import { Routes } from '@angular/router';
import { businessSessionGuard } from '../../auth/session';

/** CU06/CU07/CU09/CU10 screens, mounted under the Shell base '/operations'. */
export const operationsRoutes: Routes = [
  { path: 'confirmations', canActivate: [businessSessionGuard], loadComponent: () => import('./confirmations.component').then(m => m.ConfirmationsComponent) },
  { path: 'confirmations/:id', canActivate: [businessSessionGuard], loadComponent: () => import('./confirmations.component').then(m => m.ConfirmationsComponent) },
  { path: 'receptions', loadComponent: () => import('./receptions.component').then(m => m.ReceptionsComponent) },
  { path: 'orders', loadComponent: () => import('./orders.component').then(m => m.OrdersComponent) },
  { path: 'customers', loadComponent: () => import('./customers.component').then(m => m.CustomersComponent) },
  { path: 'vehicles', loadComponent: () => import('./vehicles.component').then(m => m.VehiclesComponent) },
  { path: 'catalog', loadComponent: () => import('./catalog.component').then(m => m.CatalogComponent) },
  { path: 'appointments', loadComponent: () => import('./appointments.component').then(m => m.AppointmentsComponent) }
];
