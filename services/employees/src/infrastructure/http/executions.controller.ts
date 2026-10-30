import {
  Body,
  Catch,
  Controller,
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
import { AuthorizeExecution } from '../../application/authorize-execution.js';
import {
  RequireAuthenticated,
  type AuthenticatedRequest,
} from '../auth/auth-policy.js';
import { EmployeeError, object, only } from '../../domain/employee.js';

@Catch(EmployeeError)
export class ExecutionErrorFilter implements ExceptionFilter {
  catch(error: EmployeeError, host: ArgumentsHost) {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(error.status)
      .json({
        statusCode: error.status,
        code: error.code,
        message: error.status === 503 ? 'Service unavailable' : 'Execution request failed',
      });
  }
}

/**
 * CU16 identity surface consumed by Operations over the internal API. It is read-only: it
 * resolves the linked actor and the current assignment state, nothing else.
 */
@Controller('executions')
@RequireAuthenticated()
@UseFilters(ExecutionErrorFilter)
export class ExecutionsController {
  constructor(
    @Inject(AuthorizeExecution) private readonly authorize: AuthorizeExecution,
  ) {}

  @Post('authorize')
  @HttpCode(200)
  authorizeExecution(
    @Req() request: AuthenticatedRequest,
    @Body() input: unknown,
    @Query() parameters: unknown,
  ) {
    only(object(parameters), []);
    return this.authorize.authorize(request.identity, input);
  }
}
