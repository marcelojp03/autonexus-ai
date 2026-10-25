import { OverlayContainer } from '@angular/cdk/overlay';
import { Injectable, inject } from '@angular/core';
import { INTEGRATION_HOST } from './asset-base';

/** CDK overlays share the mounted app's style boundary. */
@Injectable()
export class IntegratedOverlayContainer extends OverlayContainer {
  private readonly host = inject(INTEGRATION_HOST);
  protected override _createContainer(): void {
    const container = document.createElement('div');
    container.classList.add('cdk-overlay-container');
    if (!this.host.shadowRoot) throw new Error('Integrated ShadowRoot is not available');
    this.host.shadowRoot.appendChild(container);
    this._containerElement = container;
  }
}
