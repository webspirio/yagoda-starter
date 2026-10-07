import { ConflictException, ForbiddenException, HttpException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { Shift } from './shift.entity';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * Spec 2026-10-06 — who may write `shifts.operator_note`, and when. ONE
 * definition: the PUT throws what `operatorNoteRefusal` returns, and every read
 * flag is `refusal === null`, so the button and the server cannot disagree.
 */
export interface OperatorNoteFacts {
  /** No shift at the same point has a later business_date (the window). */
  is_newest: boolean;
  /** The standing berry closing count disagrees with its expectation. */
  has_discrepancy: boolean;
}

export const NO_FACTS: OperatorNoteFacts = { is_newest: false, has_discrepancy: false };

export type NoteShift = Pick<Shift, 'closed_at' | 'closed_by_user_id' | 'explanation'>;

export function operatorNoteRefusal(
  actor: AuthenticatedUser,
  shift: NoteShift,
  facts: OperatorNoteFacts,
): HttpException | null {
  // The count is blind until the close is written, so there is nothing to explain before it.
  if (!shift.closed_at) {
    return new ConflictException({ message: 'That shift is not closed', code: 'SHIFT_NOT_CLOSED' });
  }
  // §10.3 — the testimony belongs to whoever held the drawer.
  if (shift.closed_by_user_id !== actor.sub) {
    return new ForbiddenException({
      message: 'Only the operator who closed the shift may explain it',
      code: 'NOT_SHIFT_CLOSER',
    });
  }
  if (!facts.is_newest) {
    return new ConflictException({
      message: 'The next shift is already open — the owner decides from here',
      code: 'OPERATOR_NOTE_WINDOW_CLOSED',
    });
  }
  // `''` is undecided, matching `is_open` and `only_discrepancies`.
  if (shift.explanation) {
    return new ConflictException({
      message: 'The owner has already explained this discrepancy',
      code: 'OWNER_ALREADY_EXPLAINED',
    });
  }
  if (!facts.has_discrepancy) {
    return new ConflictException({
      message: 'That shift closed without a discrepancy',
      code: 'NO_DISCREPANCY',
    });
  }
  return null;
}

export function operatorNoteEditable(
  actor: AuthenticatedUser,
  shift: NoteShift,
  facts: OperatorNoteFacts,
): boolean {
  return actor.role === UserRole.PointOperator && operatorNoteRefusal(actor, shift, facts) === null;
}

/** The checks that need no query — so most reads never load facts at all. */
export function couldEditOperatorNote(actor: AuthenticatedUser, shift: NoteShift): boolean {
  return (
    actor.role === UserRole.PointOperator &&
    !!shift.closed_at &&
    shift.closed_by_user_id === actor.sub &&
    !shift.explanation
  );
}

/**
 * The two facts as select-list SQL over a `shifts` row aliased `s` — the ONE
 * definition, selected here, by `CashCountsService.list` and by reopen. Its
 * subqueries alias `n` and `cc`; a host query must not use either name.
 */
export const OPERATOR_NOTE_FACTS_SQL = `
  NOT EXISTS (SELECT 1 FROM shifts n
               WHERE n.collection_point_id = s.collection_point_id
                 AND n.business_date > s.business_date) AS is_newest,
  EXISTS (SELECT 1 FROM cash_counts cc
           WHERE cc.shift_id = s.id AND cc.book = 'berry' AND cc.kind = 'closing'
             AND cc.counted_amount <> cc.expected_amount) AS has_discrepancy`;

/** One query for any number of shifts (D-8). */
export async function loadOperatorNoteFacts(
  m: EntityManager,
  shiftIds: string[],
): Promise<Map<string, OperatorNoteFacts>> {
  if (shiftIds.length === 0) return new Map();
  const rows = (await m.query(
    `SELECT s.id, ${OPERATOR_NOTE_FACTS_SQL}
       FROM shifts s
      WHERE s.id = ANY($1::uuid[])`,
    [shiftIds],
  )) as { id: string; is_newest: boolean; has_discrepancy: boolean }[];
  return new Map(
    rows.map((r) => [r.id, { is_newest: r.is_newest, has_discrepancy: r.has_discrepancy }]),
  );
}
