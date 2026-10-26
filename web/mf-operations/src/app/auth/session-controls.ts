import { Component, DestroyRef, inject, signal } from '@angular/core';
import type { TechnicalResource, TechnicalService } from '../../../../../contracts/auth/session';
import { SessionView } from './session';

@Component({
  selector: 'anx-session-controls',
  template: `
    <section aria-label="Sesión y diagnóstico técnico">
      <p><strong>{{ view.demo ? 'DEMO explícito — sin SSO ni APIs protegidas' : 'Sesión OIDC' }}</strong>
        · Estado: {{ view.snapshot().phase }} · Usuario: {{ view.snapshot().identity?.username || 'Sin sesión' }}</p>
      <p>Roles: {{ view.snapshot().identity?.roles?.join(', ') || 'Ninguno' }}. ACL solo de presentación; el servidor autoriza cada recurso.</p>
      <p><strong>Datos DEMO:</strong> menús, gráficos y widgets sintéticos de NG-ALAIN. No representan operaciones del taller ni integración BFF.</p>
      @if (!view.demo) {
        @if (view.allowed()) {
          <div class="actions">
            <button type="button" [disabled]="busy()" (click)="check('employees', 'session')">Sesión API Empleados</button>
            <button type="button" [disabled]="busy()" (click)="check('operations', 'session')">Sesión API Operaciones</button>
            <button type="button" [disabled]="busy()" (click)="check('employees', 'admin')">Admin API Empleados</button>
            <button type="button" [disabled]="busy()" (click)="check('operations', 'admin')">Admin API Operaciones</button>
          </div>
        } @else {
          <p role="alert">{{ view.snapshot().notice || (view.snapshot().authenticated ? 'Acceso insuficiente: no tienes un rol del taller reconocido.' : 'La sesión no está disponible. Ingresa nuevamente para continuar.') }}</p>
          @if (!view.snapshot().authenticated) {
            <button type="button" [disabled]="busy()" (click)="login()">Ingresar con Keycloak</button>
          }
        }
        <button type="button" [disabled]="busy()" (click)="logout()">Cerrar sesión en Keycloak</button>
      }
      <p role="status" aria-live="polite">{{ busy() ? 'Comprobando…' : message() }}</p>
    </section>`,
  styles: [`
    :host { display: block; min-width: 0; }
    section { padding: 16px; margin-block-end: 24px; background: #fff; color: #262626; border: 1px solid #8c8c8c; border-radius: 8px; overflow-wrap: anywhere; }
    p { margin: 0 0 12px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-block-end: 8px; }
    button { padding: 8px 12px; min-height: 44px; border: 1px solid #595959; border-radius: 4px; background: #fff; color: #262626; cursor: pointer; white-space: normal; }
    button:hover:not(:disabled) { background: #f0f5ff; }
    button:focus-visible { outline: 3px solid #0958d9; outline-offset: 3px; }
    button:disabled { opacity: .65; cursor: wait; }
    @media (max-width: 640px) { section { font-size: 16px; } }
  `]
})
export class SessionControls {
  readonly view = inject(SessionView);
  readonly busy = signal(false);
  readonly message = signal('Solo diagnósticos REST técnicos; no son operaciones empresariales.');
  private readonly destroyRef = inject(DestroyRef);
  async check(service: TechnicalService, resource: TechnicalResource): Promise<void> {
    if (this.busy() || !this.view.allowed() || this.view.demo) return;
    this.busy.set(true);
    try {
      const result = await this.view.port!.requestTechnical(service, resource);
      if (!this.destroyRef.destroyed && this.view.allowed()) this.message.set(result.resource === 'session' ? result.service + ': identidad verificada; roles: ' + result.roles.join(', ') : result.service + ': acceso técnico administrador autorizado.');
    } catch (error) {
      if (!this.destroyRef.destroyed) this.message.set(error instanceof Error ? error.message : 'No se pudo comprobar el servicio. Reintenta el diagnóstico.');
    } finally { if (!this.destroyRef.destroyed) this.busy.set(false); }
  }
  async login(): Promise<void> { await this.action(() => this.view.port!.login()); }
  async logout(): Promise<void> { await this.action(() => this.view.port!.logout()); }
  private async action(run: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try { await run(); } catch { if (!this.destroyRef.destroyed) this.message.set('No se pudo completar la acción de sesión. Inténtalo nuevamente.'); }
    finally { if (!this.destroyRef.destroyed) this.busy.set(false); }
  }
}
