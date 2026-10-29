import {
  Body,
  Catch,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  UseFilters,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { ReadAgenda } from '../../application/read-agenda.js';
import {
  RequireAgenda,
  type AuthenticatedRequest,
} from '../auth/auth-policy.js';
import { EmployeeError, object, only } from '../../domain/employee.js';

@Catch(EmployeeError)
export class AgendaErrorFilter implements ExceptionFilter {
  catch(error: EmployeeError, host: ArgumentsHost) {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(error.status)
      .json({
        statusCode: error.status,
        code: error.code,
        message:
          error.status === 503
            ? 'Service unavailable'
            : 'Agenda request failed',
      });
  }
}

@Controller('agenda')
@RequireAgenda()
@UseFilters(AgendaErrorFilter)
export class AgendaController {
  constructor(@Inject(ReadAgenda) private readonly agenda: ReadAgenda) {}

  @Get('context')
  context(@Req() request: AuthenticatedRequest, @Query() input: unknown) {
    return this.agenda.contextQuery(request.identity, input);
  }

  @Get('team/employees')
  employees(@Req() request: AuthenticatedRequest, @Query() input: unknown) {
    return this.agenda.teamEmployees(request.identity, input);
  }

  @Post('assignments/check')
  @HttpCode(200)
  check(
    @Req() request: AuthenticatedRequest,
    @Body() input: unknown,
    @Query() parameters: unknown,
  ) {
    only(object(parameters), []);
    return this.agenda.check(request.identity, input);
  }
}
