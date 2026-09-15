import { Transfer } from './transfer.entity';
import { TransferStatus } from './transfer-status.enum';
import { sub } from '../common/money';

/**
 * THE DISCREPANCY IS COMPUTED HERE AND STORED NOWHERE, for the reason the
 * `cash_counts` Note gives about its own: «Розбіжність … НЕ зберігається; поля
 * вводу для неї немає в жодної ролі (§7.7)». A stored discrepancy is a second
 * copy of a fact, and there are no thresholds — a hryvnia out is the same kind
 * of event as 350 out.
 *
 * THE SIGN IS FIXED AND MUST NOT BE FLIPPED. Positive is a SHORTAGE — less
 * arrived than the base declared, `150 000 − 140 000 = 10 000`. Negative is a
 * surplus. Ticket #20 asks for both directions («як недостачу, так і фактично
 * більшу суму»), so nothing clamps this. The opposite convention is equally
 * defensible, which is exactly why it is pinned down here rather than left to
 * each reader's instinct.
 *
 * The subtraction goes through `common/money.ts`, never through a bare `-` on
 * the decimal strings — foundation §5.1.
 */
export interface TransferResponse {
  id: string;
  collection_point_id: string;
  cash: string;
  crates: number;
  carrier: string;
  sent_by_user_id: string;
  sent_at: Date;
  status: TransferStatus;
  accepted_by_user_id: string | null;
  accepted_date: string | null;
  accepted_at: Date | null;
  reported_cash: string | null;
  reported_crates: number | null;
  dispute_note: string | null;
  resolved_cash: string | null;
  resolved_crates: number | null;
  resolved_by_user_id: string | null;
  resolved_at: Date | null;
  /** `null` unless disputed. Positive = shortage. */
  cash_discrepancy: string | null;
  crates_discrepancy: number | null;
  correction_of_transfer_id: string | null;
  voided_at: Date | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  created_at: Date;
}

/**
 * `sub` FROM `common/money.ts` IS THE ARITHMETIC SEAM, and calling it is not a
 * violation of foundation §5.1 — it is what §5.1 exists to route money
 * through. It parses both strings to BigInt kopiykas, subtracts exactly, and
 * renders back to two decimals; `-` applied to the raw strings is what the
 * rule forbids.
 *
 * `crates` is an `int`, not money, so a plain `-` is correct there.
 */
export function toTransferResponse(t: Transfer): TransferResponse {
  const effective = t.resolved_cash ?? t.reported_cash;
  const effectiveCrates = t.resolved_crates ?? t.reported_crates;
  const disputed = t.status === TransferStatus.Disputed;
  return {
    id: t.id,
    collection_point_id: t.collection_point_id,
    cash: t.cash,
    crates: t.crates,
    carrier: t.carrier,
    sent_by_user_id: t.sent_by_user_id,
    sent_at: t.sent_at,
    status: t.status,
    accepted_by_user_id: t.accepted_by_user_id,
    accepted_date: t.accepted_date,
    accepted_at: t.accepted_at,
    reported_cash: t.reported_cash,
    reported_crates: t.reported_crates,
    dispute_note: t.dispute_note,
    resolved_cash: t.resolved_cash,
    resolved_crates: t.resolved_crates,
    resolved_by_user_id: t.resolved_by_user_id,
    resolved_at: t.resolved_at,
    cash_discrepancy: disputed && effective !== null ? sub(t.cash, effective) : null,
    crates_discrepancy:
      disputed && effectiveCrates !== null ? t.crates - effectiveCrates : null,
    correction_of_transfer_id: t.correction_of_transfer_id,
    voided_at: t.voided_at,
    voided_by_user_id: t.voided_by_user_id,
    void_reason: t.void_reason,
    created_at: t.created_at,
  };
}
