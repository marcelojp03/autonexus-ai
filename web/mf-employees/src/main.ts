import { bootstrapApplication } from '@angular/platform-browser';
import Keycloak from 'keycloak-js';
import { createBrowserSession } from '../../browser-auth/session';
import { App } from './app/app';
import { createAppConfig } from './app/app.config';
import { SESSION_PORT } from './app/auth/session';

const owner = createBrowserSession(new Keycloak({ url: 'http://127.0.0.1:8180', realm: 'autonexus', clientId: 'autonexus-mf-employees' }), { origin: location.origin, application: 'employees' });
async function start(): Promise<void> {
  await owner.start();
  const config = createAppConfig();
  const app = await bootstrapApplication(App, { providers: [...config.providers, { provide: SESSION_PORT, useValue: owner.session }] });
  app.onDestroy(() => owner.dispose());
}
void start().catch(() => { owner.dispose(); const root = document.querySelector('app-root'); if (root) root.textContent = 'No se pudo iniciar la aplicación. Recarga para reintentar; no se activó el modo demo.'; });
