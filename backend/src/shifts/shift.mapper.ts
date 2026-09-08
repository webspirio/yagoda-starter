import { Shift } from './shift.entity';
import { ShiftStatus } from './shift-status.enum';

/** `created_at` is the OPEN instant (there is no `opened_at`), and there is no
 *  `updated_at` — matching every other mapper in this codebase. "When did this
 *  change" is the audit log's question. */
export interface ShiftResponse {
  id: string;
  collection_point_id: string;
  /** 'YYYY-MM-DD'. A `date` column, carried as a string end to end. */
  business_date: string;
  status: ShiftStatus;
  opened_by_user_id: string;
  closed_by_user_id: string | null;
  closed_at: string | null;
  created_at: string;
}

export function toShiftResponse(shift: Shift): ShiftResponse {
  return {
    id: shift.id,
    collection_point_id: shift.collection_point_id,
    business_date: shift.business_date,
    status: shift.status,
    opened_by_user_id: shift.opened_by_user_id,
    closed_by_user_id: shift.closed_by_user_id,
    closed_at: shift.closed_at ? shift.closed_at.toISOString() : null,
    created_at: shift.created_at.toISOString(),
  };
}
