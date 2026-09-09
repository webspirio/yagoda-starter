import { Payout } from './payout.entity';
import { Shift } from '../shifts/shift.entity';

/** `collection_point_id` and `business_date` are joined in from the shift and
 *  stored nowhere — see `Payout`'s header. */
export interface PayoutResponse {
  id: string;
  code: string;
  shift_id: string;
  collection_point_id: string;
  business_date: string;
  supplier_id: string;
  amount: string;
  paid_by_user_id: string;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  return_settled_at: string | null;
  return_settled_by_user_id: string | null;
  return_note: string | null;
  created_at: string;
}

export function toPayoutResponse(payout: Payout, shift: Shift): PayoutResponse {
  return {
    id: payout.id,
    code: payout.code,
    shift_id: payout.shift_id,
    collection_point_id: shift.collection_point_id,
    business_date: shift.business_date,
    supplier_id: payout.supplier_id,
    amount: payout.amount,
    paid_by_user_id: payout.paid_by_user_id,
    voided_at: payout.voided_at ? payout.voided_at.toISOString() : null,
    voided_by_user_id: payout.voided_by_user_id,
    void_reason: payout.void_reason,
    return_settled_at: payout.return_settled_at ? payout.return_settled_at.toISOString() : null,
    return_settled_by_user_id: payout.return_settled_by_user_id,
    return_note: payout.return_note,
    created_at: payout.created_at.toISOString(),
  };
}
