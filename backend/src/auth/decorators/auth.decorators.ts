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
 * This decorator is for ROLE-ONLY rules — ones decidable from the request
 * alone (§10.2 "only the owner changes a target", §9.4 "only the owner
 * voids"). A rule that has to read a row (§7.7's "the operator closes the
 * shift unless it fails to reconcile", §7.9's "only the owning point may
 * accept") is NOT a guard: it belongs in a named assert* method on the
 * service, next to the invariant it protects. See `auth/access/point-scope.ts`.
 */
export function Auth(...roles: UserRole[]) {
  return applyDecorators(SetMetadata(ROLES_KEY, roles), UseGuards(JwtAuthGuard, RolesGuard));
}
