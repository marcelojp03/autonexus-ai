import { Component, ViewEncapsulation } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'anx-employees-root',
  imports: [RouterOutlet],
  encapsulation: ViewEncapsulation.ShadowDom,
  template: `<link rel="stylesheet" href="/mfs/employees/styles.css" />
    <section class="workspace" aria-label="Empleados">
      <h1>Empleados</h1>
      <p class="description">Componentes de demostración de NG-ALAIN. Sin datos ni operaciones del taller.</p>
      <router-outlet />
    </section>`,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
        color: #262626;
        font:
          14px/1.5 -apple-system,
          BlinkMacSystemFont,
          'Segoe UI',
          sans-serif;
      }
    .workspace {
      padding: 24px;
    }
    /* The template title assumes LayoutBasic padding; this host owns its spacing. */
    .workspace .alain-default__content-title {
      margin: 0 0 24px;
      padding: 0 0 16px;
    }
      h1 {
        font-size: 24px;
        font-weight: 600;
        margin: 0 0 8px;
      }
      .description {
        margin: 0 0 24px;
        color: #595959;
      }
      @media (max-width: 640px) {
        .workspace {
          padding: 16px;
        }
      }
    `
  ]
})
export class IntegratedApp {}
