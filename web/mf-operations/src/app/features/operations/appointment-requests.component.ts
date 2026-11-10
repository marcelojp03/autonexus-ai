import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzPageHeaderModule } from 'ng-zorro-antd/page-header';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { AppointmentRequest, localDate, localTime, toLocalInput, toWorkshopIso } from './operations.contract';
import { OperationsApi, explain } from './operations-api';

@Component({
  selector: 'anx-appointment-requests',
  imports: [CommonModule, FormsModule, NzAlertModule, NzButtonModule, NzEmptyModule, NzInputModule, NzPageHeaderModule, NzTagModule],
  templateUrl: './appointment-requests.component.html',
  styles: [
    `
      .request-list {
        display: grid;
        gap: 20px;
        margin-block: 20px;
      }
      .request-row {
        display: grid;
        grid-template-columns: minmax(220px, 1fr) minmax(220px, 0.8fr) minmax(260px, 1fr);
        gap: 20px;
        align-items: start;
        padding-block: 18px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.12);
      }
      .request-row h2 {
        margin: 0 0 8px;
        font-size: 16px;
      }
      .request-row p {
        margin: 4px 0;
      }
      .request-detail {
        color: rgba(0, 0, 0, 0.72);
        font-size: 13px;
      }
      .request-actions {
        display: grid;
        gap: 10px;
      }
      .action-line {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: 8px;
      }
      .action-line label {
        display: grid;
        gap: 4px;
        font-size: 12px;
      }
      .request-id {
        overflow-wrap: anywhere;
        font-size: 11px;
        color: rgba(0, 0, 0, 0.62);
      }
      @media (max-width: 850px) {
        .request-row {
          grid-template-columns: 1fr;
          gap: 10px;
        }
      }
    `
  ]
})
export class AppointmentRequestsComponent implements OnInit {
  private readonly api = inject(OperationsApi);
  readonly rows = signal<AppointmentRequest[]>([]);
  readonly loading = signal(false);
  readonly saving = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly startsAt: Record<string, string> = {};
  readonly reasons: Record<string, string> = {};
  readonly localDate = localDate;
  readonly localTime = localTime;

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.rows.set((await this.api.appointmentRequests()).items);
      for (const request of this.rows()) {
        this.startsAt[request.operationId] ??= toLocalInput(request.requestedStartsAt);
        this.reasons[request.operationId] ??= '';
      }
    } catch (failure) {
      this.error.set(explain(failure));
    } finally {
      this.loading.set(false);
    }
  }

  async approve(request: AppointmentRequest): Promise<void> {
    const local = this.startsAt[request.operationId];
    if (!local || this.saving()) return;
    this.saving.set(request.operationId);
    this.error.set(null);
    this.notice.set(null);
    try {
      const result = await this.api.approveAppointmentRequest(request, toWorkshopIso(local));
      this.notice.set(
        result.appointmentId ? `Solicitud aprobada. Cita ${result.appointmentId} confirmada por el taller.` : 'Solicitud aprobada.'
      );
      await this.load();
    } catch (failure) {
      this.error.set(
        explain(failure) + ' Si la respuesta se perdió, actualizá la cola antes de reintentar; la misma solicitud no crea dos citas.'
      );
    } finally {
      this.saving.set(null);
    }
  }

  async reject(request: AppointmentRequest): Promise<void> {
    const reason = this.reasons[request.operationId]?.trim();
    if (!reason) {
      this.error.set('Ingresá el motivo del rechazo.');
      return;
    }
    if (this.saving()) return;
    this.saving.set(request.operationId);
    this.error.set(null);
    this.notice.set(null);
    try {
      await this.api.rejectAppointmentRequest(request, reason);
      this.notice.set('Solicitud rechazada; el motivo quedó registrado.');
      await this.load();
    } catch (failure) {
      this.error.set(explain(failure) + ' Actualizá la cola para reconciliar el resultado antes de reintentar.');
    } finally {
      this.saving.set(null);
    }
  }
}
