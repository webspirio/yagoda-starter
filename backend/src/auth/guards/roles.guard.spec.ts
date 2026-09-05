import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../users/user-role.enum';
import { RolesGuard } from './roles.guard';
import type { AuthenticatedUser } from '../jwt.strategy';

const contextFor = (user: AuthenticatedUser | undefined): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  }) as unknown as ExecutionContext;

describe('RolesGuard', () => {
  const guardWith = (roles: UserRole[] | undefined) => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(roles),
    } as unknown as Reflector;
    return new RolesGuard(reflector);
  };

  const operator: AuthenticatedUser = {
    sub: 'u-op',
    username: 'oksana',
    role: UserRole.PointOperator,
    collection_point_id: 'point-a',
  };

  it('allows any authenticated user when no role is required', () => {
    expect(guardWith(undefined).canActivate(contextFor(operator))).toBe(true);
    expect(guardWith([]).canActivate(contextFor(operator))).toBe(true);
  });

  it('allows a user holding a required role', () => {
    expect(guardWith([UserRole.PointOperator]).canActivate(contextFor(operator))).toBe(true);
  });

  it('refuses a user without the required role', () => {
    expect(() => guardWith([UserRole.NetworkOwner]).canActivate(contextFor(operator))).toThrow(
      ForbiddenException,
    );
  });

  // Defence in depth: @Auth() always applies JwtAuthGuard first, so this
  // should be unreachable. If it ever IS reached, a missing user must not be
  // read as "no role required".
  it('refuses when no user is on the request at all', () => {
    expect(() => guardWith([UserRole.NetworkOwner]).canActivate(contextFor(undefined))).toThrow(
      UnauthorizedException,
    );
  });
});
