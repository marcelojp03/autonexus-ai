import { Body, Catch, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Req, UseFilters, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { ManageSecurity } from '../../application/manage-security.js';
import { SecurityError } from '../../domain/security.js';
import { RequireAuthenticated, RequirePermissions, type AuthenticatedRequest } from '../auth/auth-policy.js';

const messages: Record<number, string> = {
  400: 'Invalid security request',
  404: 'Security record not found',
  409: 'Security conflict',
  503: 'Service unavailable',
};

@Catch(SecurityError)
class SecurityErrorFilter implements ExceptionFilter {
  catch(error: SecurityError, host: ArgumentsHost) {
    host.switchToHttp().getResponse<{ status: (code: number) => { json: (body: unknown) => void } }>()
      .status(error.statusCode)
      .json({ statusCode: error.statusCode, message: messages[error.statusCode] ?? 'Security error', code: error.code });
  }
}

/** Read operations require security:read; every mutation requires security:write. */
@Controller('security')
@RequirePermissions('security:read')
@UseFilters(SecurityErrorFilter)
export class SecurityController {
  constructor(@Inject(ManageSecurity) private readonly security: ManageSecurity) {}

  /** Self-diagnostic consumed by the web client and by the BFF permission policy. */
  @Get('permissions')
  @RequireAuthenticated()
  catalog(@Req() request: AuthenticatedRequest) {
    return this.security.catalog(request.identity.subject, request.identity.roles);
  }

  @Get('roles')
  roles() {
    return this.security.roles();
  }

  @Get('roles/:name')
  role(@Param('name') name: string) {
    return this.security.role(name);
  }

  @Post('roles')
  @RequirePermissions('security:write')
  createRole(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.security.createRole(body, request.identity.subject, request.identity.permissions);
  }

  @Put('roles/:name')
  @HttpCode(200)
  @RequirePermissions('security:write')
  updateRole(@Param('name') name: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.security.updateRole(name, body, request.identity.subject, request.identity.permissions);
  }

  @Post('roles/:name/retry-sync')
  @HttpCode(200)
  @RequirePermissions('security:write')
  retryRoleSync(@Param('name') name: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.security.retryRoleSync(name, body, request.identity.subject);
  }

  @Get('employees/:id/roles')
  employeeRoles(@Param('id') id: string) {
    return this.security.employeeRoles(id);
  }

  @Post('employees/:id/roles')
  @RequirePermissions('security:write')
  assignRole(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.security.assignRole(id, body, request.identity.subject);
  }

  @Post('employees/:id/roles/:roleName/revoke')
  @HttpCode(200)
  @RequirePermissions('security:write')
  revokeRole(@Param('id') id: string, @Param('roleName') roleName: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.security.revokeRole(id, roleName, body, request.identity.subject);
  }

  @Get('history')
  history(@Query() query: Record<string, unknown>) {
    return this.security.history(normalize(query));
  }
}

/** Query strings arrive as text; only canonical non-negative decimals are converted. */
function normalize(query: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...query };
  for (const key of ['limit', 'offset'] as const) {
    const value = result[key];
    if (typeof value === 'string' && /^\d{1,10}$/.test(value)) result[key] = Number(value);
  }
  return result;
}
