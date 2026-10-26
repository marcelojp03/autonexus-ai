import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { CheckReadiness } from '../../application/check-readiness.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(CheckReadiness) private readonly readiness: CheckReadiness) {}

  @Get('live')
  live() {
    return { status: 'UP' };
  }

  @Get('ready')
  async ready() {
    const result = await this.readiness.execute();
    if (result.status === 'DOWN') throw new ServiceUnavailableException(result);
    return result;
  }
}
