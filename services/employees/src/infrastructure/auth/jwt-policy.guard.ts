import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessTokenVerifier } from './access-token-verifier.js';
import { AUTH_POLICY, type AuthPolicy, type AuthenticatedRequest } from './auth-policy.js';

@Injectable()
export class JwtPolicyGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AccessTokenVerifier) private readonly verifier: AccessTokenVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.getAllAndOverride<AuthPolicy>(AUTH_POLICY, [context.getHandler(), context.getClass()]);
    if (policy && 'public' in policy && policy.public) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const headerCount = request.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === 'authorization').length;
    const match = typeof authorization === 'string' && headerCount === 1
      ? /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization) : null;
    if (!match) throw new UnauthorizedException();
    request.identity = await this.verifier.verify(match[1]);
    if (!policy || !('roles' in policy) || !policy.roles.some((role) => request.identity.roles.includes(role))) {
      throw new ForbiddenException();
    }
    return true;
  }
}
