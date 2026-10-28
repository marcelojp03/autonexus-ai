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
import { CATEGORIES, type ServiceItem } from '../operations/operations.contract';

@Component({
  selector: 'anx-catalog',
  imports: [FormsModule, NzAlertModule, NzButtonModule, NzEmptyModule, NzInputModule, NzPageHeaderModule, NzPopconfirmModule, NzSelectModule, NzTableModule, NzTagModule],
  templateUrl: './catalog.component.html',
  styles: [`
    .panel { margin-bottom: 16px; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-bottom: 16px; }
    .field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: rgba(0,0,0,.65); }
    .actions { display: flex; gap: 4px; flex-wrap: wrap; }
  `]
})
export class CatalogComponent implements OnInit {
  private readonly api = inject(OperationsApi);

  readonly categories = CATEGORIES;
  readonly rows = signal<ServiceItem[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly editing = signal<ServiceItem | null>(null);

  search = '';
  active = '';
  name = '';
  description = '';
  category: ServiceItem['category'] = 'mantenimiento';
  estimatedMinutes = 60;
  referenceRate = 100;

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const page = await this.api.services({
        limit: 100,
        ...(this.search.trim() ? { search: this.search.trim() } : {}),
        ...(this.active ? { active: this.active === 'true' } : {}),
      });
      this.rows.set(page.items);
    } catch (failure) {
      this.error.set(explain(failure));
    } finally {
      this.loading.set(false);
    }
  }

  startCreate(): void {
    this.editing.set(null);
    this.name = '';
    this.description = '';
    this.category = 'mantenimiento';
    this.estimatedMinutes = 60;
    this.referenceRate = 100;
    this.error.set(null);
  }

  startEdit(service: ServiceItem): void {
    this.editing.set(service);
    this.name = service.name;
    this.description = service.description;
    this.category = service.category;
    this.estimatedMinutes = service.estimatedMinutes;
    this.referenceRate = service.referenceRate;
    this.error.set(null);
  }

  async save(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    const payload = {
      name: this.name,
      description: this.description,
      category: this.category,
      estimatedMinutes: Number(this.estimatedMinutes),
      referenceRate: Number(this.referenceRate),
    };
    try {
      const current = this.editing();
      const saved = current
        ? await this.api.updateService(current.id, current.version, payload)
        : await this.api.createService(payload);
      this.notice.set(`Servicio ${saved.name} ${current ? 'actualizado' : 'registrado'}.`);
      this.startCreate();
      await this.load();
    } catch (failure) {
      this.error.set(explain(failure));
    } finally {
      this.saving.set(false);
    }
  }

  async deactivate(service: ServiceItem): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.api.deactivateService(service.id, service.version);
      this.notice.set(`Servicio ${service.name} desactivado; no se elimina y conserva su historial.`);
      await this.load();
    } catch (failure) {
      this.error.set(explain(failure));
    } finally {
      this.saving.set(false);
    }
  }
}
