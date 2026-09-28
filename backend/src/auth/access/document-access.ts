import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../../users/user-role.enum';
import type { AuthenticatedUser } from '../jwt.strategy';

/** The shift facts §9.4 reads — a `Shift` entity satisfies it. */
export interface DocumentShift {
  collection_point_id: string;
  closed_at: Date | null;
}

/** Another point's document is a 404, never a 403: its existence must not be confirmed. */
export function assertCanSee(
  actor: AuthenticatedUser,
  shift: DocumentShift,
  notFound: string,
): void {
  if (
    actor.role !== UserRole.NetworkOwner &&
    actor.collection_point_id !== shift.collection_point_id
  ) {
    throw new NotFoundException(notFound);
  }
}

/**
 * §9.4 for a void: an operator only on a document they recorded (an author check — §10.6
 * puts two operators in one shift) and only while its shift is open; the owner always.
 * Run after `assertCanSee`. The closed-shift text stays per module.
 */
export function assertCanVoid(
  actor: AuthenticatedUser,
  { authorId, shift }: { authorId: string; shift: DocumentShift },
  shiftClosedMessage: string,
): void {
  if (actor.role === UserRole.NetworkOwner) return;
  if (authorId !== actor.sub) {
    throw new ForbiddenException({
      message: 'You can only void a document you recorded yourself',
      code: 'NOT_YOUR_DOCUMENT',
    });
  }
  if (shift.closed_at) {
    throw new ForbiddenException({ message: shiftClosedMessage, code: 'SHIFT_CLOSED' });
  }
}
