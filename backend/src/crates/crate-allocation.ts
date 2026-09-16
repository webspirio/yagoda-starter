import { mul, sum } from '../common/money';
import { CrateIssuanceMode } from './crate-issuance-mode.enum';

/**
 * THE WHOLE COMPUTATION OF THIS SLICE, PURE. No Nest, no database, no clock —
 * the same shape as `intakes/intake-lines.ts`, and for the same reason: the
 * rules worth testing exhaustively are here, and testing them must not require
 * a transaction.
 *
 * §6.5 — «гаситься найстаріша видача першою, і per_unit береться З ТІЄЇ
 * видачі, а не з довідника». The caller supplies tranches ALREADY ORDERED
 * oldest-first; ordering is a database concern (`created_at`, then `id`).
 *
 * THERE IS NO BRANCH ON `mode`, AND THAT IS THE DESIGN. §6.6 as amended (spec
 * §4.1) says the queue is single and the money still does not mix — which is
 * true by construction, because a receipt issuance has `deposit_per_unit = 0`
 * by CHECK, so a row consuming one carries `per_unit = 0` and `amount = 0`.
 * `mode` is carried through for DISPLAY only: the screen must be able to say
 * «5 — за розпискою, без грошей» rather than show a silent zero.
 *
 * A SHORTFALL IS RETURNED, NOT THROWN. §6.5 calls over-return «помилка вводу, а
 * не подія», and the caller owns the wording of that 400; a pure function that
 * threw an HTTP exception would be neither pure nor reusable by the preview.
 */
export interface CrateTranche {
  issuance_id: string;
  remaining_units: number;
  per_unit: string;
  mode: CrateIssuanceMode;
}

export interface CrateAllocationRow {
  issuance_id: string;
  units: number;
  per_unit: string;
  amount: string;
}

export interface CrateAllocationResult {
  allocations: CrateAllocationRow[];
  deposit_refund: string;
  /** Units the tranches could not cover. `0` means the request was satisfied. */
  shortfall: number;
}

export function allocate(
  tranches: CrateTranche[],
  requestedUnits: number,
): CrateAllocationResult {
  const allocations: CrateAllocationRow[] = [];
  let left = requestedUnits;

  for (const tranche of tranches) {
    if (left <= 0) break;
    if (tranche.remaining_units <= 0) continue;

    const units = Math.min(tranche.remaining_units, left);
    allocations.push({
      issuance_id: tranche.issuance_id,
      units,
      per_unit: tranche.per_unit,
      // Rounded HERE, per row, before anything is summed.
      amount: mul(tranche.per_unit, String(units)),
    });
    left -= units;
  }

  return {
    allocations,
    deposit_refund: sum(allocations.map((row) => row.amount)),
    shortfall: left,
  };
}
