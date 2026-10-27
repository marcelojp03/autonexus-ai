import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzPageHeaderModule } from 'ng-zorro-antd/page-header';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { EmployeesApi, EmployeesFailure, newOperationId } from './employees-api';
import type { Employee, EmployeeStatus } from './employees.contract';

@Component({
  selector: 'anx-employees-list',
  imports: [
    FormsModule,
    NzAlertModule,
    NzButtonModule,
    NzEmptyModule,
    NzInputModule,
    NzPageHeaderModule,
    NzSelectModule,
    NzTableModule,
    NzTagModule
  ],
  templateUrl: './employees-list.component.html',
  styles: [
    `
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: center;
        margin-bottom: 16px;
      }
      .toolbar .search {
        flex: 1 1 260px;
      }
      .identity strong {
        display: block;
      }
      .identity span {
        color: rgba(0, 0, 0, 0.45);
        font-size: 12px;
      }
      .actions {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
      }
      .notice {
        margin-bottom: 16px;
      }
    `
  ]
})
export class EmployeesListComponent implements OnInit {
  private readonly api = inject(EmployeesApi);
  private readonly router = inject(Router);

  readonly items = signal<Employee[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly conflict = signal(false);
  readonly forbidden = signal(false);
  readonly notice = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);
  readonly search = signal('');
  readonly status = signal<EmployeeStatus | null>(null);
  readonly pageIndex = signal(1);
  readonly pageSize = 10;
  private request = 0;

  ngOnInit(): void {
    void this.load();
  }

  applyFilters(): void {
    this.pageIndex.set(1);
    void this.load();
  }

  clearFilters(): void {
    this.search.set('');
    this.status.set(null);
    this.pageIndex.set(1);
    void this.load();
  }

  onPage(index: number): void {
    this.pageIndex.set(index);
    void this.load();
  }

  create(): void {
    void this.router.navigate(['/new']);
  }

  edit(employee: Employee): void {
    void this.router.navigate(['/', employee.id, 'edit']);
  }

  history(employee: Employee): void {
    void this.router.navigate(['/', employee.id, 'history']);
  }

  async deactivate(employee: Employee): Promise<void> {
    if (employee.status === 'inactive') return;
    this.busyId.set(employee.id);
    this.error.set(null);
    this.conflict.set(false);
    try {
      const result = await this.api.deactivate({
        id: employee.id,
        input: { operationId: newOperationId(), expectedVersion: employee.version }
      });
      this.notice.set(`${result.employee.firstName} ${result.employee.lastName} quedó inactivo; su historial se conserva.`);
      await this.load();
    } catch (error) {
      this.fail(error);
    } finally {
      this.busyId.set(null);
    }
  }

  accessLabel(employee: Employee): string {
    if (!employee.access.requested) return 'Sin acceso solicitado';
    const labels: Record<string, string> = {
      pending: 'Sincronización pendiente',
      synced: 'Perfil sincronizado',
      failed: 'Sincronización fallida',
      conflict: 'Conflicto de identidad',
      not_requested: 'Sin acceso solicitado'
    };
    return labels[employee.access.status] ?? employee.access.status;
  }

  accessColor(employee: Employee): string {
    if (!employee.access.requested) return 'default';
    const colors: Record<string, string> = { pending: 'gold', synced: 'green', failed: 'red', conflict: 'volcano' };
    return colors[employee.access.status] ?? 'default';
  }

  private async load(): Promise<void> {
    const request = ++this.request;
    this.loading.set(true);
    this.error.set(null);
    this.forbidden.set(false);
    try {
      const page = await this.api.list({
        limit: this.pageSize,
        offset: (this.pageIndex() - 1) * this.pageSize,
        ...(this.status() ? { status: this.status() as EmployeeStatus } : {}),
        search: this.search()
      });
      if (request !== this.request) return;
      this.items.set(page.items);
      this.total.set(page.total);
    } catch (error) {
      if (request === this.request) this.fail(error);
    } finally {
      if (request === this.request) this.loading.set(false);
    }
  }

  private fail(error: unknown): void {
    if (error instanceof EmployeesFailure) {
      this.forbidden.set(error.failure.code === 'FORBIDDEN' || error.failure.statusCode === 403);
      this.conflict.set(error.failure.code === 'VERSION_CONFLICT');
      this.error.set(error.failure.message);
      return;
    }
    this.error.set('No se pudo completar la operación. Reintenta.');
  }
}
