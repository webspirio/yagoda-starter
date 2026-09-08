import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '../../users/user-role.enum';
import type { AuthenticatedUser } from '../jwt.strategy';

/**
 * Row-level access rules for the point a caller belongs to. These are NOT
 * guards: a guard answers "may this role call this operation" from the request
 * alone, while these need to know which row is being touched. Keeping them in
 * one module is what stops four endpoints each implementing the rule slightly
 * differently.
 *
 * THE RULE: the point is DERIVED from the actor (or from the shift a document
 * references), never accepted from a request body. An operator's request
 * simply has no point field to forge.
 */

/** Throws unless the actor may act on `pointId`. The owner may act on any. */
export function assertOwnsPoint(actor: AuthenticatedUser, pointId: string): void {
  if (actor.role === UserRole.NetworkOwner) return;
  if (actor.collection_point_id === pointId) return;
  throw new ForbiddenException({
    message: 'That collection point is not yours',
    code: 'WRONG_COLLECTION_POINT',
  });
}

/**
 * The point a WRITE lands on.
 *
 * An operator's comes from their token, and a body value naming another point
 * is refused by `assertOwnsPoint`. An owner has no point of their own, so they
 * must name one.
 *
 * Lifted here from `SuppliersService`, which grew it first, for the reason this
 * module's header already gives: keeping the rule in one place is what stops
 * several endpoints each implementing it slightly differently — and the
 * documents slice adds three more callers.
 *
 * NOT used by `shifts`: §10.3 makes opening and closing a shift the operator's
 * alone, so there is no owner branch there and no body point to resolve.
 */
export function resolveWritePoint(actor: AuthenticatedUser, requested?: string): string {
  if (actor.collection_point_id && !requested) return actor.collection_point_id;
  if (!requested) {
    throw new BadRequestException({
      message: 'collection_point_id is required',
      code: 'COLLECTION_POINT_REQUIRED',
    });
  }
  assertOwnsPoint(actor, requested);
  return requested;
}

/**
 * The point id a list query should filter on.
 *
 * An operator is pinned to their own point and `requested` is IGNORED rather
 * than rejected — there is nothing meaningful to report, because the parameter
 * can neither widen nor redirect their scope. An owner gets what they asked
 * for, or `undefined` meaning "every point".
 *
 * A non-owner with no point THROWS rather than returning `undefined`, and the
 * difference is the whole safety of this function: `undefined` is its encoding
 * for "every point", so falling back to it would hand a scope-less operator
 * the entire network — failing open on exactly the input `assertOwnsPoint`
 * fails closed on. CHK_users_role_point should make that state unreachable;
 * this is what happens if it ever is not.
 */
export function resolvePointFilter(
  actor: AuthenticatedUser,
  requested?: string,
): string | undefined {
  if (actor.role === UserRole.NetworkOwner) return requested;
  if (!actor.collection_point_id) {
    throw new ForbiddenException({
      message: 'No collection point assigned',
      code: 'NO_COLLECTION_POINT',
    });
  }
  return actor.collection_point_id;
}
