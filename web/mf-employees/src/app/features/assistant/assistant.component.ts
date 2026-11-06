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
import {
  assistantError,
  currentMonth,
  MAX_QUESTION,
  REPORT_PERMISSION,
  type AssistantAnswer,
  type OperationsReport,
} from './assistant.contract';

/**
 * CU25/CU26: ask the assistant and generate the narrative period report. The answer text always
 * travels with its sources, provenance and declared limitations; the report shows the deterministic
 * figures next to the narrative and never a financial amount.
 */
@Component({
  selector: 'anx-assistant',
  standalone: true,
  imports: [CommonModule, FormsModule, NzAlertModule, NzButtonModule, NzCardModule, NzEmptyModule, NzInputModule, NzPageHeaderModule, NzTagModule],
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

  readonly answer = signal<AssistantAnswer | null>(null);
  readonly asking = signal(false);
  readonly askError = signal<string | null>(null);
  readonly elapsed = signal(0);
  readonly report = signal<OperationsReport | null>(null);
  readonly generating = signal(false);
  readonly reportError = signal<string | null>(null);
  readonly reportAllowed = signal(false);
  readonly permissionKnown = signal(false);
  readonly maxQuestion = MAX_QUESTION;
  question = '';
  from = '';
  to = '';

  readonly canAsk = computed(() => !this.asking() && this.question.trim().length > 2);
  readonly canGenerate = computed(() => !this.generating() && !!this.from && !!this.to);

  ngOnInit(): void {
    const range = currentMonth();
    this.from = range.from;
    this.to = range.to;
    void this.loadPermissions();
  }

  ngOnDestroy(): void {
    this.stopTicker();
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

  private startTicker(): void {
    this.stopTicker();
    this.elapsed.set(0);
    this.ticker = setInterval(() => this.elapsed.update(seconds => seconds + 1), 1000);
  }

  private stopTicker(): void {
    if (this.ticker !== undefined) clearInterval(this.ticker);
    this.ticker = undefined;
  }

  async ask(): Promise<void> {
    const question = this.question.trim();
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

  async generate(): Promise<void> {
    if (!this.canGenerate()) return;
    this.generating.set(true);
    this.reportError.set(null);
    this.report.set(null);
    try {
      this.report.set(await this.api.report(this.from, this.to));
    } catch (failure) {
      this.reportError.set(assistantError(failureView(failure)));
    } finally {
      this.generating.set(false);
    }
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
