import { Component, inject, input, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzPageHeaderModule } from 'ng-zorro-antd/page-header';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { EmployeesApi, EmployeesFailure } from './employees-api';
import type { Employee, EmployeeHistoryEntry } from './employees.contract';

@Component({
  selector: 'anx-employee-history',
  imports: [RouterLink, NzAlertModule, NzButtonModule, NzEmptyModule, NzPageHeaderModule, NzTableModule, NzTagModule],
  templateUrl: './employee-history.component.html',
  styles: [
    `
      .mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
      }
      .panel {
        margin-bottom: 16px;
      }
    `
  ]
})
export class EmployeeHistoryComponent implements OnInit {
  readonly id = input<string>();
  private readonly api = inject(EmployeesApi);

  readonly employee = signal<Employee | null>(null);
  readonly entries = signal<EmployeeHistoryEntry[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly forbidden = signal(false);
  readonly pageIndex = signal(1);
  readonly pageSize = 20;

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    const id = this.id();
    if (!id) return;
    this.loading.set(true);
    this.error.set(null);
    this.forbidden.set(false);
    try {
      const [employee, page] = await Promise.all([
        this.api.get(id),
        this.api.history(id, { limit: this.pageSize, offset: (this.pageIndex() - 1) * this.pageSize })
      ]);
      this.employee.set(employee);
      this.entries.set(page.items);
      this.total.set(page.total);
    } catch (error) {
      if (error instanceof EmployeesFailure) {
        this.forbidden.set(error.failure.code === 'FORBIDDEN' || error.failure.statusCode === 403);
        this.error.set(error.failure.message);
      } else {
        this.error.set('No se pudo cargar el historial. Reintenta.');
      }
    } finally {
      this.loading.set(false);
    }
  }

  onPage(index: number): void {
    this.pageIndex.set(index);
    void this.load();
  }

  actionLabel(action: EmployeeHistoryEntry['action']): string {
    return action === 'created' ? 'Alta' : action === 'updated' ? 'Modificación' : 'Desactivación';
  }

  accessLabel(status: string): string {
    const labels: Record<string, string> = {
      not_requested: 'Sin acceso solicitado',
      pending: 'Sincronización pendiente',
      synced: 'Perfil sincronizado',
      failed: 'Sincronización fallida',
      conflict: 'Conflicto de identidad'
    };
    return labels[status] ?? status;
  }

  formattedDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' });
  }

  actionColor(action: EmployeeHistoryEntry['action']): string {
    return action === 'created' ? 'green' : action === 'updated' ? 'blue' : 'volcano';
  }
}
