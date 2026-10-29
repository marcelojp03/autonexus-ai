import { Controller, Get, Headers, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { BadRequest, BusinessGraphql, type GraphqlRequest } from '../../application/business-graphql.js';
import { BusinessError, isPublicBusinessCode, publicMessage } from '../../application/business-error.js';
import type { EmployeesGateway } from '../../application/employees-gateway.js';
import { HttpEmployeesGateway } from '../../application/employees-gateway.js';
import type { AuthenticatedRequest } from '../auth/token-verifier.js';
import { AdministratorGuard } from '../auth/administrator.guard.js';
import { UseGuards } from '@nestjs/common';

@Controller()
export class GraphqlController {
  constructor(
    @Inject(BusinessGraphql) private readonly graphql: BusinessGraphql,
    @Inject(HttpEmployeesGateway) private readonly gateway: EmployeesGateway,
  ) {}

  @Get('health/live')
  live() {
    return { status: 'UP' };
  }

  @Get('health/ready')
  async ready(@Res({ passthrough: true }) response: Response) {
    const up = await this.gateway.reachable();
    response.status(up ? 200 : 503);
    return { status: up ? 'UP' : 'DOWN' };
  }

  @Post('graphql')
  @HttpCode(200)
  @UseGuards(AdministratorGuard)
  async query(@Req() request: AuthenticatedRequest, @Headers('content-type') contentType: string | undefined) {
    if (!contentType?.toLowerCase().startsWith('application/json')) {
      return { errors: [{ message: publicMessage('BAD_REQUEST'), extensions: { code: 'BAD_REQUEST', statusCode: 400 } }] };
    }
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { errors: [{ message: publicMessage('BAD_REQUEST'), extensions: { code: 'BAD_REQUEST', statusCode: 400 } }] };
    }
    const token = (request.headers.authorization as string).slice(7);
    if (!request.identity) {
      return { errors: [{ message: publicMessage('UNAUTHENTICATED'), extensions: { code: 'UNAUTHENTICATED', statusCode: 401 } }] };
    }
    try {
      return await this.graphql.run(body as GraphqlRequest, request.identity, token);
    } catch (error) {
      if (error instanceof BadRequest) {
        return { errors: [{ message: publicMessage('BAD_REQUEST'), extensions: { code: 'BAD_REQUEST', statusCode: 400 } }] };
      }
      if (error instanceof BusinessError) {
        const code = error.statusCode === 401 ? 'UNAUTHENTICATED' : error.statusCode === 403 ? 'FORBIDDEN' : error.code;
        if (isPublicBusinessCode(code)) {
          return { errors: [{ message: publicMessage(code), extensions: { code, statusCode: error.statusCode } }] };
        }
      }
      return { errors: [{ message: publicMessage('SERVICE_UNAVAILABLE'), extensions: { code: 'SERVICE_UNAVAILABLE', statusCode: 503 } }] };
    }
  }
}
