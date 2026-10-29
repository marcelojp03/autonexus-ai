import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  UseFilters,
} from '@nestjs/common';
import { ManageSchedules } from '../../application/manage-schedules.js';
import { only, object, query } from '../../domain/employee.js';
import { RequirePermissions } from '../auth/auth-policy.js';
import { PostgresMechanicProjection } from '../postgres/postgres-mechanic-projection.js';
import { Cu15ErrorFilter } from './assignments.controller.js';
@Controller('staffing/mechanics')
@RequirePermissions('confirmations:read')
@UseFilters(Cu15ErrorFilter)
export class MechanicsController {
  constructor(
    @Inject(PostgresMechanicProjection)
    private readonly mechanics: PostgresMechanicProjection,
    @Inject(ManageSchedules) private readonly schedules: ManageSchedules,
  ) {}
  @Get()
  list(@Query() input: unknown) {
    const v = object(input);
    only(v, ['search', 'limit', 'offset']);
    return this.mechanics.page(query(v));
  }
  @Get(':id/availability')
  availability(@Param('id') id: string, @Query() input: unknown) {
    const v = object(input);
    only(v, ['date']);
    return this.schedules.availability(id, v.date);
  }
}
