import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizeActor } from '../../application/authorize-actor.js';
import { AccessTokenVerifier } from './access-token-verifier.js';
import { AUTH_POLICY, type AuthPolicy, type AuthenticatedRequest } from './auth-policy.js';

@Injectable()
export class JwtPolicyGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AccessTokenVerifier) private readonly verifier: AccessTokenVerifier,
    @Inject(AuthorizeActor) private readonly authorize: AuthorizeActor,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.getAllAndOverride<AuthPolicy>(AUTH_POLICY, [context.getHandler(), context.getClass()]);
    if (policy && 'public' in policy && policy.public) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const headerCount = request.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === 'authorization').length;
    const match = typeof authorization === 'string' && headerCount === 1
      ? /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization) : null;
    if (!match) throw new UnauthorizedException();
    const verified = await this.verifier.verify(match[1]);
    if (policy && 'technicalScope' in policy) {
      if (verified.clientId !== 'autonexus-cu15-coordinator' || !verified.scopes?.includes(policy.technicalScope)) throw new ForbiddenException();
      request.identity = verified;
      return true;
    }
    if (verified.clientId === 'autonexus-cu15-coordinator' || verified.scopes?.some(scope => scope.startsWith('cu15.'))) throw new ForbiddenException();
    let effective;
    try {
      effective = await this.authorize.resolve(verified.subject, verified.roles);
    } catch {
      throw new ServiceUnavailableException();
    }
    request.identity = {
      subject: verified.subject,
      roles: verified.roles,
      permissions: effective.permissions,
      recognized: effective.recognized,
    };
    if (!policy) throw new ForbiddenException();
    if ('roles' in policy) {
      if (!policy.roles.some((role) => verified.roles.includes(role))) throw new ForbiddenException();
      return true;
    }
    if ('authenticated' in policy) {
      if (effective.recognized.length === 0) throw new ForbiddenException();
      return true;
    }
    if ('permissions' in policy) {
      if (!policy.permissions.every((permission) => effective.permissions.includes(permission))) throw new ForbiddenException();
      return true;
    }
    throw new ForbiddenException();
  }
}
