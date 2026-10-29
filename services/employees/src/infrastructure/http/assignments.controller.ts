import {
  Body,
  Catch,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseFilters,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { ManageAssignments } from '../../application/manage-assignments.js';
import { EmployeeError } from '../../domain/employee.js';
import { ScheduleError } from '../../domain/schedule.js';
import { RequireCu15, type AuthenticatedRequest } from '../auth/auth-policy.js';

@Catch(EmployeeError, ScheduleError)
export class Cu15ErrorFilter implements ExceptionFilter {
  catch(error: EmployeeError | ScheduleError, host: ArgumentsHost) {
    const status =
      error instanceof EmployeeError ? error.status : error.statusCode;
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({
        statusCode: status,
        message: status === 503 ? 'Service unavailable' : 'CU15 request failed',
        code: error.code,
      });
  }
}
@Controller('internal/cu15')
@UseFilters(Cu15ErrorFilter)
export class AssignmentsController {
  constructor(
    @Inject(ManageAssignments) private readonly assignments: ManageAssignments,
  ) {}
  @Post('assignments/:sagaId/reserve')
  @RequireCu15('cu15.staffing.reserve')
  async reserve(
    @Param('sagaId') id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.assignments.execute(
      id,
      'reserve_assignment',
      body,
      req.identity.clientId!,
    );
    res.status(result.outcome === 'rejected' ? 409 : 200);
    return result;
  }
  @Post('assignments/:sagaId/confirm')
  @RequireCu15('cu15.staffing.confirm')
  async confirm(
    @Param('sagaId') id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.assignments.execute(
      id,
      'confirm_assignment',
      body,
      req.identity.clientId!,
    );
    res.status(result.outcome === 'rejected' ? 409 : 200);
    return result;
  }
  @Post('assignments/:sagaId/release')
  @RequireCu15('cu15.staffing.release')
  async release(
    @Param('sagaId') id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.assignments.execute(
      id,
      'release_assignment',
      body,
      req.identity.clientId!,
    );
    res.status(result.outcome === 'rejected' ? 409 : 200);
    return result;
  }
  @Get('assignments/:sagaId')
  @RequireCu15('cu15.staffing.read')
  get(@Param('sagaId') id: string) {
    return this.assignments.get(id);
  }
  @Get('operations/:operationId')
  @RequireCu15('cu15.staffing.read')
  operation(@Param('operationId') id: string) {
    return this.assignments.operation(id);
  }
}
