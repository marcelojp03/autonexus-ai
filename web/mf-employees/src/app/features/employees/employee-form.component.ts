import { Component, inject, input, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators, type AbstractControl, type ValidationErrors } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzDatePickerModule } from 'ng-zorro-antd/date-picker';
import { NzDescriptionsModule } from 'ng-zorro-antd/descriptions';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzPageHeaderModule } from 'ng-zorro-antd/page-header';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { EmployeesApi, EmployeesFailure, newOperationId } from './employees-api';
import type { Employee, EmployeeFieldsInput } from './employees.contract';
import { SESSION_PORT } from '../../auth/session';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** NG-ZORRO reads and writes dates in local time: build and serialize calendar parts, never UTC midnight. */
function localDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
}
function calendarDate(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}
const RETRYABLE = new Set(['SERVICE_UNAVAILABLE', 'PERSISTENCE_UNAVAILABLE']);
const distinctSpecialties = (control: AbstractControl): ValidationErrors | null => {
  const items = (control.value ?? []) as string[];
  const normalized = items.map(item => item.trim().split(/\s+/).join(' ')).filter(Boolean);
  if (normalized.length > 20) return { specialties: true };
  if (normalized.some(item => item.length < 1 || item.length > 80)) return { specialties: true };
  return new Set(normalized).size === normalized.length ? null : { specialties: true };
};

interface Attempt {
  operationId: string;
  signature: string;
}

@Component({
  selector: 'anx-employee-form',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    NzAlertModule,
    NzButtonModule,
    NzCheckboxModule,
    NzDatePickerModule,
    NzDescriptionsModule,
    NzFormModule,
    NzInputModule,
    NzPageHeaderModule,
    NzSelectModule,
    NzSpinModule,
    NzTagModule
  ],
  templateUrl: './employee-form.component.html',
  styles: [
    `
      .form-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 0 16px;
      }
      .wide {
        grid-column: 1 / -1;
      }
      .footer {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 16px;
      }
      .panel {
        margin-bottom: 16px;
      }
    `
  ]
})
export class EmployeeFormComponent implements OnInit {
  readonly id = input<string>();
  private readonly session = inject(SESSION_PORT, { optional: true });
  readonly canManageMechanic = signal(false);
  private readonly api = inject(EmployeesApi);
  private readonly router = inject(Router);
  private readonly builder = inject(FormBuilder).nonNullable;

  readonly form = this.builder.group({
    firstName: this.builder.control('', [Validators.required, Validators.maxLength(100)]),
    lastName: this.builder.control('', [Validators.required, Validators.maxLength(100)]),
    document: this.builder.control('', [Validators.required, Validators.maxLength(40)]),
    email: this.builder.control('', [Validators.required, Validators.maxLength(254), Validators.email]),
    phone: this.builder.control('', [Validators.required, Validators.maxLength(25), Validators.pattern(/^(?=.*[0-9])[0-9+(). -]{7,25}$/)]),
    jobTitle: this.builder.control('', [Validators.required, Validators.maxLength(100)]),
    startDate: this.builder.control<Date | null>(null, [Validators.required]),
    specialties: this.builder.control<string[]>([], [Validators.maxLength(20), distinctSpecialties]),
    mechanicEnabled: this.builder.control(false),
    requested: this.builder.control(false)
  });

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly employee = signal<Employee | null>(null);
  readonly saved = signal<Employee | null>(null);
  readonly replayed = signal(false);
  readonly error = signal<string | null>(null);
  readonly errorCode = signal<string | null>(null);
  readonly reloadHint = signal(false);
  readonly retryable = signal(false);
  readonly created = signal<Employee | null>(null);
  private attempt: Attempt | null = null;

  get editing(): boolean {
    return !!this.id();
  }

  ngOnInit(): void {
    this.form.controls.mechanicEnabled.disable();
    void this.loadMechanicPermission();
    const id = this.id();
    if (id) void this.load(id);
  }

  private async loadMechanicPermission(): Promise<void> {
    if (!this.session) return;
    try {
      const result = await this.session.requestBusiness('query SecurityCatalog { securityCatalog { catalog { id module operation description } effective roles } }');
      const data = result.data as { securityCatalog?: { effective: string[] } } | undefined;
      if (!result.errors?.length && data?.securityCatalog?.effective.includes('employees:write')) {
        this.canManageMechanic.set(true); this.form.controls.mechanicEnabled.enable();
      }
    } catch { /* Labor data remains readable if permission lookup is unavailable. */ }
  }

  async load(id = this.id()): Promise<void> {
    if (!id) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const employee = await this.api.get(id);
      this.employee.set(employee);
      this.patch(employee);
      this.attempt = null;
    } catch (error) {
      this.fail(error);
    } finally {
      this.loading.set(false);
    }
  }

  async submit(): Promise<void> {
    if (this.saving() || (this.created() && !this.editing)) return;
    if (this.form.controls.mechanicEnabled.value && !this.form.controls.specialties.value.some(value => value.trim())) {
      this.error.set('Para habilitar como mecánico, registrá al menos una especialidad.');
      return;
    }
    this.error.set(null);
    this.errorCode.set(null);
    this.reloadHint.set(false);
    if (this.form.invalid) {
      Object.values(this.form.controls).forEach(control => control.markAsDirty());
      this.error.set('Revisá los campos marcados antes de guardar.');
      return;
    }
    const fields = this.fields();
    if (!fields) return;
    const editing = this.editing;
    if (editing && !this.employee()) {
      this.error.set('Cargá el empleado antes de guardar.');
      return;
    }
    const expectedVersion = editing ? this.employee()!.version : 0;
    const requested = this.form.getRawValue().requested;
    const signature = JSON.stringify({ editing, expectedVersion: editing ? expectedVersion : null, requested: editing ? null : requested, fields });
    if (!this.attempt || this.attempt.signature !== signature) this.attempt = { operationId: newOperationId(), signature };
    const operationId = this.attempt.operationId;
    this.saving.set(true);
    try {
      const result = editing
        ? await this.api.update({ id: this.id()!, input: { operationId, expectedVersion, ...fields } })
        : await this.api.create({ input: { operationId, ...fields, access: { requested } } });
      this.saved.set(result.employee);
      this.replayed.set(result.replayed);
      this.employee.set(result.employee);
      this.attempt = null;
      if (editing) this.patch(result.employee);
      else this.created.set(result.employee);
    } catch (error) {
      this.fail(error);
    } finally {
      this.saving.set(false);
    }
  }

  async retryAccess(): Promise<void> {
    const current = this.employee();
    if (!current) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const result = await this.api.retryAccess({ id: current.id, input: { operationId: newOperationId(), expectedVersion: current.version } });
      // The mutation snapshot predates the identity sync; read the owner record to show the final state.
      const refreshed = await this.api.get(result.employee.id);
      this.employee.set(refreshed);
      this.saved.set(refreshed);
      this.replayed.set(result.replayed);
      this.patch(refreshed);
    } catch (error) {
      this.fail(error);
    } finally {
      this.saving.set(false);
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

  reload(): void {
    const id = this.id();
    if (id) void this.load(id);
  }

  back(): void {
    void this.router.navigate(['/list']);
  }

  accessDescription(employee: Employee): string {
    if (!employee.access.requested) return 'No se solicitó cuenta de acceso.';
    const descriptions: Record<string, string> = {
      pending: 'La cuenta vinculada todavía se está sincronizando con Keycloak.',
      synced: 'El perfil de la cuenta coincide con los datos laborales. Sin roles ni credencial habilitada no hay acceso operativo.',
      failed: 'La cuenta no pudo sincronizarse. Los datos laborales sí quedaron guardados.',
      conflict: 'La cuenta encontrada no pertenece a este empleado; no se modificó.',
      not_requested: 'No se solicitó cuenta de acceso.'
    };
    return descriptions[employee.access.status] ?? employee.access.status;
  }

  private patch(employee: Employee): void {
    this.form.patchValue({
      firstName: employee.firstName,
      lastName: employee.lastName,
      document: employee.document,
      email: employee.email,
      phone: employee.phone,
      jobTitle: employee.jobTitle,
      startDate: localDate(employee.startDate),
      specialties: [...employee.specialties],
      mechanicEnabled: employee.mechanicEnabled === true,
      requested: employee.access.requested
    });
    this.form.controls.requested.disable();
  }

  private fields(): EmployeeFieldsInput | null {
    const value = this.form.getRawValue();
    const date = value.startDate;
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      this.error.set('La fecha de ingreso no es válida.');
      return null;
    }
    const startDate = calendarDate(date);
    if (!ISO_DATE.test(startDate)) {
      this.error.set('La fecha de ingreso no es válida.');
      return null;
    }
    return {
      firstName: value.firstName.trim(),
      lastName: value.lastName.trim(),
      document: value.document.trim(),
      email: value.email.trim(),
      phone: value.phone.trim(),
      jobTitle: value.jobTitle.trim(),
      startDate,
      ...(this.canManageMechanic() ? { mechanicEnabled: value.mechanicEnabled } : {}),
      specialties: (value.specialties ?? []).map(item => item.trim().split(/\s+/).join(' ')).filter(Boolean)
    };
  }

  private fail(error: unknown): void {
    if (error instanceof EmployeesFailure) {
      this.errorCode.set(error.failure.code);
      this.error.set(error.failure.message);
      this.reloadHint.set(error.failure.code === 'VERSION_CONFLICT');
      this.retryable.set(RETRYABLE.has(error.failure.code));
      return;
    }
    this.errorCode.set('UNKNOWN');
    this.error.set('No se pudo completar la operación. Reintenta.');
    this.retryable.set(true);
  }
}
