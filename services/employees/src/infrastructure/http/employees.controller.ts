import {
  Body,
  Catch,
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  Req,
  Inject,
  HttpCode,
  UseFilters,
  type ExceptionFilter,
  type ArgumentsHost,
} from '@nestjs/common';
import { ManageEmployees } from '../../application/manage-employees.js';
import { EmployeeError } from '../../domain/employee.js';
import {
  RequireRoles,
  type AuthenticatedRequest,
} from '../auth/auth-policy.js';
@Catch(EmployeeError)
class EmployeeErrorFilter implements ExceptionFilter {
  catch(error: EmployeeError, host: ArgumentsHost) {
    host
      .switchToHttp()
      .getResponse<{
        status: (code: number) => { json: (body: unknown) => void };
      }>()
      .status(error.status)
      .json({
        statusCode: error.status,
        message:
          error.status === 400
            ? 'Invalid employee request'
            : error.status === 404
              ? 'Employee not found'
              : error.status === 409
                ? 'Employee conflict'
                : 'Service unavailable',
        code: error.code,
      });
  }
}
@Controller('employees')
@RequireRoles('administrador')
@UseFilters(EmployeeErrorFilter)
export class EmployeesController {
  constructor(
    @Inject(ManageEmployees) private readonly employees: ManageEmployees,
  ) {}
  @Get() list(@Query() query: unknown) {
    return this.employees.list(query);
  }
  @Get(':id') get(@Param('id') id: string) {
    return this.employees.get(id);
  }
  @Get(':id/history') history(
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.employees.history(id, query);
  }
  @Post() create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.employees.mutate(
      'create',
      null,
      body,
      request.identity.subject,
    );
  }
  @Put(':id') update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.employees.mutate('update', id, body, request.identity.subject);
  }
  @Post(':id/deactivate') @HttpCode(200) deactivate(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.employees.mutate(
      'deactivate',
      id,
      body,
      request.identity.subject,
    );
  }
  @Post(':id/access/retry') @HttpCode(200) retry(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.employees.mutate('retry', id, body, request.identity.subject);
  }
}
