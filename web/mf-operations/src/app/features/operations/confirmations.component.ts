import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzPageHeaderModule } from 'ng-zorro-antd/page-header';
import { NzTableModule } from 'ng-zorro-antd/table';

import {
  ConfirmationsApi,
  intervalValid,
  terminal,
  type ConfirmationSaga,
  type Mechanic,
  type ApprovedQuote,
  type ConfirmationAvailability,
  type PendingConfirmation,
  type StartConfirmation
} from './confirmations-api';
import { OperationsApi, OperationsFailure, explain } from './operations-api';
import { toWorkshopIso, localDate, localTime, type WorkOrder } from './operations.contract';
import { SESSION_PORT } from '../../auth/session';

type Recovery = PendingConfirmation & { subject?: string; input?: Readonly<StartConfirmation> };
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function recovery(value: unknown, subject: string): Recovery | null {
  if (
    !record(value) ||
    Object.keys(value).some(key => !['operationId', 'orderId', 'sagaId', 'subject', 'input'].includes(key)) ||
    !uuid(value['operationId']) ||
    !uuid(value['orderId']) ||
    ('sagaId' in value && !uuid(value['sagaId'])) ||
    ('subject' in value && value['subject'] !== subject)
  )
    return null;
  const pending: PendingConfirmation = {
    operationId: value['operationId'],
    orderId: value['orderId'],
    ...(value['sagaId'] ? { sagaId: value['sagaId'] as string } : {})
  };
  if (!('input' in value)) return pending;
  const input = value['input'];
  const fields = [
    'operationId',
    'expectedVersion',
    'quoteId',
    'quoteVersion',
    'employeeId',
    'employeeVersion',
    'requiredSpecialty',
    'startsAt',
    'endsAt'
  ];
  if (
    value['subject'] !== subject ||
    !record(input) ||
    Object.keys(input).length !== fields.length ||
    Object.keys(input).some(key => !fields.includes(key)) ||
    input['operationId'] !== pending.operationId ||
    !uuid(input['quoteId']) ||
    !uuid(input['employeeId'])
  )
    return null;
  if (!['expectedVersion', 'quoteVersion', 'employeeVersion'].every(key => Number.isSafeInteger(input[key]) && (input[key] as number) > 0))
    return null;
  const specialty = input['requiredSpecialty'];
  if (
    typeof specialty !== 'string' ||
    !specialty.length ||
    specialty.length > 80 ||
    Array.from(specialty).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
    specialty !== specialty.trim().replace(/\s+/g, ' ')
  )
    return null;
  const validTime = (time: unknown): time is string =>
    typeof time === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00-04:00$/.test(time) &&
    Number.isFinite(Date.parse(time)) &&
    new Date(Date.parse(time) - 4 * 3600000).toISOString().slice(0, 19) === time.slice(0, 19);
  const start = input['startsAt'];
  const end = input['endsAt'];
  if (!validTime(start) || !validTime(end) || start.slice(0, 10) !== end.slice(0, 10) || start >= end) return null;
  return { ...pending, subject, input: Object.freeze({ ...input } as unknown as StartConfirmation) };
}

@Component({
  selector: 'anx-confirmations',
  imports: [FormsModule, RouterLink, NzAlertModule, NzButtonModule, NzInputModule, NzPageHeaderModule, NzTableModule],
  templateUrl: './confirmations.component.html',
  styles: [
    `
      :host {
        display: block;
      }
      .panel {
        margin-block: 16px;
      }
      .fields {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
        gap: 16px;
        margin-block: 16px;
      }
      label {
        display: grid;
        gap: 6px;
      }
      select {
        width: 100%;
        min-height: 36px;
        padding: 6px;
        border: 1px solid #8c8c8c;
        background: #fff;
        color: #262626;
      }
      .actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-block: 12px;
      }
      .wrap {
        overflow-wrap: anywhere;
      }
      .scroll {
        overflow-x: auto;
      }
      :is(input, select, button, a):focus-visible {
        outline: 2px solid #0050b3;
        outline-offset: 2px;
      }
    `
  ]
})
export class ConfirmationsComponent implements OnInit {
  private readonly api = inject(ConfirmationsApi);
  private readonly operations = inject(OperationsApi);
  private readonly session = inject(SESSION_PORT);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly permissions = signal<string[]>([]);
  readonly orders = signal<WorkOrder[]>([]);
  readonly mechanics = signal<Mechanic[]>([]);
  readonly quotes = signal<ApprovedQuote[]>([]);
  readonly history = signal<ConfirmationSaga[]>([]);
  readonly availability = signal<ConfirmationAvailability | null>(null);
  readonly progress = signal<ConfirmationSaga | null>(null);
  readonly pending = signal<PendingConfirmation | null>(null);
  readonly busy = signal(false);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly unknown = signal(false);
  readonly startBlocked = signal(false);
  private uncertainStart = false;
  readonly statusLabels: Record<ConfirmationSaga['status'], string> = {
    running: 'Confirmación en curso',
    recovery_pending: 'Recuperación pendiente',
    compensating: 'Revirtiendo efectos',
    compensation_pending: 'Compensación pendiente',
    confirmed: 'Servicio confirmado',
    rejected: 'Confirmación rechazada; compensación completada'
  };
  readonly eligibilityLabels: Record<string, string> = {
    EMPLOYEE_INACTIVE: 'Empleado inactivo',
    MECHANIC_NOT_ENABLED: 'Falta habilitación laboral para mecánica',
    SPECIALTY_REQUIRED: 'Falta registrar al menos una especialidad'
  };
  readonly phaseLabels: Record<string, string> = {
    reserve_assignment: 'Reservar mecánico',
    authorize_quote: 'Vincular cotización',
    confirm_assignment: 'Confirmar asignación',
    confirm_order: 'Confirmar orden',
    release_assignment: 'Liberar asignación',
    cancel_quote_link: 'Cancelar vínculo financiero'
  };
  orderId = '';
  quoteKey = '';
  employeeId = '';
  specialty = '';
  startsAt = '';
  endsAt = '';
  mechanicSearch = '';
  orderOffset = 0;
  mechanicOffset = 0;
  quoteOffset = 0;
  readonly orderTotal = signal(0);
  readonly mechanicTotal = signal(0);
  readonly quoteTotal = signal(0);
  private active = true;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private storageKey = '';
  private frozen: { orderId: string; input: StartConfirmation } | null = null;
  private retryInput: { operationId: string; expectedVersion: number } | null = null;
  constructor() {
    const subject = this.session.snapshot().identity?.subject;
    const unsubscribe = this.session.subscribe(state => {
      if (!state.authenticated || state.identity?.subject !== subject) {
        this.clearRecovery();
        this.stop();
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.stop();
      unsubscribe();
    });
  }
  can(permission: string): boolean {
    return this.permissions().includes(permission);
  }
  selectedOrder(): WorkOrder | undefined {
    return this.orders().find(row => row.id === this.orderId);
  }
  selectedMechanic(): Mechanic | undefined {
    return this.mechanics().find(row => row.id === this.employeeId);
  }
  duration(): number {
    return this.selectedOrder()?.items.reduce((sum, item) => sum + item.estimatedMinutes * item.quantity, 0) ?? 0;
  }
  displayTime(value: string): string {
    return `${localDate(value)} ${localTime(value)}`;
  }
  isTerminal(): boolean {
    const saga = this.progress();
    return !!saga && terminal(saga);
  }
  private valid(generation: number): boolean {
    return this.active && generation === this.generation;
  }
  private stop(): void {
    this.active = false;
    this.generation++;
    clearTimeout(this.timer);
    this.permissions.set([]);
    this.progress.set(null);
    this.pending.set(null);
    this.frozen = null;
  }
  private clearRecovery(): void {
    if (!this.storageKey) return;
    try {
      sessionStorage.removeItem(this.storageKey);
    } catch {
      this.error.set('No se pudo limpiar el identificador local.');
    }
  }
  async ngOnInit(): Promise<void> {
    const subject = this.session.snapshot().identity?.subject;
    if (!subject) {
      this.error.set('Se requiere una sesión empresarial.');
      return;
    }
    this.storageKey = `cu15:pending:${subject}`;
    const generation = this.generation;
    this.loading.set(true);
    try {
      const permissions = await this.api.catalog();
      if (!this.valid(generation)) return;
      this.permissions.set(permissions);
      if (!this.can('confirmations:read')) {
        this.error.set('No tenés permiso para consultar confirmaciones.');
        return;
      }
      const id = this.route.snapshot.paramMap.get('id');
      this.restore();
      if (id) {
        this.pending.set({ operationId: '', orderId: '', sagaId: id });
        await this.refresh();
      } else if (this.pending()) await this.refresh();
      else await this.loadOrders();
    } catch (error) {
      if (this.valid(generation)) this.error.set(explain(error));
    } finally {
      if (this.valid(generation)) this.loading.set(false);
    }
  }
  private restore(): void {
    try {
      const raw = sessionStorage.getItem(this.storageKey);
      if (!raw) return;
      const value = raw.length <= 2048 ? recovery(JSON.parse(raw), this.session.snapshot().identity!.subject) : null;
      if (!value) {
        this.clearRecovery();
        return;
      }
      this.pending.set({ operationId: value.operationId, orderId: value.orderId, ...(value.sagaId ? { sagaId: value.sagaId } : {}) });
      this.uncertainStart = true;
      if (value.input) this.frozen = Object.freeze({ orderId: value.orderId, input: value.input });
    } catch {
      this.clearRecovery();
      this.error.set('No se pudo recuperar el identificador local. Consultá la confirmación por su enlace.');
    }
  }
  private persist(value: Recovery): boolean {
    try {
      sessionStorage.setItem(this.storageKey, JSON.stringify(value));
      this.pending.set(value);
      return true;
    } catch {
      this.error.set('El navegador no permite conservar la operación. Habilitá el almacenamiento de sesión antes de enviar.');
      return false;
    }
  }
  async loadOrders(): Promise<void> {
    if (!this.can('confirmations:read') || this.pending()) return;
    const generation = this.generation;
    this.loading.set(true);
    this.error.set(null);
    try {
      const page = await this.operations.orders({ status: 'pending_quote', limit: 20, offset: this.orderOffset });
      if (this.valid(generation)) {
        this.orders.set(page.items);
        this.orderTotal.set(page.total);
      }
    } catch (error) {
      if (this.valid(generation)) this.error.set(explain(error));
    } finally {
      if (this.valid(generation)) this.loading.set(false);
    }
  }
  async chooseOrder(): Promise<void> {
    this.quotes.set([]);
    this.history.set([]);
    this.quoteKey = '';
    this.quoteOffset = 0;
    await Promise.all([this.loadQuotes(), this.loadMechanics(), this.loadHistory()]);
  }
  async loadQuotes(): Promise<void> {
    const id = this.orderId;
    const offset = this.quoteOffset;
    const generation = this.generation;
    if (!id) return;
    try {
      const page = await this.api.quotes(id, offset);
      if (this.valid(generation) && id === this.orderId && offset === this.quoteOffset) {
        this.quotes.set(page.items.filter(quote => quote.orderReference === id && quote.status === 'approved'));
        this.quoteTotal.set(page.total);
      }
    } catch (error) {
      if (this.valid(generation) && id === this.orderId) this.error.set(explain(error));
    }
  }
  async loadHistory(): Promise<void> {
    const id = this.orderId;
    const generation = this.generation;
    if (!id) return;
    try {
      const rows = await this.api.forOrder(id);
      if (this.valid(generation) && id === this.orderId) this.history.set(rows);
    } catch (error) {
      if (this.valid(generation) && id === this.orderId) this.error.set(explain(error));
    }
  }
  async loadMechanics(): Promise<void> {
    const search = this.mechanicSearch;
    const offset = this.mechanicOffset;
    const generation = this.generation;
    try {
      const page = await this.api.mechanics(search, offset);
      if (this.valid(generation) && search === this.mechanicSearch && offset === this.mechanicOffset) {
        this.mechanics.set(page.items);
        this.mechanicTotal.set(page.total);
        this.employeeId = '';
        this.specialty = '';
        this.availability.set(null);
      }
    } catch (error) {
      if (this.valid(generation)) this.error.set(explain(error));
    }
  }
  async loadAvailability(): Promise<void> {
    const employeeId = this.employeeId;
    const date = this.startsAt.slice(0, 10);
    const generation = this.generation;
    this.availability.set(null);
    if (!employeeId || !date) return;
    try {
      const value = await this.api.availability(employeeId, date);
      if (this.valid(generation) && employeeId === this.employeeId && date === this.startsAt.slice(0, 10)) this.availability.set(value);
    } catch (error) {
      if (this.valid(generation)) this.error.set(explain(error));
    }
  }
  async start(): Promise<void> {
    if (this.busy() || this.pending() || !this.can('confirmations:write')) return;
    const order = this.selectedOrder();
    const mechanic = this.selectedMechanic();
    const quote = this.quotes().find(row => `${row.id}:${row.version}` === this.quoteKey);
    if (
      !order ||
      order.status !== 'pending_quote' ||
      !quote ||
      quote.orderReference !== order.id ||
      quote.status !== 'approved' ||
      !mechanic?.eligible ||
      !mechanic.mechanicEnabled ||
      !mechanic.specialties.includes(this.specialty) ||
      !intervalValid(this.startsAt, this.endsAt) ||
      this.history().some(row => !terminal(row) || row.status === 'confirmed')
    ) {
      this.error.set(
        'Seleccioná una orden pendiente, su cotización aprobada, un mecánico habilitado y una especialidad registrada. El intervalo debe ser futuro y del mismo día en La Paz, sin cruzar medianoche.'
      );
      return;
    }
    const input: StartConfirmation = Object.freeze({
      operationId: crypto.randomUUID(),
      expectedVersion: order.version,
      quoteId: quote.id,
      quoteVersion: quote.version,
      employeeId: mechanic.id,
      employeeVersion: mechanic.version,
      requiredSpecialty: this.specialty.trim().replace(/\s+/g, ' '),
      startsAt: toWorkshopIso(this.startsAt),
      endsAt: toWorkshopIso(this.endsAt)
    });
    if (!this.persist({ operationId: input.operationId, orderId: order.id, subject: this.session.snapshot().identity!.subject, input }))
      return;
    this.frozen = Object.freeze({ orderId: order.id, input });
    await this.sendFrozen();
  }
  async sendFrozen(): Promise<void> {
    if (
      this.busy() ||
      !this.active ||
      this.progress() ||
      !this.frozen ||
      this.pending()?.operationId !== this.frozen.input.operationId ||
      this.pending()?.orderId !== this.frozen.orderId ||
      !this.can('confirmations:write')
    )
      return;
    const frozen = this.frozen;
    const generation = this.generation;
    this.busy.set(true);
    this.error.set(null);
    try {
      const saga = await this.api.start(frozen.orderId, frozen.input);
      if (this.valid(generation)) this.accept(saga);
    } catch (error) {
      if (!this.valid(generation)) return;
      const code = error instanceof OperationsFailure ? error.failure.code : '';
      if (
        !this.uncertainStart &&
        [
          'VALIDATION_ERROR',
          'VERSION_CONFLICT',
          'ORDER_NOT_FOUND',
          'ORDER_ALREADY_CONFIRMED',
          'ORDER_CONFIRMATION_IN_PROGRESS',
          'FORBIDDEN'
        ].includes(code)
      ) {
        this.startBlocked.set(true);
        this.frozen = null;
        try {
          sessionStorage.removeItem(this.storageKey);
        } catch {
          this.error.set('No se pudo limpiar el identificador local.');
        }
        this.error.set(
          `El servidor no aceptó este inicio (${code}). ${explain(
            error
          )} Recargá las órdenes y consultá su historial antes de volver a seleccionar.`
        );
      } else {
        this.uncertainStart = true;
        this.unknown.set(true);
        this.error.set('Resultado desconocido: el envío pudo registrarse. Consultá el estado; no iniciés otra confirmación.');
        this.schedule();
      }
    } finally {
      if (this.valid(generation)) this.busy.set(false);
    }
  }
  canResend(): boolean {
    return (
      !!this.frozen &&
      this.pending()?.operationId === this.frozen.input.operationId &&
      this.pending()?.orderId === this.frozen.orderId &&
      !this.progress() &&
      this.unknown() &&
      this.can('confirmations:write')
    );
  }
  private accept(saga: ConfirmationSaga): void {
    const previous = this.progress();
    if (previous?.sagaId === saga.sagaId && (previous.version > saga.version || (terminal(previous) && !terminal(saga)))) return;
    this.progress.set(saga);
    this.startBlocked.set(false);
    this.unknown.set(false);
    this.error.set(null);
    this.frozen = null;
    const pending = { operationId: saga.operationId, orderId: saga.orderId, sagaId: saga.sagaId };
    if (terminal(saga)) {
      this.pending.set(pending);
      this.clearRecovery();
    } else this.persist(pending);
    if (this.route.snapshot.paramMap.get('id') !== saga.sagaId)
      void this.router.navigate(['/confirmations', saga.sagaId], { replaceUrl: true });
    clearTimeout(this.timer);
    if (!terminal(saga)) this.schedule();
  }
  private schedule(): void {
    clearTimeout(this.timer);
    if (this.active)
      this.timer = setTimeout(() => {
        void this.refresh();
      }, 2000);
  }
  async refresh(): Promise<void> {
    const pending = this.pending();
    if (!pending || !this.active || !this.can('confirmations:read')) return;
    const generation = this.generation;
    try {
      const saga = pending.sagaId ? await this.api.saga(pending.sagaId) : await this.api.byOperation(pending.operationId);
      if (this.valid(generation)) this.accept(saga);
    } catch {
      if (this.valid(generation)) {
        this.unknown.set(true);
        this.error.set('Estado no disponible (UNKNOWN). No acredita rechazo ni ausencia de efectos. Se volverá a consultar.');
        this.schedule();
      }
    }
  }
  async retry(): Promise<void> {
    const saga = this.progress();
    if (!saga || terminal(saga) || this.busy() || !this.can('confirmations:write')) return;
    if (!this.retryInput || this.retryInput.expectedVersion !== saga.version)
      this.retryInput = { operationId: crypto.randomUUID(), expectedVersion: saga.version };
    const generation = this.generation;
    this.busy.set(true);
    try {
      const updated = await this.api.retry(saga.sagaId, this.retryInput);
      if (this.valid(generation)) {
        this.retryInput = null;
        this.accept(updated);
      }
    } catch {
      if (this.valid(generation)) {
        this.error.set('No se pudo acreditar el reintento. Se consulta la misma Saga antes de continuar.');
        this.schedule();
      }
    } finally {
      if (this.valid(generation)) this.busy.set(false);
    }
  }
  async newSelection(): Promise<void> {
    if (!this.isTerminal() && !this.startBlocked()) return;
    clearTimeout(this.timer);
    this.generation++;
    this.progress.set(null);
    this.pending.set(null);
    this.startBlocked.set(false);
    this.uncertainStart = false;
    this.unknown.set(false);
    this.frozen = null;
    this.retryInput = null;
    this.orderId = '';
    this.quoteKey = '';
    this.employeeId = '';
    this.quotes.set([]);
    this.history.set([]);
    try {
      sessionStorage.removeItem(this.storageKey);
    } catch {
      this.error.set('No se pudo limpiar el identificador local.');
      return;
    }
    await this.router.navigate(['/confirmations']);
    await this.loadOrders();
  }
}
