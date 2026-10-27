import { ForbiddenException, Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest, VerifiedIdentity } from './token-verifier.js';
import { AccessTokenVerifier } from './token-verifier.js';

/** Every CU03 business operation requires the administrator role, re-checked here. */
export const REQUIRED_ROLE: VerifiedIdentity['roles'][number] = 'administrador';

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
    const identity = await this.verifier.verify(match[1]);
    request.identity = identity;
    if (!identity.roles.includes(REQUIRED_ROLE)) throw new ForbiddenException();
    return true;
  }
}