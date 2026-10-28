import { Routes } from '@angular/router';
import { startPageGuard } from '@core';
import { authSimpleCanActivate, authSimpleCanActivateChild } from '@delon/auth';

import { LayoutBasic, LayoutBlank } from '../layout';

export const routes: Routes = [
  {
    path: '',
    component: LayoutBasic,
    canActivate: [startPageGuard, authSimpleCanActivate],
    canActivateChild: [authSimpleCanActivateChild],
    data: {},
    children: [
      { path: '', redirectTo: 'appointments', pathMatch: 'full' },
      { path: 'receptions', loadComponent: () => import('../features/operations/receptions.component').then(m => m.ReceptionsComponent) },
      { path: 'orders', loadComponent: () => import('../features/operations/orders.component').then(m => m.OrdersComponent) },
      { path: 'appointments', loadComponent: () => import('../features/operations/appointments.component').then(m => m.AppointmentsComponent) },
      { path: 'customers', loadComponent: () => import('../features/operations/customers.component').then(m => m.CustomersComponent) },
      { path: 'vehicles', loadComponent: () => import('../features/operations/vehicles.component').then(m => m.VehiclesComponent) },
      { path: 'catalog', loadComponent: () => import('../features/operations/catalog.component').then(m => m.CatalogComponent) },
      {
        path: 'dashboard',
        loadChildren: () => import('./dashboard/routes').then(m => m.routes)
      },
      {
        path: 'widgets',
        loadChildren: () => import('./widgets/routes').then(m => m.routes)
      },
      { path: 'style', loadChildren: () => import('./style/routes').then(m => m.routes) },
      { path: 'delon', loadChildren: () => import('./delon/routes').then(m => m.routes) },
      { path: 'extras', loadChildren: () => import('./extras/routes').then(m => m.routes) },
      { path: 'pro', loadChildren: () => import('./pro/routes').then(m => m.routes) }
    ]
  },
  // Blank Layout 空白布局
  {
    path: 'data-v',
    component: LayoutBlank,
    children: [{ path: '', loadChildren: () => import('./data-v/routes').then(m => m.routes) }]
  },
  // passport
  { path: '', loadChildren: () => import('./passport/routes').then(m => m.routes) },
  { path: 'exception', loadChildren: () => import('./exception/routes').then(m => m.routes) },
  { path: '**', redirectTo: 'exception/404' }
];
