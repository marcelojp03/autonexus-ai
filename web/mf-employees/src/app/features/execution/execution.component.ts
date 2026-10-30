import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzPageHeaderModule } from 'ng-zorro-antd/page-header';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { ExecutionApi } from './execution-api';
import {
  canUpload,
  evidenceType,
  executionError,
  mayWriteExecution,
  type AgendaWorkRef,
  type Execution,
  type ExecutionAdvance,
  type ExecutionEvidence,
} from './execution.contract';

/** CU16 mechanic screen: start the work, record advances and attach evidence. Never finalises (CU17). */
@Component({
  selector: 'app-execution',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzAlertModule,
    NzButtonModule,
    NzCardModule,
    NzEmptyModule,
    NzInputModule,
    NzInputNumberModule,
    NzPageHeaderModule,
    NzSelectModule,
    NzTableModule,
    NzTagModule,
  ],
  templateUrl: './execution.component.html',
  styles: [
`
    :host { display: block; }
    nz-page-header, nz-card, nz-alert { display: block; margin-bottom: 16px; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin: 16px 0; }
    .field { display: flex; flex-direction: column; gap: 4px; color: rgba(0, 0, 0, 0.65); font-size: 14px; }
    .wide { width: min(100%, 560px); }
    .hint { margin: 12px 0 0; color: #595959; }
    .advance { padding: 14px 0; border-bottom: 1px solid #f0f0f0; }
    .when { margin-inline-start: 12px; color: #595959; font-variant-numeric: tabular-nums; }
    .file, .failure { margin-inline-end: 12px; overflow-wrap: anywhere; }
    .failure { color: #a8071a; }
    .attach { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; margin-top: 12px; }
    .step { flex-basis: 100%; color: #595959; }
    @media (max-width: 640px) {
      .toolbar .field { flex: 1 1 150px; min-width: 0; }
      input { font-size: 16px; }
      .advance { overflow-wrap: anywhere; }
    }
`
  ],
})
export class ExecutionComponent implements OnInit {
  private readonly api = inject(ExecutionApi);
  private readonly route = inject(ActivatedRoute);

  readonly works = signal<readonly AgendaWorkRef[]>([]);
  readonly actorEmployeeId = signal<string | null>(null);
  readonly scope = signal<"me" | "team">("me");
  readonly canWrite = signal(false);
  readonly selectedWork = signal<AgendaWorkRef | null>(null);
  readonly execution = signal<Execution | null>(null);
  readonly selected = signal<string | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly description = signal('');
  readonly minutes = signal(30);
  readonly file = signal<File | null>(null);
  readonly evidenceState = signal<Record<string, string>>({});

  readonly canWriteSelected = computed(() => {
    return mayWriteExecution(this.selectedWork(), this.actorEmployeeId(), this.canWrite());
  });
  readonly canStart = computed(() => this.canWriteSelected() && this.execution() === null && this.selected() !== null);
  readonly canRegister = computed(() => this.canWriteSelected() && this.execution() !== null && !this.busy());
  readonly latestAdvance = computed<ExecutionAdvance | null>(() => {
    const value = this.execution();
    return value && value.advances.length ? value.advances[value.advances.length - 1] : null;
  });

  ngOnInit(): void {
    void this.load();
  }

  private today(): { from: string; to: string } {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/La_Paz", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const now = new Date(Number(values["year"]), Number(values["month"]) - 1, Number(values["day"]));
    const format = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30);
    return { from: format(now), to: format(to) };
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const { from, to } = this.today();
      const permissions = await this.api.permissions();
      this.canWrite.set(permissions.effective.includes("executions:write"));
      const team = permissions.effective.includes("executions:read:team");
      this.scope.set(team ? "team" : "me");
      const page = team ? await this.api.teamWorks(from, to) : await this.api.myWorks(from, to);
      this.actorEmployeeId.set(page.actor.employeeId);
      const items = [...(page.items ?? [])];
      const requestedId = this.route.snapshot.queryParamMap.get('assignmentId');
      if (requestedId && !items.some(work => work.assignmentId === requestedId)) {
        try { items.unshift(await this.api.work(team ? 'team' : 'me', requestedId)); }
        catch (failure) {
          this.works.set(items);
          this.error.set(executionError(failureView(failure)));
          return;
        }
      }
      this.works.set(items);
      if (requestedId) await this.select(requestedId);
    } catch (failure) {
      this.error.set(executionError(failureView(failure)));
    } finally {
      this.loading.set(false);
    }
  }

  async select(assignmentId: string): Promise<void> {
    this.selected.set(assignmentId);
    const selected = this.works().find(work => work.assignmentId === assignmentId) ?? null;
    this.selectedWork.set(selected);
    this.execution.set(null);
    this.notice.set(null);
    this.error.set(null);
    if (!assignmentId) return;
    this.loading.set(true);
    try {
      if (selected?.executionStatus === 'in_progress') this.execution.set(await this.api.execution(this.scope(), assignmentId));
    } catch (failure) {
      const code = failureView(failure).code;
      // A work without execution yet is the normal starting point, not an error.
      if (code !== 'EXECUTION_WORK_NOT_FOUND') this.error.set(executionError({ code }));
    } finally {
      this.loading.set(false);
    }
  }

  async start(): Promise<void> {
    const assignmentId = this.selected();
    if (!assignmentId || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.api.start(assignmentId, crypto.randomUUID());
      this.execution.set(result.execution);
      this.notice.set('Ejecución iniciada. Registrá los avances del trabajo.');
      await this.load();
    } catch (failure) {
      this.error.set(executionError(failureView(failure)));
    } finally {
      this.busy.set(false);
    }
  }

  async registerAdvance(): Promise<void> {
    const assignmentId = this.selected();
    const current = this.execution();
    if (!assignmentId || !current || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.api.advance(
        assignmentId,
        crypto.randomUUID(),
        current.version,
        this.description(),
        this.minutes(),
      );
      this.execution.set(result.execution);
      this.description.set('');
      this.notice.set('Avance registrado.');
    } catch (failure) {
      this.error.set(executionError(failureView(failure)));
    } finally {
      this.busy.set(false);
    }
  }

  chooseFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files[0] ? input.files[0] : null;
    this.error.set(null);
    if (!file) {
      this.file.set(null);
      return;
    }
    const type = evidenceType(file);
    if (!canUpload(type, file.size)) {
      this.file.set(null);
      this.error.set('Archivo no permitido: usá JPEG, PNG, WEBP hasta 5 MiB o MP4 hasta 20 MiB.');
      return;
    }
    this.file.set(file);
  }

  /** Three honest stages: pending authorization, uploaded bytes, confirmed evidence. */
  async attachEvidence(advance: ExecutionAdvance): Promise<void> {
    const assignmentId = this.selected();
    const file = this.file();
    const type = file ? evidenceType(file) : null;
    if (!assignmentId || !file || !type || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    this.setState(advance.id, 'Cargando…');
    try {
      const bytes = await file.arrayBuffer();
      const checksum = await sha256Base64(bytes);
      const request = await this.api.requestEvidence(assignmentId, advance.id, crypto.randomUUID(), {
        fileName: file.name,
        contentType: type,
        sizeBytes: file.size,
        checksumSha256: checksum,
      });
      this.setState(advance.id, 'Carga pendiente: transfiriendo al almacenamiento…');
      const uploaded = await this.api.upload(request, bytes);
      if (!uploaded.completed) {
        this.setState(advance.id, 'Carga no confirmada: consultando el almacenamiento…');
        let finalState = 'Carga pendiente; todavía no es evidencia confirmada.';
        try {
          const verification = await this.api.confirmEvidence(assignmentId, request.evidence.id, crypto.randomUUID(), request.evidence.version);
          finalState = verification.evidence.state === 'failed' ? 'Carga fallida; seleccioná un archivo para reintentar.' : 'Evidencia confirmada tras verificar el objeto existente.';
        } catch { /* A storage timeout is pending, never a claimed success. */ }
        this.setState(advance.id, finalState);
        this.error.set('No se pudo confirmar la transferencia al almacenamiento privado. Actualizá antes de reintentar.');
        return;
      }
      this.setState(advance.id, 'Verificando la evidencia en el servidor…');
      await this.api.confirmEvidence(assignmentId, request.evidence.id, crypto.randomUUID(), request.evidence.version);
      this.setState(advance.id, 'Evidencia confirmada.');
      this.file.set(null);
      this.execution.set(await this.api.execution(this.scope(), assignmentId));
      await this.load();
    } catch (failure) {
      const code = failureView(failure).code;
      this.setState(advance.id, 'Sin confirmar.');
      this.error.set(executionError({ code }));
    } finally {
      this.busy.set(false);
    }
  }

  private setState(advanceId: string, value: string): void {
    this.evidenceState.update((state) => ({ ...state, [advanceId]: value }));
  }

  stateOf(advanceId: string): string | null {
    return this.evidenceState()[advanceId] ?? null;
  }

  evidenceLabel(evidence: ExecutionEvidence): string {
    if (evidence.state === 'available') return 'Confirmada';
    if (evidence.state === 'failed') return 'Fallida';
    return 'Pendiente';
  }

  evidenceTag(evidence: ExecutionEvidence): string {
    if (evidence.state === 'available') return 'success';
    if (evidence.state === 'failed') return 'error';
    return 'warning';
  }

  async downloadEvidence(evidence: ExecutionEvidence): Promise<void> {
    const assignmentId = this.selected();
    if (!assignmentId || evidence.state !== "available") return;
    this.error.set(null);
    try {
      const link = await this.api.evidenceDownload(this.scope(), assignmentId, evidence.id);
      window.open(link.url, "_blank", "noopener,noreferrer");
    } catch (failure) {
      this.error.set(executionError(failureView(failure)));
    }
  }

  async verifyEvidence(evidence: ExecutionEvidence): Promise<void> {
    const assignmentId = this.selected();
    if (!assignmentId || evidence.state !== "pending" || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.api.confirmEvidence(assignmentId, evidence.id, crypto.randomUUID(), evidence.version);
      this.setState(evidence.advanceId, result.evidence.state === "available" ? "Evidencia confirmada." : "Carga fallida; seleccioná un archivo para reintentar.");
      this.execution.set(await this.api.execution(this.scope(), assignmentId));
    } catch (failure) {
      this.error.set(executionError(failureView(failure)));
    } finally {
      this.busy.set(false);
    }
  }

  async retryEvidence(evidence: ExecutionEvidence): Promise<void> {
    const assignmentId = this.selected();
    const file = this.file();
    const type = file ? evidenceType(file) : null;
    if (!assignmentId || !file || !type || evidence.state !== "failed" || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const bytes = await file.arrayBuffer();
      const checksum = await sha256Base64(bytes);
      const request = await this.api.retryEvidence(assignmentId, evidence.id, crypto.randomUUID(), evidence.version, file.name, type, file.size, checksum);
      this.setState(evidence.advanceId, "Reintentando carga pendiente…");
      const result = await this.api.upload(request, bytes);
      if (!result.completed) {
        this.setState(evidence.advanceId, "Carga fallida; no está disponible para descarga.");
        return;
      }
      await this.api.confirmEvidence(assignmentId, evidence.id, crypto.randomUUID(), request.evidence.version);
      this.setState(evidence.advanceId, "Evidencia confirmada.");
      this.file.set(null);
      this.execution.set(await this.api.execution(this.scope(), assignmentId));
    } catch (failure) {
      this.setState(evidence.advanceId, "Carga pendiente o fallida; no confirmada.");
      this.error.set(executionError(failureView(failure)));
    } finally {
      this.busy.set(false);
    }
  }

  time(value: string | null): string {
    if (!value) return '—';
    return new Intl.DateTimeFormat('es-BO', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/La_Paz' }).format(new Date(value));
  }
}

async function sha256Base64(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const binary = Array.from(new Uint8Array(digest), (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary);
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
