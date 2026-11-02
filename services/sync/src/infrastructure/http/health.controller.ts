/** Liveness and readiness. Ready means the coordinator store (DynamoDB) answered. */
import { Controller, Get, Inject } from '@nestjs/common';

import type { OverlayRepository } from '../../application/ports.js';

@Controller('health')
export class HealthController {
  constructor(
    @Inject('OVERLAY_REPOSITORY') private readonly repository: OverlayRepository,
  ) {}

  @Get('live')
  live(): { status: string; service: string } {
    return { status: 'UP', service: 'sync' };
  }

  @Get('ready')
  async ready() {
    const healthy = await this.repository.ready();
    return { status: healthy ? 'UP' : 'DOWN', service: 'sync', store: healthy ? 'dynamodb' : 'unavailable' };
  }
}
