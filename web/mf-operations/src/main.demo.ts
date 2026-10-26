import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { createAppConfig } from './app/app.config';
bootstrapApplication(App, createAppConfig(false, true)).catch(() => { document.querySelector('app-root')!.textContent = 'No se pudo iniciar la demostración. Recarga para reintentar.'; });
