import { IntakeTopUp } from './intake-top-up.entity';

/** The parent fields every response needs. A full `Intake` satisfies it. */
export interface ParentIntakeRef {
  id: string;
  code: string;
  voided_at: Date | null;
}

export interface IntakeTopUpResponse {
  id: string;
  amount: string;
  reason: string;
  counts_toward_balance: boolean;
  intake: { id: string; code: string; voided_at: string | null };
  created_by_user_id: string;
  created_at: string;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
}

/**
 * `counts_toward_balance` IS COMPUTED HERE RATHER THAN LEFT TO THE CLIENT, and
 * it is the one field in this response that is not a column.
 *
 * The rule it states — a top-up on a voided receipt counts for nothing — lives
 * in `debtSql`'s join. Re-deriving it in every client is how it drifts, and
 * this system already centralised `voided_at IS NULL` for exactly that reason.
 * This is NOT the second copy of a fact the DBML forbids: that ban is about
 * STORED duplicates, and this is computed per response from the same two
 * columns the balance query reads.
 *
 * The flag says WHAT; the embedded `intake` says WHY, so a reader looking at a
 * neutralised 2 000 ₴ row can see which receipt killed it.
 */
export function toIntakeTopUpResponse(
  topUp: IntakeTopUp,
  intake: ParentIntakeRef,
): IntakeTopUpResponse {
  return {
    id: topUp.id,
    amount: topUp.amount,
    reason: topUp.reason,
    counts_toward_balance: topUp.voided_at === null && intake.voided_at === null,
    intake: {
      id: intake.id,
      code: intake.code,
      voided_at: intake.voided_at ? intake.voided_at.toISOString() : null,
    },
    created_by_user_id: topUp.created_by_user_id,
    created_at: topUp.created_at.toISOString(),
    voided_at: topUp.voided_at ? topUp.voided_at.toISOString() : null,
    voided_by_user_id: topUp.voided_by_user_id,
    void_reason: topUp.void_reason,
  };
}
