import type { ReadinessProbe } from './readiness-probe.js';

export type ReadinessStatus = { status: 'UP' | 'DOWN' };

export class CheckReadiness {
  constructor(private readonly probe: ReadinessProbe) {}

  async execute(): Promise<ReadinessStatus> {
    try {
      await this.probe.check();
      return { status: 'UP' };
    } catch {
      return { status: 'DOWN' };
    }
  }
}
