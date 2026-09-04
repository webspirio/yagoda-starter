import { ForbiddenException } from '@nestjs/common';
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
 * The point id a list query should filter on.
 *
 * An operator is pinned to their own point and `requested` is IGNORED rather
 * than rejected — there is nothing meaningful to report, because the parameter
 * can neither widen nor redirect their scope. An owner gets what they asked
 * for, or `undefined` meaning "every point".
 */
export function resolvePointFilter(
  actor: AuthenticatedUser,
  requested?: string,
): string | undefined {
  if (actor.role === UserRole.NetworkOwner) return requested;
  return actor.collection_point_id ?? undefined;
}
