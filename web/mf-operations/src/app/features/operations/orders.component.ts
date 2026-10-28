import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzPageHeaderModule } from 'ng-zorro-antd/page-header';
import { NzTableModule } from 'ng-zorro-antd/table';
import { OperationsApi, explain } from './operations-api';
import { type Reception, type ServiceItem, type WorkOrder } from './operations.contract';
@Component({
  selector: 'anx-orders',
  imports: [FormsModule, RouterLink, DecimalPipe, NzAlertModule, NzButtonModule, NzInputModule, NzPageHeaderModule, NzTableModule],
  templateUrl: './orders.component.html', styleUrl: './intake.less'
})
export class OrdersComponent implements OnInit {
  private readonly api = inject(OperationsApi);
  private readonly route = inject(ActivatedRoute);
  readonly rows = signal<WorkOrder[]>([]);
  readonly receptions = signal<Reception[]>([]);
  readonly services = signal<ServiceItem[]>([]);
  readonly selectedReception = signal<Reception | null>(null);
  readonly detail = signal<WorkOrder | null>(null);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly receptionError = signal<string | null>(null);
  readonly serviceError = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly statuses: Record<WorkOrder['status'], string> = { pending_quote: 'Pendiente de cotización', quote_requested: 'Cotización solicitada', quote_approved: 'Cotización aprobada', cancelled: 'Cancelada' };
  offset = 0; status = ''; receptionId = ''; description = ''; notes = ''; serviceSearch = ''; receptionSearch = '';
  priority: WorkOrder['priority'] = 'normal';
  items: { serviceId: string; quantity: number | null }[] = [{ serviceId: '', quantity: 1 }];
  private attempt: { fingerprint: string; operationId: string } | null = null;
  ngOnInit(): void {
    this.receptionId = this.route.snapshot.queryParamMap.get('receptionId') ?? '';
    void this.load();
    if (this.receptionId) void this.inspectReception();
  }
  async load(): Promise<void> {
    this.loading.set(true); this.error.set(null);
    try {
      const page = await this.api.orders({ limit: 20, offset: this.offset, ...(this.status ? { status: this.status } : {}) });
      this.rows.set(page.items); this.total.set(page.total);
    } catch (e) { this.rows.set([]); this.error.set(explain(e)); }
    finally { this.loading.set(false); }
  }
  async loadReceptions(): Promise<void> {
    this.receptionError.set(null);
    try {
      const page = await this.api.receptions({ limit: 100, open: true, ...(this.receptionSearch.trim() ? { vehicleId: this.receptionSearch.trim() } : {}) });
      this.receptions.set(page.items);
      if (page.total > page.items.length) this.receptionError.set('Se muestran 100 recepciones. Filtrá por identificador del vehículo.');
    } catch (e) { this.receptionError.set(explain(e)); }
  }
  async inspectReception(): Promise<void> {
    const id = this.receptionId.trim(); this.selectedReception.set(null); this.receptionError.set(null);
    if (!id) return;
    try {
      const reception = await this.api.reception(id);
      if (this.receptionId.trim() !== id) return;
      this.selectedReception.set(reception);
      if (!this.description) this.description = reception.reason;
    } catch (e) { if (this.receptionId.trim() === id) this.receptionError.set(explain(e)); }
  }
  async loadServices(): Promise<void> {
    this.serviceError.set(null);
    try {
      const page = await this.api.services({ limit: 100, active: true, search: this.serviceSearch.trim() });
      this.services.set(page.items);
      if (page.total > page.items.length) this.serviceError.set('Hay más servicios. Acotá la búsqueda por nombre.');
    } catch (e) { this.serviceError.set(explain(e)); }
  }
  addItem(): void { if (this.items.length < 20) this.items.push({ serviceId: '', quantity: 1 }); }
  removeItem(index: number): void { if (this.items.length > 1) this.items.splice(index, 1); }
  async save(): Promise<void> {
    if (this.saving()) return;
    if (!this.receptionId.trim() || this.description.trim().length < 3 || this.description.trim().length > 1000 || this.notes.length > 1000 || !['baja', 'normal', 'alta', 'urgente'].includes(this.priority) || this.items.length < 1 || this.items.length > 20 || this.items.some(item => !item.serviceId.trim() || !Number.isInteger(item.quantity) || item.quantity! < 1 || item.quantity! > 99) || new Set(this.items.map(item => item.serviceId.trim())).size !== this.items.length) {
      this.error.set('Indicá recepción, descripción de 3 a 1000 caracteres y entre 1 y 20 servicios distintos, con cantidad entera de 1 a 99. Notas: máximo 1000 caracteres.'); return;
    }
    const input = { receptionId: this.receptionId.trim(), description: this.description.trim(), priority: this.priority, notes: this.notes.trim() || null, services: this.items.map(item => ({ serviceId: item.serviceId.trim(), quantity: item.quantity })) };
    const fingerprint = JSON.stringify(input);
    if (this.attempt?.fingerprint !== fingerprint) this.attempt = { fingerprint, operationId: crypto.randomUUID() };
    this.saving.set(true); this.error.set(null); this.notice.set(null);
    try {
      const created = await this.api.createWorkOrder({ ...input, operationId: this.attempt.operationId });
      this.detail.set(created); this.notice.set('Orden ' + created.number + ' creada. Pendiente de cotización; no confirma el servicio ni asigna mecánico.');
      this.attempt = null; this.receptions.update(rows => rows.filter(row => row.id !== created.receptionId));
      this.selectedReception.set(null); this.receptionId = ''; this.description = ''; this.notes = ''; this.priority = 'normal'; this.items = [{ serviceId: '', quantity: 1 }];
      this.offset = 0; await this.load();
    } catch (e) { this.error.set(explain(e)); }
    finally { this.saving.set(false); }
  }
}
