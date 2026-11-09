import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { AssistantApi } from './assistant-api';
import {
  currentMonth,
  financialError,
  financialFailureText,
  financialJobIsTerminal,
  FINANCIAL_FILTERS_DECLARED,
  FINANCIAL_JOB_POLL_INTERVAL_MS,
  FINANCIAL_JOB_STORAGE_KEY,
  FINANCIAL_SCOPE_DECLARED,
  financialReportAsCsv,
  financialReportAsJson,
  moneyCloses,
  moneyText,
  type FinancialJob,
  type FinancialJobStatus,
  type FinancialReport,
} from './financial.contract';

interface StoredFinancialJob {
  readonly jobId: string;
  readonly from: string;
  readonly to: string;
  readonly operationId: string;
}

/**
 * CU26 financial report section (S2.15): a report type of its own inside the existing assistant pane.
 *
 * It owns only its period, its client identifier and its job. The Shell session, navigation and layout
 * are the assistant's, not duplicated here. Money is rendered from the canonical centavos string with
 * BigInt, never from a float. A reload resumes the same job identifier instead of generating again.
 */
@Component({
  selector: 'anx-assistant-financial',
  standalone: true,
  imports: [CommonModule, FormsModule, NzAlertModule, NzButtonModule, NzCardModule, NzEmptyModule, NzInputModule, NzTagModule],
  templateUrl: './assistant-financial.component.html',
  styles: [
    `
      :host { display: block; }
      .toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin: 16px 0; }
      .field { display: flex; flex-direction: column; gap: 4px; color: rgba(0, 0, 0, 0.65); font-size: 14px; }
      .answer { white-space: pre-wrap; margin: 8px 0 12px; }
      .when { color: #595959; font-variant-numeric: tabular-nums; }
      .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .note { margin: 12px 0 0; color: #595959; }
      .amounts { display: flex; flex-wrap: wrap; gap: 24px; margin: 12px 0; }
      .amount { display: flex; flex-direction: column; gap: 2px; }
      .amount .value { font-size: 20px; font-variant-numeric: tabular-nums; }
      table { width: 100%; border-collapse: collapse; margin: 12px 0; }
      th, td { padding: 8px; border-bottom: 1px solid #f0f0f0; text-align: start; font-variant-numeric: tabular-nums; }
      @media (max-width: 640px) { .toolbar .field { flex: 1 1 150px; min-width: 0; } }
    `,
  ],
})
export class AssistantFinancialComponent implements OnInit, OnDestroy {
  private readonly api = inject(AssistantApi);
  private ticker: ReturnType<typeof setInterval> | undefined;
  private poller: ReturnType<typeof setInterval> | undefined;
  private polling = false;
  private operationId: string | null = null;
  private pollFailures = 0;

  readonly report = signal<FinancialReport | null>(null);
  readonly generating = signal(false);
  readonly error = signal<string | null>(null);
  readonly jobId = signal<string | null>(null);
  readonly jobStatus = signal<FinancialJobStatus | null>(null);
  readonly resumed = signal(false);
  readonly pollWarning = signal<string | null>(null);
  readonly elapsed = signal(0);
  readonly from = signal('');
  readonly to = signal('');
  readonly filters = FINANCIAL_FILTERS_DECLARED;
  readonly scope = FINANCIAL_SCOPE_DECLARED;

  readonly canGenerate = computed(() => !this.generating() && !!this.from() && !!this.to());
  readonly jobRunning = computed(() => {
    const status = this.jobStatus();
    return status === 'QUEUED' || status === 'RUNNING';
  });
  readonly narrativeIsModel = computed(() => this.report()?.narrativePath === 'llm');
  readonly figuresClose = computed(() => {
    const view = this.report();
    return view === null ? true : moneyCloses(view.figures);
  });

  ngOnInit(): void {
    const range = currentMonth();
    this.from.set(range.from);
    this.to.set(range.to);
    this.resumeStoredJob();
  }

  ngOnDestroy(): void {
    this.stopTicker();
    this.stopPolling();
  }

  money(value: string): string {
    return moneyText(value);
  }

  time(value: string): string {
    return new Intl.DateTimeFormat('es-BO', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/La_Paz' })
      .format(new Date(value));
  }

  statusLabel(status: FinancialJobStatus | null): string {
    if (status === 'QUEUED') return 'En cola';
    if (status === 'RUNNING') return 'Generando';
    if (status === 'SUCCEEDED') return 'Listo';
    if (status === 'FAILED') return 'Falló';
    if (status === 'INTERRUPTED') return 'Interrumpido';
    return 'Sin trabajo';
  }

  async generate(): Promise<void> {
    if (!this.canGenerate()) return;
    if (this.jobId() !== null && !financialJobIsTerminal(this.jobStatus())) {
      this.startPolling();
      return;
    }
    this.operationId ??= newOperationId();
    this.generating.set(true);
    this.error.set(null);
    this.report.set(null);
    this.jobStatus.set('QUEUED');
    this.resumed.set(false);
    this.startTicker();
    try {
      const job = await this.api.startFinancialReport(this.from(), this.to(), this.operationId);
      this.jobId.set(job.jobId);
      this.store({ jobId: job.jobId, from: this.from(), to: this.to(), operationId: this.operationId });
      this.apply(job);
      if (!financialJobIsTerminal(job.status)) this.startPolling();
    } catch (failure) {
      this.error.set(financialError(failureView(failure)));
      this.generating.set(false);
      this.stopTicker();
    }
  }

  retry(): void {
    this.error.set(null);
    if (this.jobId() !== null && !financialJobIsTerminal(this.jobStatus())) {
      this.generating.set(true);
      this.startTicker();
      this.startPolling();
      return;
    }
    void this.generate();
  }

  exportJson(): void {
    const view = this.report();
    if (!view) return;
    this.download('reporte-financiero-' + view.period.from + '-' + view.period.to + '.json',
      financialReportAsJson(view), 'application/json');
  }

  exportCsv(): void {
    const view = this.report();
    if (!view) return;
    this.download('reporte-financiero-' + view.period.from + '-' + view.period.to + '.csv',
      financialReportAsCsv(view), 'text/csv');
  }

  private download(name: string, content: string, type: string): void {
    if (typeof document === 'undefined') return;
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }

  private storage(): Storage | null {
    try {
      return typeof sessionStorage === 'undefined' ? null : sessionStorage;
    } catch {
      return null;
    }
  }

  private readStored(): StoredFinancialJob | null {
    const raw = this.storage()?.getItem(FINANCIAL_JOB_STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<StoredFinancialJob>;
      if (typeof parsed.jobId !== 'string' || typeof parsed.operationId !== 'string'
        || typeof parsed.from !== 'string' || typeof parsed.to !== 'string') return null;
      return { jobId: parsed.jobId, operationId: parsed.operationId, from: parsed.from, to: parsed.to };
    } catch {
      return null;
    }
  }

  private store(value: StoredFinancialJob): void {
    this.storage()?.setItem(FINANCIAL_JOB_STORAGE_KEY, JSON.stringify(value));
  }

  private clearStored(): void {
    this.storage()?.removeItem(FINANCIAL_JOB_STORAGE_KEY);
  }

  /** A financial job left open in this tab is resumed: polling its identifier cannot generate again. */
  private resumeStoredJob(): void {
    const stored = this.readStored();
    if (stored === null) return;
    this.operationId = stored.operationId;
    this.from.set(stored.from);
    this.to.set(stored.to);
    this.jobId.set(stored.jobId);
    this.resumed.set(true);
    this.generating.set(true);
    this.startTicker();
    this.startPolling();
  }

  private startTicker(): void {
    this.stopTicker();
    this.elapsed.set(0);
    this.ticker = setInterval(() => this.elapsed.update(seconds => seconds + 1), 1000);
  }

  private stopTicker(): void {
    if (this.ticker !== undefined) clearInterval(this.ticker);
    this.ticker = undefined;
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollFailures = 0;
    void this.poll();
    this.poller = setInterval(() => { void this.poll(); }, FINANCIAL_JOB_POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.poller !== undefined) clearInterval(this.poller);
    this.poller = undefined;
    this.polling = false;
  }

  private async poll(): Promise<void> {
    const jobId = this.jobId();
    if (jobId === null || this.polling) return;
    this.polling = true;
    try {
      const job = await this.api.financialReportJob(jobId);
      this.pollFailures = 0;
      this.pollWarning.set(null);
      this.apply(job);
    } catch (failure) {
      const view = failureView(failure);
      this.pollFailures += 1;
      // A revoked permission ends the poll: the server would answer 403 for every read from now on.
      if (view.code === 'FORBIDDEN' || view.code === 'UNAUTHENTICATED') {
        this.stopPolling();
        this.stopTicker();
        this.generating.set(false);
        this.error.set(financialError(view));
        return;
      }
      this.pollWarning.set('No se pudo leer el estado del reporte financiero (' + String(this.pollFailures) +
        ' intento/s). El trabajo sigue en el servidor: se reintenta la consulta.');
    } finally {
      this.polling = false;
    }
  }

  private apply(job: FinancialJob): void {
    this.jobStatus.set(job.status);
    if (job.status === 'SUCCEEDED' && job.report) {
      this.report.set(job.report);
      this.error.set(null);
      this.generating.set(false);
      this.resumed.set(false);
      this.stopPolling();
      this.stopTicker();
      this.clearStored();
      this.operationId = null;
      return;
    }
    if (financialJobIsTerminal(job.status)) {
      this.error.set(financialFailureText(job));
      this.report.set(null);
      this.generating.set(false);
      this.resumed.set(false);
      this.stopPolling();
      this.stopTicker();
      this.clearStored();
      this.operationId = null;
    }
  }
}

function newOperationId(): string {
  const source = typeof crypto === 'undefined' ? undefined : crypto;
  if (source && typeof source.randomUUID === 'function') return source.randomUUID();
  const hex = (length: number) => Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return hex(8) + '-' + hex(4) + '-4' + hex(3) + '-8' + hex(3) + '-' + hex(12);
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
