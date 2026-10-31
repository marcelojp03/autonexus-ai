import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzPageHeaderModule } from 'ng-zorro-antd/page-header';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { VerificationApi } from './verification-api';
import { verificationError, type PendingWork, type Verification } from './verification.contract';

/**
 * CU17 jefatura screen. Lists work awaiting verification, shows the mandatory checklist and the
 * review trail, and lets the workshop head approve or return with a reason. It never records
 * advances: writing remains the assigned mechanic's exclusive action.
 */
@Component({
  selector: 'anx-verification',
  standalone: true,
  imports: [CommonModule, FormsModule, NzAlertModule, NzButtonModule, NzCardModule, NzEmptyModule, NzInputModule, NzPageHeaderModule, NzTagModule],
  templateUrl: './verification.component.html',
  styles: [
    `
      :host { display: block; }
      .toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin: 16px 0; }
      .field { display: flex; flex-direction: column; gap: 4px; color: rgba(0, 0, 0, 0.65); font-size: 14px; }
      .item { padding: 12px 0; border-bottom: 1px solid #f0f0f0; }
      .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .when { color: #595959; font-variant-numeric: tabular-nums; }
      .reason { width: min(100%, 520px); }
      @media (max-width: 640px) { .toolbar .field { flex: 1 1 150px; min-width: 0; } input { font-size: 16px; } }
    `,
  ],
})
export class VerificationComponent implements OnInit {
  private readonly api = inject(VerificationApi);

  readonly pending = signal<readonly PendingWork[]>([]);
  readonly closed = signal<readonly PendingWork[]>([]);
  readonly selected = signal<string | null>(null);
  readonly selectedWork = signal<PendingWork | null>(null);
  readonly verification = signal<Verification | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly reason = signal('');
  from = "";
  to = "";

  readonly canDecide = computed(() => {
    const view = this.verification();
    return !!view && view.execution.status === 'pending_verification' && !this.busy();
  });
  readonly blocked = computed(() => {
    const view = this.verification();
    if (!view || view.execution.status !== 'pending_verification') return null;
    if (view.mandatoryPending > 0) return 'Todavía hay actividades obligatorias sin realizar.';
    if (view.availableEvidence < 1) return 'El trabajo no tiene ninguna evidencia disponible.';
    return null;
  });

  ngOnInit(): void {
    void this.load();
  }

  private range(): { from: string; to: string } {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const start = new Date(Number(values['year']), Number(values['month']) - 1, 1);
    const format = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return { from: format(start), to: format(new Date(start.getFullYear(), start.getMonth() + 1, 0)) };
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      if (!this.from || !this.to) { const range = this.range(); this.from = range.from; this.to = range.to; }
      const { from, to } = { from: this.from, to: this.to };
      const [active, history] = await Promise.all([this.api.pending(from, to), this.api.history(from, to)]);
      this.pending.set((active.items ?? []).filter((item) => item.executionStatus === 'pending_verification'));
      this.closed.set(history.items ?? []);
    } catch (failure) {
      this.error.set(verificationError(failureView(failure)));
    } finally {
      this.loading.set(false);
    }
  }

  async select(work: PendingWork): Promise<void> {
    this.selected.set(work.assignmentId);
    this.selectedWork.set(work);
    this.verification.set(null);
    this.notice.set(null);
    this.error.set(null);
    this.reason.set('');
    this.loading.set(true);
    try {
      this.verification.set(await this.api.detail(work.assignmentId));
    } catch (failure) {
      this.error.set(verificationError(failureView(failure)));
    } finally {
      this.loading.set(false);
    }
  }

  async approve(): Promise<void> {
    await this.decide(true);
  }

  async returnToWork(): Promise<void> {
    await this.decide(false);
  }

  private async decide(approved: boolean): Promise<void> {
    const view = this.verification();
    const assignmentId = this.selected();
    if (!view || !assignmentId || this.busy()) return;
    if (!approved && this.reason().trim().length < 3) {
      this.error.set('Escribí el motivo de la devolución (al menos 3 caracteres).');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      const operationId = crypto.randomUUID();
      const result = approved
        ? await this.api.approve(assignmentId, operationId, view.execution.version)
        : await this.api.returnToWork(assignmentId, operationId, view.execution.version, this.reason().trim());
      this.verification.set(result);
      this.notice.set(approved ? 'Trabajo aprobado y orden finalizada técnicamente.' : 'Trabajo devuelto al mecánico con el motivo registrado.');
      await this.load();
    } catch (failure) {
      this.error.set(verificationError(failureView(failure)));
    } finally {
      this.busy.set(false);
    }
  }

  label(action: string): string {
    if (action === 'approved') return 'Aprobado';
    if (action === 'returned') return 'Devuelto';
    return 'Revisión solicitada';
  }

  time(value: string): string {
    return new Intl.DateTimeFormat('es-BO', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/La_Paz' }).format(new Date(value));
  }
}

function failureView(value: unknown): { code?: string; statusCode?: number } {
  if (!value || typeof value !== 'object') return {};
  const error = value as { code?: unknown; statusCode?: unknown; failure?: { code?: unknown; statusCode?: unknown } };
  const failure = error.failure ?? error;
  return {
    ...(typeof failure.code === 'string' ? { code: failure.code } : {}),
    ...(typeof failure.statusCode === 'number' ? { statusCode: failure.statusCode } : {}),
  };
}
