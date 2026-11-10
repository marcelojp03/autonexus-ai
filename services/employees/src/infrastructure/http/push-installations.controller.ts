import { Body, Controller, Delete, Inject, Post, Req, UseFilters } from '@nestjs/common';
import { ManagePushInstallation } from '../../application/manage-push-installation.js';
import { RequireAuthenticated, type AuthenticatedRequest } from '../auth/auth-policy.js';
import { AgendaErrorFilter } from './agenda.controller.js';

@Controller('push/installations')
@RequireAuthenticated()
@UseFilters(AgendaErrorFilter)
export class PushInstallationsController {
  constructor(@Inject(ManagePushInstallation) private readonly installations: ManagePushInstallation) {}

  @Post()
  async register(@Req() request: AuthenticatedRequest, @Body() body: unknown): Promise<{registered: true}> {
    await this.installations.register(request.identity.subject, body);
    return { registered: true };
  }

  @Delete()
  async unregister(@Req() request: AuthenticatedRequest, @Body() body: unknown): Promise<{removed: true}> {
    await this.installations.unregister(request.identity.subject, body);
    return { removed: true };
  }
}
