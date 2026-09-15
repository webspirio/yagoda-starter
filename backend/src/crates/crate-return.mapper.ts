import { Shift } from '../shifts/shift.entity';
import { CrateReturn } from './crate-return.entity';
import { CrateAllocationRow } from './crate-allocation';
import { CrateIssuanceMode } from './crate-issuance-mode.enum';

/**
 * The `mode` (and `code`) a caller must supply per issuance, so this mapper
 * can join it onto each allocation row without re-querying `crate_issuances`
 * itself. `CrateBalanceService.tranchesFor`'s rows already carry both fields —
 * the single-document caller (`CratesService.returnCrates`) passes the same
 * tranches it allocated from. A future list endpoint (Task 8) instead loads
 * `{ issuance_id, mode, code }` for a whole page of returns in ONE query keyed
 * by their allocations' issuance ids, and passes that — this mapper does not
 * care which.
 */
export interface CrateReturnIssuanceInfo {
  issuance_id: string;
  mode: CrateIssuanceMode;
  code: string;
}

/**
 * One allocation row, WITH the issuance's mode and code joined on. This is
 * what makes «20 × 120,00 ₴» distinguishable from «25 за розпискою, без
 * грошей» in the response — see this file's function doc.
 */
export interface CrateReturnAllocationView extends CrateAllocationRow {
  mode: CrateIssuanceMode;
  code: string;
}

export interface CrateReturnResponse {
  id: string;
  shift_id: string;
  collection_point_id: string;
  business_date: string;
  supplier_id: string;
  units: number;
  deposit_refund: string;
  allocations: CrateReturnAllocationView[];
  accepted_by_user_id: string;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  created_at: string;
}

/**
 * The allocations travel WITH the document: they are what the operator shows
 * the supplier — «20 × 120,00 ₴», «25 за розпискою, без грошей» — and a total
 * without that split reads as a shortchange (CARRIED FINDING, Task 3 review).
 *
 * `allocate()` stays mode-blind by design (see `crate-allocation.ts`'s doc
 * comment); the join happens HERE, not there, from `issuanceInfo` — a lookup
 * the caller already has (the tranches it allocated from, or a batch load for
 * a list of returns).
 */
export function toCrateReturnResponse(
  ret: CrateReturn,
  shift: Shift,
  allocations: CrateAllocationRow[],
  issuanceInfo: CrateReturnIssuanceInfo[],
): CrateReturnResponse {
  const byIssuance = new Map(issuanceInfo.map((info) => [info.issuance_id, info]));

  return {
    id: ret.id,
    shift_id: ret.shift_id,
    collection_point_id: shift.collection_point_id,
    business_date: shift.business_date,
    supplier_id: ret.supplier_id,
    units: ret.units,
    deposit_refund: ret.deposit_refund,
    allocations: allocations.map((row) => {
      const info = byIssuance.get(row.issuance_id);
      if (!info) {
        // A caller invariant, not a user-facing case: `issuanceInfo` must
        // cover every issuance `allocate()` drew from.
        throw new Error(`toCrateReturnResponse: no issuance info for ${row.issuance_id}`);
      }
      return { ...row, mode: info.mode, code: info.code };
    }),
    accepted_by_user_id: ret.accepted_by_user_id,
    voided_at: ret.voided_at ? ret.voided_at.toISOString() : null,
    voided_by_user_id: ret.voided_by_user_id,
    void_reason: ret.void_reason,
    created_at: ret.created_at.toISOString(),
  };
}
