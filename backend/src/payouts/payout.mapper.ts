import { Payout } from './payout.entity';
import { Shift } from '../shifts/shift.entity';
import type { User } from '../users/user.entity';

/** `collection_point_id` and `business_date` are joined in from the shift and
 *  stored nowhere — see `Payout`'s header. */
export interface PayoutResponse {
  id: string;
  code: string;
  shift_id: string;
  collection_point_id: string;
  business_date: string;
  /** `shift.closed_at !== null` — doc «2026-09-28: the void dialog branches on it». */
  shift_closed: boolean;
  supplier_id: string;
  intake_id: string | null;
  amount: string;
  /** The supplier's debt right after this payout — frozen at write, #145. */
  balance_after: string;
  paid_by_user_id: string;
  /** The payer as name PARTS, for the printed receipt header («Прізвище Ім'я»). `null` on list
   *  rows — only `GET /payouts/:id` and `POST /payouts` load the user. */
  paid_by: { first_name: string; last_name: string; number: number } | null;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  return_settled_at: string | null;
  return_settled_by_user_id: string | null;
  return_note: string | null;
  /** The cash came back AT VOID TIME, into this payout's own shift (open-shift
   *  void, 2026-09-28) — as opposed to an owner's later `settle-return`, which
   *  `movementsSql` credits by date. */
  returned_on_void: boolean;
  created_at: string;
}

export function toPayoutResponse(
  payout: Payout,
  shift: Shift,
  paidBy: Pick<User, 'first_name' | 'last_name' | 'number'> | null = null,
): PayoutResponse {
  return {
    id: payout.id,
    code: payout.code,
    shift_id: payout.shift_id,
    collection_point_id: shift.collection_point_id,
    business_date: shift.business_date,
    shift_closed: shift.closed_at !== null,
    supplier_id: payout.supplier_id,
    intake_id: payout.intake_id,
    amount: payout.amount,
    balance_after: payout.balance_after,
    paid_by_user_id: payout.paid_by_user_id,
    paid_by: paidBy
      ? { first_name: paidBy.first_name, last_name: paidBy.last_name, number: paidBy.number }
      : null,
    voided_at: payout.voided_at ? payout.voided_at.toISOString() : null,
    voided_by_user_id: payout.voided_by_user_id,
    void_reason: payout.void_reason,
    return_settled_at: payout.return_settled_at ? payout.return_settled_at.toISOString() : null,
    return_settled_by_user_id: payout.return_settled_by_user_id,
    return_note: payout.return_note,
    returned_on_void: payout.returned_on_void,
    created_at: payout.created_at.toISOString(),
  };
}
