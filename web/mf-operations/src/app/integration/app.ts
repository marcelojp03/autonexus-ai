import { Component, ViewEncapsulation } from '@angular/core';
import { SessionView } from '../auth/session';
import { inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'anx-operations-root',
  imports: [RouterOutlet],
  encapsulation: ViewEncapsulation.ShadowDom,
  template: `<link rel="stylesheet" href="/mfs/operations/styles.css" />
    <section class="workspace" aria-label="Operaciones">
      @if (session.allowed()) { <router-outlet /> }
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
      padding: clamp(18px, 3vw, 32px);
      max-width: 1440px;
      margin: 24px auto;
      background: #fff;
      border: 1px solid #e1e8ef;
      border-radius: 16px;
      box-shadow: 0 4px 24px #18344906;
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
          margin: 12px;
          border-radius: 12px;
        }
      }
    `
  ]
})
export class IntegratedApp { readonly session = inject(SessionView); }
