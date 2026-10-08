import { ConflictException, ForbiddenException, HttpException } from '@nestjs/common';
import { cmp } from '../common/money';
import { CashBook } from './cash-book.enum';
import { CashCountKind } from './cash-count-kind.enum';
import type { CashCount } from './cash-count.entity';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * Spec 2026-10-08 — who may write which text on which count. ONE definition: the
 * PUTs throw what this returns and every read flag is `refusal === null`, so a
 * button and the server cannot disagree. No window: the next shift opening
 * closes nothing; only the owner's explanation of THIS count does.
 */
export type CountNoteField = 'explanation' | 'operator_note';

export type NoteCount = Pick<
  CashCount,
  'book' | 'kind' | 'counted_amount' | 'expected_amount' | 'counted_by_user_id' | 'explanation'
>;

export function countNoteRefusal(
  actor: AuthenticatedUser,
  count: NoteCount,
  field: CountNoteField,
): HttpException | null {
  if (field === 'explanation' && actor.role !== UserRole.NetworkOwner) {
    return new ForbiddenException({
      message: 'Only the network owner may explain a discrepancy',
      code: 'OWNER_ONLY',
    });
  }
  // §10.6 — the account belongs to whoever pressed the button for this count.
  if (field === 'operator_note' && count.counted_by_user_id !== actor.sub) {
    return new ForbiddenException({
      message: 'Only the operator who made this count may explain it',
      code: 'NOT_COUNTER',
    });
  }
  // A midday row is a recount (a witness, §7.6) or a demoted close (superseded history).
  if (count.book !== CashBook.Berry || count.kind === CashCountKind.Midday) {
    return new ConflictException({
      message: 'Only an opening or closing count can be explained',
      code: 'COUNT_NOT_EXPLAINABLE',
    });
  }
  if (cmp(count.counted_amount, count.expected_amount) === 0) {
    return new ConflictException({ message: 'That count has no discrepancy', code: 'NO_DISCREPANCY' });
  }
  if (field === 'operator_note' && count.explanation !== null) {
    return new ConflictException({
      message: 'The owner has already explained this discrepancy',
      code: 'OWNER_ALREADY_EXPLAINED',
    });
  }
  return null;
}

/** The read flag: the field's own role AND no refusal. */
export function countNoteAllowed(
  actor: AuthenticatedUser,
  count: NoteCount,
  field: CountNoteField,
): boolean {
  const role = field === 'explanation' ? UserRole.NetworkOwner : UserRole.PointOperator;
  return actor.role === role && countNoteRefusal(actor, count, field) === null;
}
