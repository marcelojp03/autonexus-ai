/** REST surface of MS05 (contracts/sync/overlay.md, S2.7). */

import { Body, Catch, Controller, Get, Headers, HttpCode, Inject, Param, Post, UseFilters, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

import { SyncError, overlay as parseOverlay } from '../../domain/overlay.js';
import { PushOverlay } from '../../application/push-overlay.js';
import type { OverlayRepository } from '../../application/ports.js';
import { TokenVerifier } from '../auth/token-verifier.js';

@Catch(SyncError)
export class SyncErrorFilter implements ExceptionFilter {
  catch(error: SyncError, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(error.status)
      .json({ statusCode: error.status, code: error.code, message: error.status === 400 ? 'The request body is not valid' : 'Sync request failed' });
  }
}

const TTL_DAYS = 30;

@Controller('sync')
@UseFilters(SyncErrorFilter)
export class SyncController {
  constructor(
    private readonly verifier: TokenVerifier,
    @Inject('OVERLAY_REPOSITORY') private readonly repository: OverlayRepository,
    private readonly pushOverlay: PushOverlay,
  ) {}

  @Post('overlays')
  async create(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    const identity = await this.verifier.verify(authorization);
    const overlay = parseOverlay(body, identity.subject);
    const expiresAt = Math.floor(Date.now() / 1000) + TTL_DAYS * 86400;
    const { replayed } = await this.repository.save(overlay, expiresAt);
    const stored = await this.repository.byId(identity.subject, overlay.overlayId);
    return { overlay: this.view(stored!), replayed };
  }

  @Get('overlays/:overlayId')
  async read(@Headers('authorization') authorization: string | undefined, @Param('overlayId') overlayId: string) {
    const identity = await this.verifier.verify(authorization);
    const stored = await this.repository.byId(identity.subject, overlayId);
    // Another subject's overlay answers exactly like a missing one.
    if (!stored) throw new SyncError(404, 'OVERLAY_NOT_FOUND');
    return { overlay: this.view(stored) };
  }

  @Post('overlays/:overlayId/push')
  @HttpCode(200)
  async push(@Headers('authorization') authorization: string | undefined, @Param('overlayId') overlayId: string) {
    const identity = await this.verifier.verify(authorization);
    const stored = await this.repository.byId(identity.subject, overlayId);
    if (!stored) throw new SyncError(404, 'OVERLAY_NOT_FOUND');
    const summary = await this.pushOverlay.push(identity.subject, overlayId, identity.token);
    return { ...summary, operations: summary.operations, overlayId };
  }

  @Get('operations/:operationId')
  async operation(@Headers('authorization') authorization: string | undefined, @Param('operationId') operationId: string) {
    const identity = await this.verifier.verify(authorization);
    const stored = await this.repository.operation(identity.subject, operationId);
    if (!stored) throw new SyncError(404, 'OPERATION_NOT_FOUND');
    return { operation: stored };
  }

  private view(stored: { overlay: { overlayId: string; deviceId: string; createdAt: string; operations: unknown }; operations: unknown[] }) {
    return {
      overlayId: stored.overlay.overlayId,
      deviceId: stored.overlay.deviceId,
      createdAt: stored.overlay.createdAt,
      operations: stored.operations,
    };
  }
}
