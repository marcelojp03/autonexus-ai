import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzPageHeaderModule } from 'ng-zorro-antd/page-header';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { EmployeesFailure } from '../employees/employees-api';
import { SecurityApi } from './security-api';
import {
  SYNC_ERROR_LABELS,
  SYNC_LABELS,
  VALIDITY_NOTICE,
  type AssignableEmployee,
  type EmployeeRoles,
  type Role,
  type RoleAssignment,
  type SecurityCatalog,
  type SecurityPermission,
} from './security.contract';

const FAILURE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  FORBIDDEN: 'No tenés permiso para esta operación.',
  LAST_ADMINISTRATOR: 'La operación dejaría la plataforma sin un administrador habilitado.',
  PERMISSION_ESCALATION: 'No podés otorgar permisos que no tenés.',
  ROLE_DUPLICATE: 'Ya existe un rol con ese nombre.',
  ROLE_NOT_FOUND: 'El rol ya no existe.',
  EMPLOYEE_WITHOUT_IDENTITY: 'El empleado no tiene identidad vinculada; no se puede asignar un rol.',
  EMPLOYEE_INACTIVE: 'El empleado está inactivo.',
  ROLE_ALREADY_ASSIGNED: 'El empleado ya tiene ese rol.',
  ASSIGNMENT_NOT_ACTIVE: 'La asignación ya estaba retirada.',
  EMPLOYEE_NOT_FOUND: 'El empleado no existe.',
  VERSION_CONFLICT: 'Otra persona modificó el registro; recargá y reintentá.',
  VALIDATION_ERROR: 'Revisá los datos ingresados.',
  SERVICE_UNAVAILABLE: 'El servicio no está disponible en este momento.',
  PERSISTENCE_UNAVAILABLE: 'El servicio no está disponible en este momento.',
});

@Component({
  selector: 'anx-security',
  imports: [
    FormsModule, NzAlertModule, NzButtonModule, NzCheckboxModule, NzEmptyModule, NzInputModule,
    NzPageHeaderModule, NzPopconfirmModule, NzSelectModule, NzTableModule, NzTagModule,
  ],
  templateUrl: './security.component.html',
  styles: [`
    .panel { margin-bottom: 16px; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-bottom: 16px; }
    .field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: rgba(0,0,0,.65); }
    .matrix { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px; margin: 8px 0 4px; }
    .actions { display: flex; gap: 4px; flex-wrap: wrap; }
    .tags { display: flex; gap: 4px; flex-wrap: wrap; }
  `]
})
export class SecurityComponent implements OnInit {
  private readonly api = inject(SecurityApi);

  readonly catalog = signal<SecurityCatalog | null>(null);
  readonly roles = signal<Role[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly forbidden = signal(false);
  readonly validity = VALIDITY_NOTICE;

  readonly employees = signal<AssignableEmployee[]>([]);
  readonly employeeSearch = signal('');
  readonly selectedEmployee = signal<AssignableEmployee | null>(null);
  readonly employeeRoles = signal<EmployeeRoles | null>(null);
  readonly employeeDenied = signal(false);

  readonly selectedRole = signal<string | null>(null);
  readonly editing = signal<Role | null>(null);
  draftName = '';
  draftDescription = '';
  readonly draftPermissions = signal<string[]>([]);

  readonly permissionsByModule = computed<Array<{ module: string; items: SecurityPermission[] }>>(() => {
    const groups = new Map<string, SecurityPermission[]>();
    for (const item of this.catalog()?.catalog ?? []) {
      const list = groups.get(item.module) ?? [];
      list.push(item);
      groups.set(item.module, list);
    }
    return [...groups.entries()].map(([module, items]) => ({ module, items }));
  });
  readonly activeAssignments = computed<RoleAssignment[]>(() => (this.employeeRoles()?.items ?? []).filter(item => item.status === 'active'));
  readonly canReadSecurity = computed<boolean>(() => (this.catalog()?.effective ?? []).includes('security:read'));
  readonly canWriteSecurity = computed<boolean>(() => (this.catalog()?.effective ?? []).includes('security:write'));

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const catalog = await this.api.catalog();
      this.catalog.set(catalog);
      if (!catalog.effective.includes('security:read')) {
        this.forbidden.set(true);
        this.roles.set([]);
        return;
      }
      this.forbidden.set(false);
      this.roles.set(await this.api.roles());
    } catch (failure) {
      this.handle(failure);
    } finally {
      this.loading.set(false);
    }
  }

  startCreate(): void {
    this.editing.set(null);
    this.draftName = '';
    this.draftDescription = '';
    this.draftPermissions.set([]);
    this.error.set(null);
  }

  startEdit(role: Role): void {
    this.editing.set(role);
    this.draftName = role.name;
    this.draftDescription = role.description;
    this.draftPermissions.set([...role.permissions]);
    this.error.set(null);
  }

  cancelEdit(): void {
    this.editing.set(null);
    this.draftName = '';
    this.draftDescription = '';
    this.draftPermissions.set([]);
  }

  togglePermission(id: string, checked: boolean): void {
    const current = new Set(this.draftPermissions());
    if (checked) current.add(id); else current.delete(id);
    this.draftPermissions.set([...current]);
  }

  hasPermission(id: string): boolean {
    return this.draftPermissions().includes(id);
  }

  async save(): Promise<void> {
    if (this.saving()) return;
    const permissions = this.draftPermissions();
    if (!permissions.length) {
      this.error.set('Un rol necesita al menos un permiso.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      const existing = this.editing();
      const role = existing
        ? await this.api.updateRole(existing.name, existing.version, this.draftDescription, permissions)
        : await this.api.createRole(this.draftName.trim(), this.draftDescription, permissions);
      this.notice.set(role.syncStatus === 'synced'
        ? `Rol ${role.name} guardado y sincronizado con el proveedor de identidad.`
        : `Rol ${role.name} guardado; la sincronización con el proveedor falló y puede reintentarse.`);
      this.cancelEdit();
      await this.reload();
    } catch (failure) {
      this.handle(failure);
    } finally {
      this.saving.set(false);
    }
  }

  async retry(role: Role): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const updated = await this.api.retryRoleSync(role.name, role.version);
      this.notice.set(updated.syncStatus === 'synced'
        ? `Rol ${updated.name} reconciliado con el proveedor de identidad.`
        : 'La sincronización volvió a fallar; revisá el estado del proveedor de identidad.');
      await this.reload();
    } catch (failure) {
      this.handle(failure);
    } finally {
      this.saving.set(false);
    }
  }

  async searchEmployees(): Promise<void> {
    this.employeeDenied.set(false);
    try {
      this.employees.set(await this.api.employees(this.employeeSearch().trim() || undefined));
    } catch (failure) {
      const code = (failure as EmployeesFailure)?.failure?.code;
      if (code === 'FORBIDDEN') {
        this.employeeDenied.set(true);
        this.employees.set([]);
        return;
      }
      this.handle(failure);
    }
  }

  async selectEmployee(employeeId: string): Promise<void> {
    const employee = this.employees().find(item => item.id === employeeId) ?? null;
    this.selectedEmployee.set(employee);
    this.selectedRole.set(null);
    this.employeeRoles.set(null);
    if (!employee) return;
    try {
      this.employeeRoles.set(await this.api.employeeRoles(employee.id));
    } catch (failure) {
      this.handle(failure);
    }
  }

  async assign(): Promise<void> {
    const employee = this.selectedEmployee();
    const roleName = this.selectedRole();
    if (!employee || !roleName || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const assignment = await this.api.assignRole(employee.id, roleName);
      this.notice.set(assignment.syncStatus === 'synced'
        ? `Rol ${assignment.roleName} asignado y aplicado en el proveedor de identidad.`
        : `Rol ${assignment.roleName} asignado; la sincronización con el proveedor falló.`);
      await this.selectEmployee(employee.id);
      await this.reload();
    } catch (failure) {
      this.handle(failure);
    } finally {
      this.saving.set(false);
    }
  }

  async revoke(assignment: RoleAssignment): Promise<void> {
    const employee = this.selectedEmployee();
    if (!employee || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const revoked = await this.api.revokeRole(employee.id, assignment.roleName, assignment.version);
      this.notice.set(revoked.syncStatus === 'synced'
        ? `Rol ${revoked.roleName} retirado; el cambio aplica desde la próxima petición.`
        : `Rol ${revoked.roleName} retirado localmente; la sincronización con el proveedor falló.`);
      await this.selectEmployee(employee.id);
      await this.reload();
    } catch (failure) {
      this.handle(failure);
    } finally {
      this.saving.set(false);
    }
  }

  syncLabel(status: string): string {
    return SYNC_LABELS[status] ?? status;
  }

  syncColor(status: string): string {
    return status === 'synced' ? 'green' : status === 'failed' ? 'red' : 'orange';
  }

  syncDetail(role: Role | RoleAssignment): string {
    return role.syncErrorCode ? SYNC_ERROR_LABELS[role.syncErrorCode] ?? role.syncErrorCode : '';
  }

  fullName(employee: AssignableEmployee): string {
    return `${employee.firstName} ${employee.lastName}`;
  }

  private handle(failure: unknown): void {
    const error = failure as EmployeesFailure;
    const code = error?.failure?.code ?? 'SERVICE_UNAVAILABLE';
    this.error.set(FAILURE_LABELS[code] ?? error?.message ?? 'No se pudo completar la operación.');
  }
}
