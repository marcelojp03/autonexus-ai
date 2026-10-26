import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { default as ngLang } from '@angular/common/locales/zh';
import {
  ApplicationConfig,
  EnvironmentProviders,
  provideBrowserGlobalErrorListeners,
  Provider,
  provideZonelessChangeDetection
} from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withHashLocation,
  RouterFeatures,
  withViewTransitions
} from '@angular/router';
import { I18NService, defaultInterceptor, provideBindAuthRefresh, provideStartup } from '@core';
import { provideCellWidgets } from '@delon/abc/cell';
import { provideSTWidgets } from '@delon/abc/st';
import { authSimpleInterceptor, provideAuth, withMemoryStorage } from '@delon/auth';
import { provideSFConfig } from '@delon/form';
import { AlainProvideLang, provideAlain, zh_CN as delonLang } from '@delon/theme';
import { AlainConfig } from '@delon/util/config';
import * as MOCKDATA from '@_mock';
import { mockInterceptor, provideMockConfig } from '@delon/mock';
import { environment } from '@env/environment';
import { CELL_WIDGETS, SF_WIDGETS, ST_WIDGETS } from '@shared';
import { zhCN as dateLang } from 'date-fns/locale';
import { NzConfig, provideNzConfig } from 'ng-zorro-antd/core/config';
import { zh_CN as zorroLang } from 'ng-zorro-antd/i18n';

import { ICONS } from '../style-icons';
import { ICONS_AUTO } from '../style-icons-auto';
import { DEMO_MODE, sessionGuard } from './auth/session';
import { LayoutBasic } from './layout';
import { routes } from './routes/routes';
import { integratedRoutes } from './integration/routes';
import { integratedAssetInterceptor } from './integration/asset-base';

const defaultLang: AlainProvideLang = {
  abbr: 'zh-CN',
  ng: ngLang,
  zorro: zorroLang,
  date: dateLang,
  delon: delonLang
};

const alainConfig: AlainConfig = {
  st: { modal: { size: 'lg' } },
  auth: { login_url: '/passport/login' }
};

const ngZorroConfig: NzConfig = {};

export function createAppConfig(integrated = false, demo = false): ApplicationConfig {
  const routerFeatures: RouterFeatures[] = integrated
    ? [withComponentInputBinding()]
    : [withComponentInputBinding(), withViewTransitions(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })];
  if (!integrated && environment.useHash) routerFeatures.push(withHashLocation());

  const providers: Array<Provider | EnvironmentProviders> = [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideHttpClient(
      withInterceptors([
        mockInterceptor,
        ...(integrated ? [integratedAssetInterceptor] : []),
        ...(demo ? [authSimpleInterceptor, defaultInterceptor] : [])
      ])
    ),
    { provide: DEMO_MODE, useValue: demo },
    provideRouter(demo ? routes : integrated ? integratedRoutes : [{ path: '', component: LayoutBasic, canActivate: [sessionGuard], canActivateChild: [sessionGuard], children: integratedRoutes }], ...routerFeatures),
    provideAlain({ config: alainConfig, defaultLang, i18nClass: I18NService, icons: [...ICONS_AUTO, ...ICONS] }),
    provideNzConfig(ngZorroConfig),
    provideAuth(withMemoryStorage()),
    provideCellWidgets(...CELL_WIDGETS),
    provideSTWidgets(...ST_WIDGETS),
    provideSFConfig({ widgets: SF_WIDGETS }),
    provideStartup(),
    provideMockConfig({ data: demo ? MOCKDATA : {
      CHARTS: MOCKDATA.CHARTS,
      PRESENTATION: { '/api/notice': MOCKDATA.APIS['/api/notice'], '/api/activities': MOCKDATA.APIS['/api/activities'] }
    } })
  ];

  // If you use `@delon/auth` to refresh the token, additional registration `provideBindAuthRefresh` is required
  if (demo && environment.api?.refreshTokenEnabled && environment.api.refreshTokenType === 'auth-refresh') {
    providers.push(provideBindAuthRefresh());
  }

  return { providers };
}

export const appConfig: ApplicationConfig = createAppConfig();
