import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SessionView } from './auth/session';
import { SessionControls } from './auth/session-controls';
import { NavigationEnd, NavigationError, RouteConfigLoadStart, Router, RouterOutlet } from '@angular/router';
import { TitleService, VERSION as VERSION_ALAIN, stepPreloader } from '@delon/theme';
import { environment } from '@env/environment';
import { NzModalService } from 'ng-zorro-antd/modal';
import { VERSION as VERSION_ZORRO } from 'ng-zorro-antd/version';

@Component({
  selector: 'app-root',
  template: `@if (session.allowed()) { <router-outlet /> } @else { <main style="padding:24px"><anx-session-controls /></main> } @if (session.demo) { <p role="status" style="position:fixed;bottom:0;inset-inline:0;z-index:1100;margin:0;padding:8px;background:#fffbe6;color:#262626;border:1px solid #8c8c8c">DEMO explícito: login simulado, sin SSO ni APIs protegidas.</p> }`,
  imports: [RouterOutlet, SessionControls],
  host: {
    '[attr.ng-alain-version]': 'ngAlainVersion',
    '[attr.ng-zorro-version]': 'ngZorroVersion'
  }
})
export class App {
  readonly session = inject(SessionView);
  private readonly router = inject(Router);
  private readonly titleSrv = inject(TitleService);
  private readonly modalSrv = inject(NzModalService);
  protected ngAlainVersion = VERSION_ALAIN.full;
  protected ngZorroVersion = VERSION_ZORRO.full;

  private donePreloader = stepPreloader();

  constructor() {
    if (!this.session.allowed()) this.donePreloader();
    let configLoad = false;
    this.router.events.pipe(takeUntilDestroyed()).subscribe(ev => {
      if (ev instanceof RouteConfigLoadStart) {
        configLoad = true;
      }
      if (configLoad && ev instanceof NavigationError) {
        this.modalSrv.confirm({
          nzTitle: `提醒`,
          nzContent: environment.production ? `应用可能已发布新版本，请点击刷新才能生效。` : `无法加载路由：${ev.url}`,
          nzCancelDisabled: false,
          nzOkText: '刷新',
          nzCancelText: '忽略',
          nzOnOk: () => location.reload()
        });
      }
      if (ev instanceof NavigationEnd) {
        this.donePreloader();
        this.titleSrv.setTitle();
        this.modalSrv.closeAll();
      }
    });
  }
}
