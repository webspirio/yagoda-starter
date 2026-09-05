import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../users/user-role.enum';
import { RolesGuard } from '../guards/roles.guard';
import { Auth } from './auth.decorators';
import type { AuthenticatedUser } from '../jwt.strategy';

/**
 * @Auth() + RolesGuard as one unit, against a REAL Reflector.
 *
 * `roles.guard.spec.ts` cannot catch what this file catches: it stubs
 * `getAllAndOverride` with a fixed return value, so it asserts what the guard
 * does with a given roles array and never exercises how that array is
 * resolved. The bug this file guards against lives entirely in the
 * resolution — a bare `@Auth()` writing `[]` onto a handler, which
 * `getAllAndOverride` (first value `!== undefined`, walking handler then
 * class) would return in preference to the class's own roles, downgrading an
 * owner-only controller to any-authenticated-user. That needs real metadata
 * on a real decorated class.
 */

@Auth(UserRole.NetworkOwner)
class OwnerOnlyController {
  /** The dangerous spelling: a developer meaning "still protected". */
  @Auth()
  inheritsClassRoles() {}

  @Auth(UserRole.PointOperator)
  overridesWithItsOwnRole() {}

  undecorated() {}
}

class UnrestrictedController {
  @Auth()
  anyAuthenticatedUser() {}
}

const operator: AuthenticatedUser = {
  sub: 'u-op',
  username: 'oksana',
  role: UserRole.PointOperator,
  collection_point_id: 'point-a',
};
const owner: AuthenticatedUser = {
  sub: 'u-owner',
  username: 'owner',
  role: UserRole.NetworkOwner,
  collection_point_id: null,
};

const guard = new RolesGuard(new Reflector());

const contextFor = (
  cls: new () => object,
  handler: (...args: never[]) => unknown,
  user: AuthenticatedUser,
): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => handler,
    getClass: () => cls,
  }) as unknown as ExecutionContext;

describe('@Auth() metadata resolution', () => {
  it('does NOT let a bare @Auth() method widen an owner-only controller', () => {
    expect(() =>
      guard.canActivate(
        contextFor(OwnerOnlyController, OwnerOnlyController.prototype.inheritsClassRoles, operator),
      ),
    ).toThrow(ForbiddenException);

    expect(
      guard.canActivate(
        contextFor(OwnerOnlyController, OwnerOnlyController.prototype.inheritsClassRoles, owner),
      ),
    ).toBe(true);
  });

  it('applies the class roles to a method carrying no @Auth() of its own', () => {
    expect(() =>
      guard.canActivate(
        contextFor(OwnerOnlyController, OwnerOnlyController.prototype.undecorated, operator),
      ),
    ).toThrow(ForbiddenException);
  });

  // Roles are matched exactly: a method that names its own role replaces the
  // class's, and the owner does NOT implicitly satisfy an operator-only route.
  it('lets a method override the class roles outright, in both directions', () => {
    expect(
      guard.canActivate(
        contextFor(
          OwnerOnlyController,
          OwnerOnlyController.prototype.overridesWithItsOwnRole,
          operator,
        ),
      ),
    ).toBe(true);

    expect(() =>
      guard.canActivate(
        contextFor(
          OwnerOnlyController,
          OwnerOnlyController.prototype.overridesWithItsOwnRole,
          owner,
        ),
      ),
    ).toThrow(ForbiddenException);
  });

  it('still means "any authenticated user" on a controller with no class-level roles', () => {
    expect(
      guard.canActivate(
        contextFor(
          UnrestrictedController,
          UnrestrictedController.prototype.anyAuthenticatedUser,
          operator,
        ),
      ),
    ).toBe(true);
  });
});
