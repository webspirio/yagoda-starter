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
  /** D-8 — `displayNameOf` on `opened_by_user_id`, via `loadDisplayNames`.
   *  `null` only if the caller's map has no entry for that id — see that
   *  helper's own doc comment for when that can happen. */
  opened_by_name: string | null;
  closed_by_user_id: string | null;
  /** Same derivation as `opened_by_name`, and `null` whenever
   *  `closed_by_user_id` is — an open shift has no closer to name. */
  closed_by_name: string | null;
  closed_at: string | null;
  created_at: string;
  /** §7.7's surviving half — see `SetExplanationDto`. `null` until the owner
   *  writes one; writing it never moves a number. */
  explanation: string | null;
  /** §6.8's «бій» (#110). `null` means «не записано» — an open shift, or one
   *  closed before the column existed. `0` means nothing broke. */
  broken_crates: number | null;
}

/**
 * `names` is loaded by the caller, ONCE per page — see `loadDisplayNames`.
 * This function does no I/O of its own; it only reads the map.
 */
export function toShiftResponse(shift: Shift, names: ReadonlyMap<string, string>): ShiftResponse {
  return {
    id: shift.id,
    collection_point_id: shift.collection_point_id,
    business_date: shift.business_date,
    status: shift.status,
    opened_by_user_id: shift.opened_by_user_id,
    opened_by_name: names.get(shift.opened_by_user_id) ?? null,
    closed_by_user_id: shift.closed_by_user_id,
    closed_by_name: shift.closed_by_user_id
      ? (names.get(shift.closed_by_user_id) ?? null)
      : null,
    closed_at: shift.closed_at ? shift.closed_at.toISOString() : null,
    created_at: shift.created_at.toISOString(),
    explanation: shift.explanation,
    broken_crates: shift.broken_crates,
  };
}
