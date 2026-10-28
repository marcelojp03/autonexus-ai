import { Controller, Get, Req } from '@nestjs/common';
import { RequireAuthenticated, RequirePermissions, type AuthenticatedRequest } from '../auth/auth-policy.js';

@Controller('technical')
export class TechnicalController {
  /** CU01 diagnostic shape is fixed: permissions are published by /security/permissions. */
  @Get('session')
  @RequireAuthenticated()
  session(@Req() request: AuthenticatedRequest) {
    return {
      resource: 'session',
      service: 'employees',
      subject: request.identity.subject,
      roles: request.identity.roles,
    };
  }

  @Get('admin')
  @RequirePermissions('security:write')
  admin() {
    return { resource: 'admin', service: 'employees', authorized: true };
  }
}
