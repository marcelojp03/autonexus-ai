import { HttpInterceptorFn } from '@angular/common/http';
import { InjectionToken, inject } from '@angular/core';

/** Standalone assets stay relative; integrated assets belong to their MF. */
export const ASSET_BASE = new InjectionToken<string>('ASSET_BASE', { factory: () => './' });
export const INTEGRATION_HOST = new InjectionToken<HTMLElement>('INTEGRATION_HOST');
export const INTEGRATED_MODE = new InjectionToken<boolean>('INTEGRATED_MODE', { factory: () => false });
export const integratedAssetInterceptor: HttpInterceptorFn = (request, next) => {
  const base = inject(ASSET_BASE);
  if (/^(?:\.\/|\/)?assets\//.test(request.url)) {
    const path = request.url.replace(/^(?:\.\/|\/)/, '');
    return next(request.clone({ url: new URL(base + path, window.location.origin).href }));
  }
  return next(request);
};
