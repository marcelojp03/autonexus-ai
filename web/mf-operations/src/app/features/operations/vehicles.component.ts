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
import { FUEL_TYPES, type Customer, type Vehicle } from '../operations/operations.contract';

@Component({
  selector: 'anx-vehicles',
  imports: [FormsModule, NzAlertModule, NzButtonModule, NzEmptyModule, NzInputModule, NzPageHeaderModule, NzPopconfirmModule, NzSelectModule, NzTableModule, NzTagModule],
  templateUrl: './vehicles.component.html',
  styles: [`
    .panel { margin-bottom: 16px; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-bottom: 16px; }
    .field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: rgba(0,0,0,.65); }
    .actions { display: flex; gap: 4px; flex-wrap: wrap; }
  `]
})
export class VehiclesComponent implements OnInit {
  private readonly api = inject(OperationsApi);

  readonly fuels = FUEL_TYPES;
  readonly rows = signal<Vehicle[]>([]);
  readonly owners = signal<Customer[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly editing = signal<Vehicle | null>(null);

  search = '';
  status = '';
  plate = '';
  make = '';
  model = '';
  year = new Date().getFullYear();
  fuelType: Vehicle['fuelType'] = 'gasolina';
  color = '';
  customerId: string | null = null;

  async ngOnInit(): Promise<void> {
    await Promise.all([this.load(), this.loadOwners()]);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const page = await this.api.vehicles({
        limit: 50,
        ...(this.search.trim() ? { search: this.search.trim() } : {}),
        ...(this.status ? { status: this.status } : {}),
      });
      this.rows.set(page.items);
    } catch (failure) {
      this.error.set(explain(failure));
    } finally {
      this.loading.set(false);
    }
  }

  async loadOwners(): Promise<void> {
    try {
      const page = await this.api.customers({ limit: 100, status: 'active' });
      this.owners.set(page.items);
    } catch (failure) {
      this.error.set(explain(failure));
    }
  }

  startCreate(): void {
    this.editing.set(null);
    this.plate = '';
    this.make = '';
    this.model = '';
    this.year = new Date().getFullYear();
    this.fuelType = 'gasolina';
    this.color = '';
    this.customerId = null;
    this.error.set(null);
  }

  startEdit(vehicle: Vehicle): void {
    this.editing.set(vehicle);
    this.plate = vehicle.plate;
    this.make = vehicle.make;
    this.model = vehicle.model;
    this.year = vehicle.year;
    this.fuelType = vehicle.fuelType;
    this.color = vehicle.color ?? '';
    this.customerId = vehicle.customerId;
    this.error.set(null);
  }

  async save(): Promise<void> {
    if (this.saving() || !this.customerId) {
      if (!this.customerId) this.error.set('Elegí el cliente propietario del vehículo.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    const payload = {
      customerId: this.customerId,
      plate: this.plate,
      make: this.make,
      model: this.model,
      year: Number(this.year),
      fuelType: this.fuelType,
      ...(this.color.trim() ? { color: this.color.trim() } : {}),
    };
    try {
      const current = this.editing();
      const saved = current
        ? await this.api.updateVehicle(current.id, current.version, payload)
        : await this.api.createVehicle(payload);
      const ownerChange = current && current.customerId !== saved.customerId;
      this.notice.set(ownerChange
        ? `Vehículo ${saved.plate} actualizado con cambio de propietario registrado.`
        : `Vehículo ${saved.plate} ${current ? 'actualizado' : 'registrado'}.`);
      this.startCreate();
      await this.load();
    } catch (failure) {
      this.error.set(explain(failure));
    } finally {
      this.saving.set(false);
    }
  }

  async deactivate(vehicle: Vehicle): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.api.deactivateVehicle(vehicle.id, vehicle.version);
      this.notice.set(`Vehículo ${vehicle.plate} desactivado; el historial se conserva.`);
      await this.load();
    } catch (failure) {
      this.error.set(explain(failure));
    } finally {
      this.saving.set(false);
    }
  }
}
