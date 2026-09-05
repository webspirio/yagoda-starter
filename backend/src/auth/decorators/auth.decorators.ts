import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { ROLES_KEY, RolesGuard } from '../guards/roles.guard';
import { UserRole } from '../../users/user-role.enum';

/**
 * The one blessed way to protect a route:
 *
 *   @Auth()                          // any authenticated user
 *   @Auth(UserRole.NetworkOwner)     // owner only
 *
 * Guard order matters and is not incidental: JwtAuthGuard runs first and
 * populates request.user, which RolesGuard then reads.
 *
 * Roles are matched EXACTLY. `@Auth(UserRole.PointOperator)` refuses the
 * network owner: there is no hierarchy in which the owner implicitly holds
 * the operator's role. A route both may call lists both, or names none.
 *
 * A bare `@Auth()` on a method of a role-restricted CLASS inherits the
 * class's roles rather than clearing them — which is why the metadata value
 * is `undefined` and not `[]` when no role is given. `getAllAndOverride`
 * returns the first value that is not `undefined`, walking handler then
 * class, so an empty array WOULD count as an answer and silently widen an
 * owner-only controller to every authenticated user. Writing `@Auth()` on
 * one method of an `@Auth(UserRole.NetworkOwner)` controller is a natural
 * way to spell "still protected", and it must not mean "protected less".
 *
 * This decorator is for ROLE-ONLY rules — ones decidable from the request
 * alone (§10.2 "only the owner changes a target", §9.4 "only the owner
 * voids"). A rule that has to read a row (§7.7's "the operator closes the
 * shift unless it fails to reconcile", §7.9's "only the owning point may
 * accept") is NOT a guard: it belongs in a named assert* method on the
 * service, next to the invariant it protects. See `auth/access/point-scope.ts`.
 */
export function Auth(...roles: UserRole[]) {
  return applyDecorators(
    SetMetadata(ROLES_KEY, roles.length > 0 ? roles : undefined),
    UseGuards(JwtAuthGuard, RolesGuard),
  );
}
