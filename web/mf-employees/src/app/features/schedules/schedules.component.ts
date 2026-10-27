import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzPageHeaderModule } from 'ng-zorro-antd/page-header';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { EmployeesFailure } from '../employees/employees-api';
import { SchedulesApi } from './schedules-api';
import { WEEKDAYS, weekdayLabel, type Absence, type Schedule, type Shift, type StaffingEmployee, type Availability } from './schedules.contract';

@Component({
  selector: 'anx-schedules',
  imports: [FormsModule, NzAlertModule, NzButtonModule, NzCheckboxModule, NzEmptyModule, NzInputModule, NzPageHeaderModule, NzSelectModule, NzTableModule, NzTagModule],
  templateUrl: './schedules.component.html',
  styles: [`
    .toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-bottom: 16px; }
    .field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: rgba(0,0,0,.65); }
    .panel { margin-bottom: 16px; }
    .actions { display: flex; gap: 4px; flex-wrap: wrap; }
    .slots { display: flex; gap: 8px; flex-wrap: wrap; }
  `]
})
export class SchedulesComponent implements OnInit {
  private readonly api = inject(SchedulesApi);

  readonly weekdays = WEEKDAYS;
  readonly employees = signal<StaffingEmployee[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly schedule = signal<Schedule | null>(null);
  readonly availability = signal<Availability | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly forbidden = signal(false);
  readonly relatesToAssignments = signal(false);

  search = '';
  date = new Date().toISOString().slice(0, 10);
  shiftWeekday = 1;
  shiftStart = '09:00';
  shiftEnd = '17:00';
  shiftBreakStart = '';
  shiftBreakEnd = '';
  acknowledge = false;
  absenceStart = '';
  absenceEnd = '';
  absenceReason = '';

  ngOnInit(): void {
    void this.loadEmployees();
  }

  async loadEmployees(): Promise<void> {
    this.loading.set(true);
    this.forbidden.set(false);
    this.error.set(null);
    try {
      const list = await this.api.employees(this.search);
      this.employees.set(list);
      const current = this.selectedId();
      if (list.length && (!current || !list.some(item => item.id === current))) await this.select(list[0].id);
    } catch (error) {
      this.fail(error);
    } finally {
      this.loading.set(false);
    }
  }

  async select(id: string): Promise<void> {
    this.selectedId.set(id);
    await this.reload();
  }

  async reload(): Promise<void> {
    const id = this.selectedId();
    if (!id) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      this.schedule.set(await this.api.schedule(id));
      await this.loadAvailability();
    } catch (error) {
      this.fail(error);
    } finally {
      this.loading.set(false);
    }
  }

  async loadAvailability(): Promise<void> {
    const id = this.selectedId();
    if (!id) return;
    try {
      this.availability.set(await this.api.availability(id, this.date));
    } catch (error) {
      this.fail(error);
    }
  }

  async addShift(): Promise<void> {
    const id = this.selectedId();
    if (!id) return;
    this.saving.set(true);
    this.error.set(null);
    this.relatesToAssignments.set(false);
    try {
      const result = await this.api.createShift(id, {
        operationId: globalThis.crypto.randomUUID(),
        weekday: Number(this.shiftWeekday),
        startsAt: this.shiftStart,
        endsAt: this.shiftEnd,
        ...(this.shiftBreakStart && this.shiftBreakEnd ? { breakStart: this.shiftBreakStart, breakEnd: this.shiftBreakEnd } : {}),
        ...(this.acknowledge ? { acknowledgeConfirmedAssignments: true } : {}),
      });
      this.notice.set('Turno guardado' + (result.acknowledgedAssignments ? ' reconociendo asignaciones confirmadas.' : '.'));
      this.acknowledge = false;
      await this.reload();
    } catch (error) {
      this.fail(error);
    } finally {
      this.saving.set(false);
    }
  }

  async deactivate(shift: Shift): Promise<void> {
    this.saving.set(true);
    try {
      await this.api.deactivateShift(shift.id, shift.version, this.acknowledge);
      this.notice.set('Turno desactivado; el historial se conserva.');
      await this.reload();
    } catch (error) {
      this.fail(error);
    } finally {
      this.saving.set(false);
    }
  }

  async addAbsence(): Promise<void> {
    const id = this.selectedId();
    if (!id) return;
    this.saving.set(true);
    this.error.set(null);
    this.relatesToAssignments.set(false);
    try {
      await this.api.createAbsence(id, {
        operationId: globalThis.crypto.randomUUID(),
        startsOn: this.absenceStart,
        endsOn: this.absenceEnd || this.absenceStart,
        ...(this.absenceReason ? { reason: this.absenceReason } : {}),
        ...(this.acknowledge ? { acknowledgeConfirmedAssignments: true } : {}),
      });
      this.notice.set('Ausencia registrada.');
      this.absenceStart = '';
      this.absenceEnd = '';
      this.absenceReason = '';
      await this.reload();
    } catch (error) {
      this.fail(error);
    } finally {
      this.saving.set(false);
    }
  }

  async cancelAbsence(absence: Absence): Promise<void> {
    this.saving.set(true);
    try {
      await this.api.cancelAbsence(absence.id, absence.version, this.acknowledge);
      this.notice.set('Ausencia cancelada.');
      await this.reload();
    } catch (error) {
      this.fail(error);
    } finally {
      this.saving.set(false);
    }
  }

  weekday(value: number): string {
    return weekdayLabel(value);
  }

  private fail(error: unknown): void {
    if (error instanceof EmployeesFailure) {
      this.forbidden.set(error.failure.code === 'FORBIDDEN' || error.failure.statusCode === 403);
      this.relatesToAssignments.set(error.failure.code === 'AFFECTS_CONFIRMED_ASSIGNMENT');
      this.error.set(error.failure.message);
      return;
    }
    this.error.set('No se pudo completar la operación. Reintenta.');
  }
}
