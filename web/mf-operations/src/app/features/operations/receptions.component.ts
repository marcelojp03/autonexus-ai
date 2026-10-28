import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzPageHeaderModule } from 'ng-zorro-antd/page-header';
import { NzTableModule } from 'ng-zorro-antd/table';
import { OperationsApi, explain } from './operations-api';
import { type Reception, type Vehicle, type Appointment, localDate, localTime } from './operations.contract';
@Component({
  selector: 'anx-receptions',
  imports: [FormsModule, RouterLink, NzAlertModule, NzButtonModule, NzInputModule, NzPageHeaderModule, NzTableModule],
  templateUrl: './receptions.component.html',
  styleUrl: './intake.less'
})
export class ReceptionsComponent implements OnInit {
  private readonly api = inject(OperationsApi);
  readonly rows = signal<Reception[]>([]);
  readonly vehicles = signal<Vehicle[]>([]);
  readonly appointments = signal<Appointment[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly lookupError = signal<string | null>(null);
  readonly appointmentError = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly localDate = localDate;
  readonly localTime = localTime;
  offset = 0; openOnly = false; search = ''; vehicleId = ''; appointmentId = '';
  mileage: number | null = null; reason = ''; symptoms = ''; visibleConditions = '';
  private attempt: { fingerprint: string; operationId: string } | null = null;
  ngOnInit(): void { void this.load(); }
  async load(): Promise<void> {
    this.loading.set(true); this.error.set(null);
    try {
      const page = await this.api.receptions({ limit: 20, offset: this.offset, ...(this.openOnly ? { open: true } : {}) });
      this.rows.set(page.items); this.total.set(page.total);
    } catch (e) { this.rows.set([]); this.error.set(explain(e)); }
    finally { this.loading.set(false); }
  }
  async searchVehicles(): Promise<void> {
    this.lookupError.set(null);
    try {
      const page = await this.api.vehicles({ limit: 100, status: 'active', search: this.search.trim() });
      this.vehicles.set(page.items);
      if (page.total > page.items.length) this.lookupError.set('Hay más vehículos. Acotá la búsqueda por placa.');
    } catch (e) { this.lookupError.set(explain(e)); }
  }
  selectVehicle(id: string): void {
    this.vehicleId = id; this.appointmentId = ''; this.appointments.set([]); this.appointmentError.set(null);
  }
  async loadAppointments(): Promise<void> {
    const vehicleId = this.vehicleId;
    this.appointmentError.set(null);
    try {
      const page = await this.api.appointments({ limit: 100, status: 'scheduled', vehicleId });
      if (this.vehicleId !== vehicleId) return;
      this.appointments.set(page.items);
      if (page.total > page.items.length) this.appointmentError.set('Se muestran las primeras 100 citas. Podés ingresar el identificador de la cita.');
    } catch (e) { if (this.vehicleId === vehicleId) this.appointmentError.set(explain(e)); }
  }
  async save(): Promise<void> {
    if (this.saving()) return;
    if (!this.vehicleId || !Number.isInteger(this.mileage) || this.mileage! < 0 || this.mileage! > 2000000 || this.reason.trim().length < 3 || this.reason.trim().length > 300 || this.symptoms.length > 1000 || this.visibleConditions.length > 1000) {
      this.error.set('Indicá vehículo, kilometraje entero entre 0 y 2 000 000 y motivo de 3 a 300 caracteres. Los textos opcionales admiten hasta 1000 caracteres.'); return;
    }
    const input = { vehicleId: this.vehicleId, appointmentId: this.appointmentId.trim() || null, mileage: this.mileage, reason: this.reason.trim(), symptoms: this.symptoms.trim() || null, visibleConditions: this.visibleConditions.trim() || null };
    const fingerprint = JSON.stringify(input);
    if (this.attempt?.fingerprint !== fingerprint) this.attempt = { fingerprint, operationId: crypto.randomUUID() };
    this.saving.set(true); this.error.set(null); this.notice.set(null);
    try {
      const created = await this.api.createReception({ ...input, operationId: this.attempt.operationId });
      this.notice.set('Recepción registrada para ' + created.vehiclePlate + '. Ya podés crear la orden.');
      this.attempt = null; this.reason = ''; this.symptoms = ''; this.visibleConditions = ''; this.mileage = null; this.appointmentId = '';
      this.offset = 0; await this.load();
    } catch (e) { this.error.set(explain(e)); }
    finally { this.saving.set(false); }
  }
}
