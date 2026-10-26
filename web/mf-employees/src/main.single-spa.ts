import type { IntegratedProps } from '../../../contracts/auth/session';
import { SESSION_PORT } from './app/auth/session';
import { canPresentSession } from './app/auth/session-policy';
import { APP_BASE_HREF } from '@angular/common';
import { OverlayContainer } from '@angular/cdk/overlay';
import { APP_ID, ApplicationRef, PlatformRef } from '@angular/core';
import { createApplication, platformBrowser, Title } from '@angular/platform-browser';
import { NavigationStart, Router } from '@angular/router';
import { AppProps, LifeCycleFn } from 'single-spa';
import { provideSingleSpaPlatform, singleSpaAngular } from 'single-spa-angular';
import { createAppConfig } from './app/app.config';
import { IntegratedApp } from './app/integration/app';
import { ASSET_BASE, INTEGRATION_HOST, INTEGRATED_MODE } from './app/integration/asset-base';
import { IntegratedOverlayContainer } from './app/integration/overlay-container';

type IntegrationProps = IntegratedProps;
let platform: PlatformRef | undefined;
let mountedApp: ApplicationRef | undefined;

const lifecycles = singleSpaAngular<IntegrationProps>({
  NgZone: 'noop',
  Router,
  NavigationStart,
  template: '<anx-employees-root></anx-employees-root>',
  bootstrapFunction: async props => {
    if (props.basePath !== '/employees' || props.assetBase !== '/mfs/employees/') {
      throw new Error('Unexpected employees integration URLs');
    }
    if (!props.session || !canPresentSession(props.session.snapshot())) throw new Error('OIDC authenticated workshop session required');
    const host = props.domElement.querySelector<HTMLElement>('anx-employees-root');
    if (!host) throw new Error('Missing employees mount container');
    platform = platformBrowser(provideSingleSpaPlatform());
    try {
      const config = createAppConfig(true);
      mountedApp = await createApplication(
        {
          providers: [
            ...config.providers,
            { provide: SESSION_PORT, useValue: props.session },
            { provide: APP_BASE_HREF, useValue: props.basePath },
            { provide: APP_ID, useValue: 'anx-employees' },
            { provide: ASSET_BASE, useValue: props.assetBase },
        { provide: INTEGRATED_MODE, useValue: true },
        // Delon updates Title asynchronously; only the Shell owns the document title.
        { provide: Title, useFactory: () => ({ getTitle: () => document.title, setTitle: () => undefined }) },
            { provide: INTEGRATION_HOST, useValue: host },
            { provide: OverlayContainer, useClass: IntegratedOverlayContainer }
          ]
        },
        { platformRef: platform }
      );
      if (!canPresentSession(props.session.snapshot())) throw new Error('Session changed during mount');
      mountedApp.bootstrap(IntegratedApp, host);
      return mountedApp;
    } catch (error) {
      mountedApp?.destroy();
      mountedApp = undefined;
      platform.destroy();
      platform = undefined;
      throw error;
    }
  }
});

export const bootstrap = lifecycles.bootstrap;
async function runLifecycle(
  hook: LifeCycleFn<IntegrationProps> | LifeCycleFn<IntegrationProps>[],
  props: AppProps & IntegrationProps
): Promise<void> {
  for (const callback of Array.isArray(hook) ? hook : [hook]) await callback(props);
}
export async function mount(props: AppProps & IntegrationProps): Promise<void> {
  if (!props.session || !canPresentSession(props.session.snapshot())) throw new Error('OIDC authenticated workshop session required');
  try {
    await runLifecycle(lifecycles.mount, props);
    const link = props.domElement.querySelector('anx-employees-root')?.shadowRoot?.querySelector('link');
    if (!link) throw new Error('Missing integrated stylesheet');
    if (!link.sheet)
      await new Promise<void>((resolve, reject) => {
        link.addEventListener('load', () => resolve(), { once: true });
        link.addEventListener('error', () => reject(new Error('Cannot load employees stylesheet')), { once: true });
      });
  } catch (error) {
    await unmount(props);
    throw error;
  }
}
export async function unmount(props: AppProps & IntegrationProps): Promise<void> {
  try {
    if (mountedApp) await runLifecycle(lifecycles.unmount, props);
  } finally {
    mountedApp = undefined;
    platform?.destroy();
    platform = undefined;
    props.domElement.replaceChildren();
  }
}
