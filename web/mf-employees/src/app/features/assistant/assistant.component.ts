import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzPageHeaderModule } from 'ng-zorro-antd/page-header';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { AssistantApi } from './assistant-api';
import { AssistantFinancialComponent } from './assistant-financial.component';
import {
  assistantError,
  currentMonth,
  figureText,
  figuresComplete,
  FIGURES_INCOMPLETE_NOTE,
  JOB_POLL_INTERVAL_MS,
  JOB_STORAGE_KEY,
  jobFailureText,
  jobIsTerminal,
  MAX_QUESTION,
  reportAsCsv,
  reportAsJson,
  REPORT_PERMISSION,
  type AssistantAnswer,
  type OperationsReport,
  type ReportJob,
  type ReportJobStatus,
} from './assistant.contract';

interface StoredJob {
  readonly jobId: string;
  readonly from: string;
  readonly to: string;
  readonly operationId: string;
}

/**
 * CU25/CU26: ask the assistant and generate the narrative period report.
 *
 * The report is a job: the interface creates it with an identifier of its own, remembers that
 * identifier in the tab and polls the state. A reload therefore resumes the same job instead of asking
 * for a second generation, and a retried creation reuses the same identifier.
 */
@Component({
  selector: 'anx-assistant',
  standalone: true,
  imports: [CommonModule, FormsModule, NzAlertModule, NzButtonModule, NzCardModule, NzEmptyModule, NzInputModule, NzPageHeaderModule, NzTagModule, AssistantFinancialComponent],
  templateUrl: './assistant.component.html',
  styles: [
    `
      :host { display: block; }
      nz-page-header, nz-card, nz-alert { display: block; margin-bottom: 16px; }
      .toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin: 16px 0; }
      .field { display: flex; flex-direction: column; gap: 4px; color: rgba(0, 0, 0, 0.65); font-size: 14px; }
      .question { width: min(100%, 620px); }
      .answer { white-space: pre-wrap; margin: 8px 0 12px; }
      .when { color: #595959; font-variant-numeric: tabular-nums; }
      .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .note { margin: 12px 0 0; color: #595959; }
      table { width: 100%; border-collapse: collapse; margin: 12px 0; }
      th, td { padding: 8px; border-bottom: 1px solid #f0f0f0; text-align: start; font-variant-numeric: tabular-nums; }
      @media (max-width: 640px) { .toolbar .field { flex: 1 1 150px; min-width: 0; } textarea { font-size: 16px; } }
    `,
  ],
})
export class AssistantComponent implements OnInit, OnDestroy {
  private readonly api = inject(AssistantApi);
  private ticker: ReturnType<typeof setInterval> | undefined;
  private poller: ReturnType<typeof setInterval> | undefined;
  private polling = false;
  private operationId: string | null = null;
  private pollFailures = 0;

  readonly answer = signal<AssistantAnswer | null>(null);
  readonly asking = signal(false);
  readonly askError = signal<string | null>(null);
  readonly elapsed = signal(0);
  readonly report = signal<OperationsReport | null>(null);
  /** True while a job is being created or polled: the pane shows the state instead of the document. */
  readonly generating = signal(false);
  readonly reportError = signal<string | null>(null);
  readonly reportAllowed = signal(false);
  readonly permissionKnown = signal(false);
  readonly jobId = signal<string | null>(null);
  readonly jobStatus = signal<ReportJobStatus | null>(null);
  /** The job was found in the tab after a reload, so the reader knows it was resumed. */
  readonly resumed = signal(false);
  readonly pollWarning = signal<string | null>(null);
  readonly maxQuestion = MAX_QUESTION;
  /**
   * Signals, not plain fields: `canAsk` and `canGenerate` are computed, and a computed over a plain
   * field never invalidates — the buttons would stay disabled after typing (observed in the browser).
   */
  readonly question = signal('');
  readonly from = signal('');
  readonly to = signal('');

  readonly canAsk = computed(() => !this.asking() && this.question().trim().length > 2);
  readonly canGenerate = computed(() => !this.generating() && !!this.from() && !!this.to());
  readonly jobRunning = computed(() => {
    const status = this.jobStatus();
    return status === 'QUEUED' || status === 'RUNNING';
  });
  readonly narrativeIsModel = computed(() => this.report()?.narrativePath === 'llm');
  readonly figuresNote = computed(() => {
    const view = this.report();
    return view && !figuresComplete(view.figures) ? FIGURES_INCOMPLETE_NOTE : null;
  });

  ngOnInit(): void {
    const range = currentMonth();
    this.from.set(range.from);
    this.to.set(range.to);
    void this.loadPermissions();
    this.resumeStoredJob();
  }

  ngOnDestroy(): void {
    this.stopTicker();
    this.stopPolling();
  }

  private async loadPermissions(): Promise<void> {
    try {
      const effective = await this.api.permissions();
      this.reportAllowed.set(effective.includes(REPORT_PERMISSION));
    } catch {
      // Presentation only: an unresolved catalogue keeps the pane visible and the server decides.
      this.reportAllowed.set(false);
    } finally {
      this.permissionKnown.set(true);
    }
  }

  private storage(): Storage | null {
    try {
      return typeof sessionStorage === 'undefined' ? null : sessionStorage;
    } catch {
      return null;
    }
  }

  private readStored(): StoredJob | null {
    const raw = this.storage()?.getItem(JOB_STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<StoredJob>;
      if (typeof parsed.jobId !== 'string' || typeof parsed.operationId !== 'string'
        || typeof parsed.from !== 'string' || typeof parsed.to !== 'string') return null;
      return { jobId: parsed.jobId, operationId: parsed.operationId, from: parsed.from, to: parsed.to };
    } catch {
      return null;
    }
  }

  private store(value: StoredJob): void {
    this.storage()?.setItem(JOB_STORAGE_KEY, JSON.stringify(value));
  }

  private clearStored(): void {
    this.storage()?.removeItem(JOB_STORAGE_KEY);
  }

  /** A job left open in this tab is resumed: polling its identifier cannot start another generation. */
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
    this.poller = setInterval(() => { void this.poll(); }, JOB_POLL_INTERVAL_MS);
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
      const job = await this.api.reportJob(jobId);
      this.pollFailures = 0;
      this.pollWarning.set(null);
      this.apply(job);
    } catch (failure) {
      const view = failureView(failure);
      this.pollFailures += 1;
      // A transient read failure does not cancel the job: the identifier stays and the next poll retries.
      if (view.code === 'FORBIDDEN' || view.code === 'UNAUTHENTICATED') {
        this.stopPolling();
        this.generating.set(false);
        this.stopTicker();
        this.reportError.set(assistantError(view));
        return;
      }
      this.pollWarning.set('No se pudo leer el estado del reporte (' + String(this.pollFailures) +
        ' intento/s). El trabajo sigue en el servidor: se reintenta la consulta.');
    } finally {
      this.polling = false;
    }
  }

  /** Applies a job view: the document ends the flow, a terminal failure explains itself and stops it. */
  private apply(job: ReportJob): void {
    this.jobStatus.set(job.status);
    if (job.status === 'SUCCEEDED' && job.report) {
      this.report.set(job.report);
      this.reportError.set(null);
      this.generating.set(false);
      this.resumed.set(false);
      this.stopPolling();
      this.stopTicker();
      this.clearStored();
      this.operationId = null;
      return;
    }
    if (jobIsTerminal(job.status)) {
      this.reportError.set(jobFailureText(job));
      this.report.set(null);
      this.generating.set(false);
      this.resumed.set(false);
      this.stopPolling();
      this.stopTicker();
      this.clearStored();
      // A terminal failure needs a new identifier to run again; the reader decides when.
      this.operationId = null;
    }
  }

  async ask(): Promise<void> {
    const question = this.question().trim();
    if (!this.canAsk() || question.length > MAX_QUESTION) return;
    this.asking.set(true);
    this.askError.set(null);
    this.answer.set(null);
    this.startTicker();
    try {
      this.answer.set(await this.api.ask(question));
    } catch (failure) {
      this.askError.set(assistantError(failureView(failure)));
    } finally {
      this.stopTicker();
      this.asking.set(false);
    }
  }

  /**
   * Creates the job once. The identifier comes from this component, so retrying a creation that failed
   * before reaching the server returns the same job instead of generating the report twice.
   */
  async generate(): Promise<void> {
    if (!this.canGenerate()) return;
    if (this.jobId() !== null && !jobIsTerminal(this.jobStatus())) {
      this.startPolling();
      return;
    }
    this.operationId ??= newOperationId();
    this.generating.set(true);
    this.reportError.set(null);
    this.report.set(null);
    this.jobStatus.set('QUEUED');
    this.resumed.set(false);
    this.startTicker();
    try {
      const job = await this.api.startReport(this.from(), this.to(), this.operationId);
      this.jobId.set(job.jobId);
      this.store({jobId: job.jobId, from: this.from(), to: this.to(), operationId: this.operationId});
      this.apply(job);
      if (!jobIsTerminal(job.status)) this.startPolling();
    } catch (failure) {
      this.reportError.set(assistantError(failureView(failure)));
      this.generating.set(false);
      this.stopTicker();
    }
  }

  /** Retries the read of an open job; a job that already ended is generated again only on request. */
  retry(): void {
    this.reportError.set(null);
    if (this.jobId() !== null && !jobIsTerminal(this.jobStatus())) {
      this.generating.set(true);
      this.startTicker();
      this.startPolling();
      return;
    }
    void this.generate();
  }

  download(name: string, content: string, type: string): void {
    if (typeof document === 'undefined') return;
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }

  exportJson(): void {
    const view = this.report();
    if (!view) return;
    this.download('reporte-' + view.period.from + '-' + view.period.to + '.json', reportAsJson(view), 'application/json');
  }

  exportCsv(): void {
    const view = this.report();
    if (!view) return;
    this.download('reporte-' + view.period.from + '-' + view.period.to + '.csv', reportAsCsv(view), 'text/csv');
  }

  figure(value: number | null): string {
    return figureText(value);
  }

  time(value: string): string {
    return new Intl.DateTimeFormat('es-BO', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/La_Paz' }).format(new Date(value));
  }

  statusLabel(status: string): string {
    if (status === 'completed') return 'Completado';
    if (status === 'pending_verification') return 'En revisión';
    if (status === 'in_progress') return 'En ejecución';
    return status;
  }

  jobStatusLabel(status: ReportJobStatus | null): string {
    if (status === 'QUEUED') return 'En cola';
    if (status === 'RUNNING') return 'Generando';
    if (status === 'SUCCEEDED') return 'Listo';
    if (status === 'FAILED') return 'Falló';
    if (status === 'INTERRUPTED') return 'Interrumpido';
    return 'Sin trabajo';
  }
}

function newOperationId(): string {
  const source = typeof crypto === 'undefined' ? undefined : crypto;
  if (source && typeof source.randomUUID === 'function') return source.randomUUID();
  // The identifier only has to be unique per client; the BFF rejects anything that is not a UUID.
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
