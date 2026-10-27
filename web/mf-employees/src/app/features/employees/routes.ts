import { Routes } from '@angular/router';

/** CU03 employee screens, mounted under the Shell base '/employees'. */
export const employeesRoutes: Routes = [
  { path: 'list', loadComponent: () => import('./employees-list.component').then(m => m.EmployeesListComponent) },
  { path: 'new', loadComponent: () => import('./employee-form.component').then(m => m.EmployeeFormComponent) },
  { path: ':id/edit', loadComponent: () => import('./employee-form.component').then(m => m.EmployeeFormComponent) },
  { path: ':id/history', loadComponent: () => import('./employee-history.component').then(m => m.EmployeeHistoryComponent) }
];
