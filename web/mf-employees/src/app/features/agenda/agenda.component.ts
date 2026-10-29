import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTagModule } from 'ng-zorro-antd/tag';

import { AgendaApi } from './agenda-api';
import {
  civilToday,
  validRange,
  agendaError,
  type AgendaScope,
  type AgendaPage,
  type AgendaWork,
  type EmployeesPage,
  type Priority
} from './agenda.contract';
import { SESSION_PORT } from '../../auth/session';
import { EmployeesFailure } from '../employees/employees-api';
@Component({
  selector: 'anx-agenda',
  imports: [FormsModule, RouterLink, NzAlertModule, NzButtonModule, NzInputModule, NzTableModule, NzTagModule],
  templateUrl: './agenda.component.html',
  styles: [
    `
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: flex-end;
        margin: 16px 0;
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 14px;
        color: rgba(0, 0, 0, 0.65);
      }
      select {
        min-height: 32px;
        max-width: 100%;
        border: 1px solid #d9d9d9;
        background: white;
        padding: 4px 8px;
      }
      .clock {
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        font-weight: 600;
      }
      .check {
        border-top: 1px solid #f0f0f0;
        padding-top: 12px;
        color: #595959;
        margin-top: 16px;
      }
      .observations {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .pager {
        display: flex;
        gap: 12px;
        align-items: center;
        margin: 12px 0;
        flex-wrap: wrap;
      }
      @media (max-width: 640px) {
        input,
        select {
          font-size: 16px;
        }
        .toolbar .field {
          flex: 1 1 130px;
          min-width: 0;
        }
        h2 {
          font-size: 20px;
        }
      }
    `
  ]
})
export class AgendaComponent implements OnInit {
  private readonly api = inject(AgendaApi);
  private readonly session = inject(SESSION_PORT);
  private readonly route = inject(ActivatedRoute);
  private readonly destroy = inject(DestroyRef);
  private epoch = 0;
  private employeesEpoch = 0;
  private subject = this.session.snapshot().identity?.subject;
  private alive = true;
  readonly page = signal<AgendaPage | null>(null);
  readonly work = signal<AgendaWork | null>(null);
  readonly staff = signal<EmployeesPage | null>(null);
  readonly loading = signal(false);
  readonly staffLoading = signal(false);
  readonly error = signal<string | null>(null);
  readonly staffError = signal<string | null>(null);
  scope: AgendaScope = 'self';
  assignmentId = '';
  from = civilToday();
  to = this.from;
  priority: Priority | '' = '';
  employeeId = '';
  search = '';
  employeeStatus = '';
  offset = 0;
  staffOffset = 0;
  get base(): string {
    return this.scope === 'team' ? '/agenda/team' : '/agenda';
  }
  constructor() {
    const offline = (): void => {
      this.clear();
      this.error.set('Sin conexión. La agenda requiere consulta online y no se guarda en este dispositivo.');
    };
    window.addEventListener('offline', offline);
    this.destroy.onDestroy(() => {
      this.alive = false;
      this.clear();
      window.removeEventListener('offline', offline);
    });
  }
  ngOnInit(): void {
    this.destroy.onDestroy(
      this.session.subscribe(snapshot => {
        if (!snapshot.authenticated || snapshot.identity?.subject !== this.subject) {
          this.clear();
          this.subject = snapshot.identity?.subject;
          this.employeeId = '';
          this.search = '';
          this.error.set('La sesión cambió. Volvé a consultar con la identidad vigente.');
        }
      })
    );
    const subscription = this.route.paramMap.subscribe(params => {
      this.scope = this.route.snapshot.data['scope'];
      this.assignmentId = params.get('assignmentId') ?? '';
      this.clear();
      void this.load();
      if (this.scope === 'team' && !this.assignmentId) void this.loadEmployees();
    });
    this.destroy.onDestroy(() => subscription.unsubscribe());
  }
  clear(): void {
    this.epoch++;
    this.employeesEpoch++;
    this.page.set(null);
    this.work.set(null);
    this.staff.set(null);
    this.error.set(null);
    this.staffError.set(null);
    this.loading.set(false);
    this.staffLoading.set(false);
  }
  filtersChanged(): void {
    this.epoch++;
    this.page.set(null);
    this.work.set(null);
    this.error.set(null);
    this.loading.set(false);
    this.offset = 0;
  }
  staffChanged(): void {
    this.employeesEpoch++;
    this.staff.set(null);
    this.staffError.set(null);
    this.staffLoading.set(false);
    this.staffOffset = 0;
    this.employeeId = '';
    this.filtersChanged();
  }
  async load(offset = 0): Promise<void> {
    const epoch = ++this.epoch;
    this.page.set(null);
    this.work.set(null);
    this.error.set(null);
    this.loading.set(false);
    if (!this.session.snapshot().authenticated) {
      this.error.set('La sesión terminó. Ingresá nuevamente.');
      return;
    }
    if (!navigator.onLine) {
      this.error.set('Sin conexión. La agenda no se guarda en este dispositivo.');
      return;
    }
    if (!this.assignmentId && !validRange(this.from, this.to)) {
      this.error.set('Elegí fechas válidas: rango de hasta 31 días inclusivos.');
      return;
    }
    this.offset = offset;
    this.loading.set(true);
    try {
      if (this.assignmentId) {
        const work = await this.api.detail(this.scope, this.assignmentId);
        if (this.current(epoch)) this.work.set(work);
      } else {
        const page = await this.api.list(
          this.scope,
          { from: this.from, to: this.to, status: 'confirmed', ...(this.priority ? { priority: this.priority } : {}), limit: 20, offset },
          this.employeeId || undefined
        );
        if (this.current(epoch)) this.page.set(page);
      }
    } catch (error) {
      if (this.current(epoch)) this.error.set(this.message(error));
    } finally {
      if (this.current(epoch)) this.loading.set(false);
    }
  }
  async loadEmployees(offset = 0): Promise<void> {
    if (this.employeeId) {
      this.employeeId = '';
      this.filtersChanged();
    }
    const epoch = ++this.employeesEpoch;
    this.staff.set(null);
    this.staffError.set(null);
    this.staffOffset = offset;
    this.staffLoading.set(true);
    try {
      const staff = await this.api.employees(this.search, this.employeeStatus, offset);
      if (this.alive && epoch === this.employeesEpoch) this.staff.set(staff);
    } catch (error) {
      if (this.alive && epoch === this.employeesEpoch) this.staffError.set(this.message(error));
    } finally {
      if (this.alive && epoch === this.employeesEpoch) this.staffLoading.set(false);
    }
  }
  private current(epoch: number): boolean {
    return this.alive && epoch === this.epoch;
  }
  private message(error: unknown): string {
    return agendaError(error instanceof EmployeesFailure ? error.failure : { code: 'AGENDA_DEPENDENCY_UNAVAILABLE', statusCode: 503 });
  }
  stamp(value: string): string {
    return new Intl.DateTimeFormat('es-BO', {
      timeZone: 'America/La_Paz',
      dateStyle: 'medium',
      timeStyle: 'short',
      hourCycle: 'h23'
    }).format(new Date(value));
  }
  time(value: string): string {
    return new Intl.DateTimeFormat('es-BO', { timeZone: 'America/La_Paz', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
      new Date(value)
    );
  }
}
