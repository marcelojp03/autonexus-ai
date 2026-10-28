import { Body, Catch, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Req, UseFilters, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { ManageSchedules } from '../../application/manage-schedules.js';
import { ScheduleError } from '../../domain/schedule.js';
import { RequirePermissions, type AuthenticatedRequest } from '../auth/auth-policy.js';

const messages: Record<number, string> = {
  400: 'Invalid scheduling request',
  404: 'Scheduling record not found',
  409: 'Scheduling conflict',
  503: 'Service unavailable',
};

@Catch(ScheduleError)
class ScheduleErrorFilter implements ExceptionFilter {
  catch(error: ScheduleError, host: ArgumentsHost) {
    host.switchToHttp().getResponse<{ status: (code: number) => { json: (body: unknown) => void } }>()
      .status(error.statusCode)
      .json({ statusCode: error.statusCode, message: messages[error.statusCode] ?? 'Scheduling error', code: error.code });
  }
}

/** CU04 planning surface. Employees CRUD keeps its own administrator-only policy. */
@Controller('staffing')
@RequirePermissions('schedules:read')
@UseFilters(ScheduleErrorFilter)
export class StaffingController {
  constructor(@Inject(ManageSchedules) private readonly schedules: ManageSchedules) {}

  @Get('employees')
  employees(@Query() query: unknown) {
    return this.schedules.employees(query);
  }

  @Get('employees/:id/schedule')
  schedule(@Param('id') id: string) {
    return this.schedules.schedule(id);
  }

  @Get('employees/:id/availability')
  availability(@Param('id') id: string, @Query('date') date: string) {
    return this.schedules.availability(id, date);
  }

  @Post('employees/:id/shifts')
  @RequirePermissions('schedules:write')
  createShift(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.schedules.createShift(id, body, request.identity.subject);
  }

  @Put('shifts/:shiftId')
  @RequirePermissions('schedules:write')
  @HttpCode(200)
  updateShift(@Param('shiftId') shiftId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.schedules.updateShift(shiftId, body, request.identity.subject);
  }

  @Post('shifts/:shiftId/deactivate')
  @RequirePermissions('schedules:write')
  @HttpCode(200)
  deactivateShift(@Param('shiftId') shiftId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.schedules.deactivateShift(shiftId, body, request.identity.subject);
  }

  @Post('employees/:id/absences')
  @RequirePermissions('schedules:write')
  createAbsence(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.schedules.createAbsence(id, body, request.identity.subject);
  }

  @Post('absences/:absenceId/cancel')
  @RequirePermissions('schedules:write')
  @HttpCode(200)
  cancelAbsence(@Param('absenceId') absenceId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.schedules.cancelAbsence(absenceId, body, request.identity.subject);
  }
}
