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
  /** «Додано: …» — who wrote it, `displayNameOf` batched (D-8); null when no user row is found. */
  created_by_name: string | null;
  created_at: string;
  voided_at: string | null;
  voided_by_user_id: string | null;
  /** «Анульовано … · …» — null while live, or when no user row is found. */
  voided_by_name: string | null;
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
 *
 * `names` is the caller's `loadDisplayNames` map (D-8, as `counted_by_name`):
 * ONE batched read per page, and the mapper itself does no I/O.
 */
export function toIntakeTopUpResponse(
  topUp: IntakeTopUp,
  intake: ParentIntakeRef,
  names: ReadonlyMap<string, string>,
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
    created_by_name: names.get(topUp.created_by_user_id) ?? null,
    created_at: topUp.created_at.toISOString(),
    voided_at: topUp.voided_at ? topUp.voided_at.toISOString() : null,
    voided_by_user_id: topUp.voided_by_user_id,
    voided_by_name: topUp.voided_by_user_id ? (names.get(topUp.voided_by_user_id) ?? null) : null,
    void_reason: topUp.void_reason,
  };
}

/** Every user id a page of top-ups names — the one `loadDisplayNames` read it needs. */
export function topUpUserIds(
  rows: readonly Pick<IntakeTopUp, 'created_by_user_id' | 'voided_by_user_id'>[],
): string[] {
  return rows.flatMap((r) =>
    r.voided_by_user_id ? [r.created_by_user_id, r.voided_by_user_id] : [r.created_by_user_id],
  );
}
