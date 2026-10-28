import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzPageHeaderModule } from 'ng-zorro-antd/page-header';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { OperationsApi, explain } from '../operations/operations-api';
import {
  localDate, localTime, toLocalInput, toWorkshopIso,
  type Appointment, type Customer, type ServiceItem, type Vehicle,
} from '../operations/operations.contract';

/** Default window in the workshop zone (UTC-4), not in UTC. */
const workshopInstant = (offsetDays = 0): Date => new Date(Date.now() + offsetDays * 86400000 - 4 * 3600000);
const today = (): string => workshopInstant().toISOString().slice(0, 10);
const daysFrom = (days: number): string => workshopInstant(days).toISOString().slice(0, 10);

@Component({
  selector: 'anx-appointments',
  imports: [FormsModule, NzAlertModule, NzButtonModule, NzEmptyModule, NzInputModule, NzPageHeaderModule, NzPopconfirmModule, NzSelectModule, NzTableModule, NzTagModule],
  templateUrl: './appointments.component.html',
  styles: [`
    .panel { margin-bottom: 16px; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-bottom: 16px; }
    .field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: rgba(0,0,0,.65); }
    .actions { display: flex; gap: 4px; flex-wrap: wrap; }
  `]
})
export class AppointmentsComponent implements OnInit {
  private readonly api = inject(OperationsApi);

  readonly localDate = localDate;
  readonly localTime = localTime;

  readonly rows = signal<Appointment[]>([]);
  readonly total = signal(0);
  readonly customers = signal<Customer[]>([]);
  readonly services = signal<ServiceItem[]>([]);
  readonly vehicles = signal<Vehicle[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly rescheduling = signal<Appointment | null>(null);

  from = today();
  to = daysFrom(14);
  status = '';
  customerId: string | null = null;
  vehicleId: string | null = null;
  serviceId: string | null = null;
  startsAt = `${today()}T09:00`;
  notes = '';
  rescheduleAt = '';
  cancelReason = '';

  async ngOnInit(): Promise<void> {
    await Promise.all([this.load(), this.loadOptions()]);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const page = await this.api.appointments({
        limit: 100,
        from: `${this.from}T00:00:00-04:00`,
        to: `${this.to}T23:59:59-04:00`,
        ...(this.status ? { status: this.status } : {}),
      });
      this.rows.set(page.items);
      this.total.set(page.total);
    } catch (failure) {
      this.error.set(explain(failure));
    } finally {
      this.loading.set(false);
    }
  }

  async loadOptions(): Promise<void> {
    try {
      const [customers, services] = await Promise.all([
        this.api.customers({ limit: 100, status: 'active' }),
        this.api.services({ limit: 100, active: true }),
      ]);
      this.customers.set(customers.items);
      this.services.set(services.items);
    } catch (failure) {
      this.error.set(explain(failure));
    }
  }

  async selectCustomer(customerId: string | null): Promise<void> {
    this.customerId = customerId;
    this.vehicleId = null;
    this.vehicles.set([]);
    if (!customerId) return;
    try {
      const page = await this.api.vehicles({ limit: 100, status: 'active', customerId });
      this.vehicles.set(page.items);
    } catch (failure) {
      this.error.set(explain(failure));
    }
  }

  async schedule(): Promise<void> {
    if (this.saving()) return;
    if (!this.customerId || !this.vehicleId || !this.serviceId) {
      this.error.set('Elegí cliente, vehículo y servicio.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      const created = await this.api.createAppointment({
        customerId: this.customerId,
        vehicleId: this.vehicleId,
        serviceId: this.serviceId,
        startsAt: toWorkshopIso(this.startsAt),
        ...(this.notes.trim() ? { notes: this.notes.trim() } : {}),
      });
      this.notice.set(`Cita de ${created.customerName} (${created.vehiclePlate}) agendada para ${localDate(created.startsAt)} ${localTime(created.startsAt)}. No es una orden de trabajo.`);
      this.notes = '';
      await this.load();
    } catch (failure) {
      this.error.set(explain(failure));
    } finally {
      this.saving.set(false);
    }
  }

  startReschedule(appointment: Appointment): void {
    this.rescheduling.set(appointment);
    this.rescheduleAt = toLocalInput(appointment.startsAt);
    this.error.set(null);
  }

  async confirmReschedule(): Promise<void> {
    const appointment = this.rescheduling();
    if (!appointment || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const updated = await this.api.rescheduleAppointment(appointment.id, appointment.version, toWorkshopIso(this.rescheduleAt), appointment.notes ?? undefined);
      this.notice.set(`Cita reprogramada para ${localDate(updated.startsAt)} ${localTime(updated.startsAt)}.`);
      this.rescheduling.set(null);
      await this.load();
    } catch (failure) {
      this.error.set(explain(failure));
    } finally {
      this.saving.set(false);
    }
  }

  async cancel(appointment: Appointment): Promise<void> {
    if (this.saving()) return;
    if (!this.cancelReason.trim()) {
      this.error.set('Ingresá el motivo de la cancelación.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.api.cancelAppointment(appointment.id, appointment.version, this.cancelReason.trim());
      this.notice.set('Cita cancelada; la franja queda libre y la cita se conserva con su motivo.');
      this.cancelReason = '';
      await this.load();
    } catch (failure) {
      this.error.set(explain(failure));
    } finally {
      this.saving.set(false);
    }
  }
}
