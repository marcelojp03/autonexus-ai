import {
  Controller,
  Get,
  Inject,
  Param,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { BusinessGraphql } from '../../application/business-graphql.js';
import { BusinessError } from '../../application/business-error.js';
import { HttpOperationsGateway } from '../../application/operations-gateway.js';
import { AdministratorGuard } from '../auth/administrator.guard.js';
import type { AuthenticatedRequest } from '../auth/token-verifier.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('vehicle-history')
@UseGuards(AdministratorGuard)
export class VehicleHistoryFilesController {
  constructor(
    @Inject(BusinessGraphql) private readonly permissions: BusinessGraphql,
    @Inject(HttpOperationsGateway)
    private readonly operations: HttpOperationsGateway,
  ) {}

  @Get('vehicles/:vehicleId/orders/:orderId/evidence/:evidenceId')
  async download(
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
    @Param('vehicleId') vehicleId: string,
    @Param('orderId') orderId: string,
    @Param('evidenceId') evidenceId: string,
  ): Promise<void> {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (
      ![vehicleId, orderId, evidenceId].every((value) => UUID.test(value)) ||
      !request.identity
    ) {
      response
        .status(400)
        .json({
          statusCode: 400,
          code: 'BAD_REQUEST',
          message: 'Request failed',
        });
      return;
    }
    const token = String(request.headers.authorization).slice(7);
    try {
      await this.permissions.requirePermission(
        request.identity,
        token,
        'vehicle-history:read',
      );
      const file = await this.operations.vehicleServiceHistoryEvidence(
        vehicleId,
        orderId,
        evidenceId,
        token,
      );
      response.setHeader('Content-Type', file.contentType);
      response.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      );
      response.status(200).send(Buffer.from(file.bytes));
    } catch (error) {
      const status = error instanceof BusinessError ? error.statusCode : 503;
      response
        .status(status)
        .json({
          statusCode: status,
          code:
            status === 403
              ? 'FORBIDDEN'
              : status === 404
                ? 'NOT_FOUND'
                : 'SERVICE_UNAVAILABLE',
          message: 'Request failed',
        });
    }
  }
}
