import { ForbiddenException, Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from './token-verifier.js';
import { AccessTokenVerifier } from './token-verifier.js';

/**
 * Authenticates the caller. Authorization is decided per GraphQL root field, so CU04 can
 * allow `jefe_taller` without relaxing the CU03 employee operations.
 */
@Injectable()
export class AdministratorGuard implements CanActivate {
  constructor(@Inject(AccessTokenVerifier) private readonly verifier: AccessTokenVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const headerCount = request.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === 'authorization').length;
    const match = typeof authorization === 'string' && headerCount === 1
      ? /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization)
      : null;
    if (!match) throw new UnauthorizedException();
    request.identity = await this.verifier.verify(match[1]);
    if (!request.identity.roles.length) throw new ForbiddenException();
    return true;
  }
}
