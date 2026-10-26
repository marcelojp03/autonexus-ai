import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DEMO_MODE, SESSION_PORT } from '../../../auth/session';
import { Router, RouterLink } from '@angular/router';
import { DA_SERVICE_TOKEN } from '@delon/auth';
import { I18nPipe, SettingsService } from '@delon/theme';
import { NzAvatarModule } from 'ng-zorro-antd/avatar';
import { NzDropdownModule } from 'ng-zorro-antd/dropdown';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMenuModule } from 'ng-zorro-antd/menu';

@Component({
  selector: 'header-user',
  template: `
    <button type="button" class="alain-default__nav-item d-flex align-items-center px-sm" nz-dropdown nzPlacement="bottomRight" [nzDropdownMenu]="userMenu">
      <nz-avatar [nzSrc]="user.avatar" nzSize="small" class="mr-sm" />
      {{ user.name }}
    </button>
    <nz-dropdown-menu #userMenu="nzDropdownMenu">
      <div nz-menu class="width-sm">
        @if (demo) { <div nz-menu-item routerLink="/pro/account/center">
          <nz-icon nzType="user" class="mr-sm" />
          {{ 'menu.account.center' | i18n }}
        </div>
        <div nz-menu-item routerLink="/pro/account/settings">
          <nz-icon nzType="setting" class="mr-sm" />
          {{ 'menu.account.settings' | i18n }}
        </div>
        <div nz-menu-item routerLink="/exception/trigger">
          <nz-icon nzType="close-circle" class="mr-sm" />
          {{ 'menu.account.trigger' | i18n }}
        </div>
        <li nz-menu-divider></li> }
        <button type="button" nz-menu-item (click)="logout()">
          <nz-icon nzType="logout" class="mr-sm" />
          {{ 'menu.account.logout' | i18n }}
        </button>
      </div>
    </nz-dropdown-menu>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, NzDropdownModule, NzMenuModule, NzIconModule, I18nPipe, NzAvatarModule]
})
export class HeaderUser {
  readonly demo = inject(DEMO_MODE);
  private readonly session = inject(SESSION_PORT, { optional: true });
  protected readonly user = inject(SettingsService).user;
  private readonly router = inject(Router);
  private readonly tokenService = inject(DA_SERVICE_TOKEN);

  protected logout(): void {
    if (!this.demo) {
      void this.session!.logout().catch(() => undefined);
      return;
    }
    this.tokenService.clear();
    this.router.navigateByUrl(this.tokenService.login_url!);
  }
}
