import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { AuthorizeActor } from '../../application/authorize-actor.js';
import { JwtPolicyGuard } from './jwt-policy.guard.js';
import { AccessTokenVerifier } from './access-token-verifier.js';
import type { AuthPolicy, VerifiedIdentity } from './auth-policy.js';
describe('CU15 technical authorization precedes human permission resolution (unit fakes)', () => {
  const resolve = vi
    .fn()
    .mockResolvedValue({
      permissions: ['confirmations:read'],
      recognized: ['jefe_taller'],
    });
  const verified: VerifiedIdentity = {
    subject: 'service-account',
    roles: [],
    permissions: [],
    recognized: [],
    clientId: 'autonexus-cu15-coordinator',
    scopes: ['cu15.staffing.reserve'],
  };
  function setup(policy: AuthPolicy, identity: VerifiedIdentity = verified) {
    const request = {
      headers: { authorization: 'Bearer e30.e30.signature' },
      rawHeaders: ['Authorization', 'Bearer e30.e30.signature'],
      identity: undefined as VerifiedIdentity | undefined,
    };
    const guard = new JwtPolicyGuard(
      { getAllAndOverride: () => policy } as unknown as Reflector,
      { verify: async () => identity } as unknown as AccessTokenVerifier,
      { resolve } as unknown as AuthorizeActor,
    );
    const context = {
      getHandler: () => null,
      getClass: () => null,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { guard, context, request };
  }
  beforeEach(() => resolve.mockClear());
  it('allows exact technical client and action without a human DB lookup', async () => {
    const { guard, context, request } = setup({
      technicalScope: 'cu15.staffing.reserve',
    });
    expect(await guard.canActivate(context)).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
    expect(request.identity?.subject).toBe('service-account');
  });
  it.each([
    { ...verified, clientId: 'browser', roles: ['administrador'] },
    { ...verified, clientId: undefined },
    { ...verified, scopes: ['cu15.staffing.confirm'] },
  ])(
    'denies wrong client/scope before human authorization %#',
    async (identity) => {
      const { guard, context } = setup(
        { technicalScope: 'cu15.staffing.reserve' },
        identity,
      );
      await expect(guard.canActivate(context)).rejects.toThrow('Forbidden');
      expect(resolve).not.toHaveBeenCalled();
    },
  );
  it('does not allow technical client/scopes on human CRUD even with an admin role', async () => {
    const { guard, context } = setup(
      { permissions: ['employees:write'] },
      { ...verified, roles: ['administrador'] },
    );
    await expect(guard.canActivate(context)).rejects.toThrow('Forbidden');
    expect(resolve).not.toHaveBeenCalled();
  });
  it('keeps human read permission authorization for mechanics projection', async () => {
    const { guard, context } = setup(
      { permissions: ['confirmations:read'] },
      {
        ...verified,
        clientId: 'autonexus-bff',
        scopes: [],
        roles: ['jefe_taller'],
      },
    );
    expect(await guard.canActivate(context)).toBe(true);
    expect(resolve).toHaveBeenCalledOnce();
  });
});
