import { Shift } from '../shifts/shift.entity';
import { CrateIssuance } from './crate-issuance.entity';
import { CrateIssuanceMode } from './crate-issuance-mode.enum';

/** `collection_point_id` and `business_date` are joined in from the shift and
 *  stored nowhere — see `CrateIssuance`'s header. */
export interface CrateIssuanceResponse {
  id: string;
  code: string;
  shift_id: string;
  collection_point_id: string;
  business_date: string;
  supplier_id: string;
  units: number;
  mode: CrateIssuanceMode;
  deposit_per_unit: string;
  deposit_taken: string;
  issued_by_user_id: string;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  /** The shift is closed — voiding is then the owner's alone (§9.4 as amended). */
  shift_closed: boolean;
  /** A live return is allocated against this issuance — `voidIssuance` refuses it (§9.3). */
  has_live_returns: boolean;
  created_at: string;
}

export function toCrateIssuanceResponse(
  issuance: CrateIssuance,
  shift: Shift,
  hasLiveReturns: boolean,
): CrateIssuanceResponse {
  return {
    id: issuance.id,
    code: issuance.code,
    shift_id: issuance.shift_id,
    collection_point_id: shift.collection_point_id,
    business_date: shift.business_date,
    supplier_id: issuance.supplier_id,
    units: issuance.units,
    mode: issuance.mode,
    deposit_per_unit: issuance.deposit_per_unit,
    deposit_taken: issuance.deposit_taken,
    issued_by_user_id: issuance.issued_by_user_id,
    voided_at: issuance.voided_at ? issuance.voided_at.toISOString() : null,
    voided_by_user_id: issuance.voided_by_user_id,
    void_reason: issuance.void_reason,
    shift_closed: shift.closed_at !== null,
    has_live_returns: hasLiveReturns,
    created_at: issuance.created_at.toISOString(),
  };
}
