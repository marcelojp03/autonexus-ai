import { computed, DestroyRef, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import type { SessionPort, SessionSnapshot } from '../../../../../contracts/auth/session';
import { canPresentSession } from './session-policy';

export const SESSION_PORT = new InjectionToken<SessionPort>('AutoNexus SessionPort');
export const DEMO_MODE = new InjectionToken<boolean>('Explicit demo mode', { factory: () => false });

@Injectable({ providedIn: 'root' })
export class SessionView {
  readonly demo = inject(DEMO_MODE);
  readonly port = inject(SESSION_PORT, { optional: true });
  readonly snapshot = signal<Readonly<SessionSnapshot>>({ mode: 'oidc', phase: 'initializing', authenticated: false, identity: null });
  readonly allowed = computed(() => this.demo || canPresentSession(this.snapshot()));
  constructor() {
    if (this.demo) {
      this.snapshot.set({ mode: 'demo', phase: 'demo', authenticated: false, identity: null });
    } else {
      if (!this.port) throw new Error('OIDC requires SessionPort');
      this.snapshot.set(this.port.snapshot());
      inject(DestroyRef).onDestroy(this.port.subscribe(state => this.snapshot.set(state)));
    }
  }
}
export const sessionGuard: CanActivateFn = () => inject(SessionView).allowed();
export const businessSessionGuard: CanActivateFn = () => !inject(DEMO_MODE);
