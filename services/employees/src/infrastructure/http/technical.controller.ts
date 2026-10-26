import { Controller, Get, Req } from '@nestjs/common';
import { RequireRoles, WORKSHOP_ROLES, type AuthenticatedRequest } from '../auth/auth-policy.js';

@Controller('technical')
export class TechnicalController {
  @Get('session')
  @RequireRoles(...WORKSHOP_ROLES)
  session(@Req() request: AuthenticatedRequest) {
    return { resource: 'session', service: 'employees', subject: request.identity.subject, roles: request.identity.roles };
  }

  @Get('admin')
  @RequireRoles('administrador')
  admin() {
    return { resource: 'admin', service: 'employees', authorized: true };
  }
}
