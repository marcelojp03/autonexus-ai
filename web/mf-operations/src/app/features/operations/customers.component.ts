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
import type { Customer } from '../operations/operations.contract';

@Component({
  selector: 'anx-customers',
  imports: [FormsModule, NzAlertModule, NzButtonModule, NzEmptyModule, NzInputModule, NzPageHeaderModule, NzPopconfirmModule, NzSelectModule, NzTableModule, NzTagModule],
  templateUrl: './customers.component.html',
  styles: [`
    .panel { margin-bottom: 16px; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-bottom: 16px; }
    .field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: rgba(0,0,0,.65); }
    .actions { display: flex; gap: 4px; flex-wrap: wrap; }
  `]
})
export class CustomersComponent implements OnInit {
  private readonly api = inject(OperationsApi);

  readonly rows = signal<Customer[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly editing = signal<Customer | null>(null);

  search = '';
  status = '';
  firstName = '';
  lastName = '';
  document = '';
  phone = '';
  email = '';
  address = '';

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const page = await this.api.customers({
        limit: 50,
        ...(this.search.trim() ? { search: this.search.trim() } : {}),
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

  startCreate(): void {
    this.editing.set(null);
    this.firstName = '';
    this.lastName = '';
    this.document = '';
    this.phone = '';
    this.email = '';
    this.address = '';
    this.error.set(null);
  }

  startEdit(customer: Customer): void {
    this.editing.set(customer);
    this.firstName = customer.firstName;
    this.lastName = customer.lastName;
    this.document = customer.document;
    this.phone = customer.phone;
    this.email = customer.email ?? '';
    this.address = customer.address ?? '';
    this.error.set(null);
  }

  async save(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    const payload = {
      firstName: this.firstName,
      lastName: this.lastName,
      document: this.document,
      phone: this.phone,
      ...(this.email.trim() ? { email: this.email.trim() } : {}),
      ...(this.address.trim() ? { address: this.address.trim() } : {}),
    };
    try {
      const current = this.editing();
      const saved = current
        ? await this.api.updateCustomer(current.id, current.version, payload)
        : await this.api.createCustomer(payload);
      this.notice.set(current ? `Cliente ${saved.firstName} ${saved.lastName} actualizado.` : `Cliente ${saved.firstName} ${saved.lastName} registrado.`);
      this.startCreate();
      await this.load();
    } catch (failure) {
      this.error.set(explain(failure));
    } finally {
      this.saving.set(false);
    }
  }

  async deactivate(customer: Customer): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.api.deactivateCustomer(customer.id, customer.version);
      this.notice.set(`Cliente ${customer.firstName} ${customer.lastName} desactivado; el historial se conserva.`);
      await this.load();
    } catch (failure) {
      this.error.set(explain(failure));
    } finally {
      this.saving.set(false);
    }
  }
}
