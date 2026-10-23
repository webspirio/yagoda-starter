import { ReweighItem } from './reweigh-item.entity';
import { cmp, div, mul, sum } from '../common/money';

export interface ReweighItemTareResponse {
  tare_type_id: string;
  tare_type_name?: string;
  units: number;
  /**
   * Per-unit kilograms that reproduce the line's SNAPSHOTTED `tare_weight_kg`,
   * so a screen can print «48 × 1,20» and a calculator gets the stored tare
   * back. `null` when that cannot be proven — the catalogue weight moved since
   * the weighing and the line mixes types — and the screen then prints the
   * stored total instead. Never a guess.
   */
  unit_weight_kg: string | null;
}

export interface ReweighItemResponse {
  id: string;
  reweigh_id: string;
  item_order: number;
  product_grade_id: string;
  product_grade_name?: string;
  product_id?: string;
  product_name?: string;
  gross_kg: string;
  pallet_kg: string;
  tare_weight_kg: string;
  net_kg: string;
  tare: ReweighItemTareResponse[];
  weighed_by_user_id: string;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  created_at: string;
}

export function toReweighItemResponse(item: ReweighItem): ReweighItemResponse {
  const weights = unitWeights(item);
  return {
    id: item.id,
    reweigh_id: item.reweigh_id,
    item_order: item.item_order,
    product_grade_id: item.product_grade_id,
    product_grade_name: item.product_grade?.name,
    product_id: item.product_grade?.product_id,
    product_name: item.product_grade?.product?.name,
    gross_kg: item.gross_kg,
    pallet_kg: item.pallet_kg,
    tare_weight_kg: item.tare_weight_kg,
    net_kg: item.net_kg,
    tare: (item.tare ?? []).map((t, i) => ({
      tare_type_id: t.tare_type_id,
      tare_type_name: t.tare_type?.name,
      units: t.units,
      unit_weight_kg: weights[i],
    })),
    weighed_by_user_id: item.weighed_by_user_id,
    voided_at: item.voided_at ? item.voided_at.toISOString() : null,
    voided_by_user_id: item.voided_by_user_id,
    void_reason: item.void_reason,
    created_at: item.created_at.toISOString(),
  };
}

/**
 * The per-unit weights behind a line's snapshotted `tare_weight_kg`.
 *
 * The line stores only the TOTAL (`reweigh_item_tare_types` has no weight
 * column). The catalogue's current weight is used when Σ units × weight still
 * equals that total — then it IS the snapshot; otherwise, for a single type,
 * the exact quotient total ÷ units when it divides back without a remainder.
 * Anything else is `null`: a formula that does not add up is worse than none.
 */
function unitWeights(item: ReweighItem): (string | null)[] {
  const tare = item.tare ?? [];
  if (tare.length === 0) return [];
  const catalogue = tare.map((t) => t.tare_type?.weight_kg ?? null);
  if (
    catalogue.every((w): w is string => w !== null) &&
    cmp(sum(tare.map((t, i) => mul(catalogue[i] as string, String(t.units)))), item.tare_weight_kg) === 0
  ) {
    return catalogue;
  }
  if (tare.length === 1 && tare[0].units > 0) {
    const units = String(tare[0].units);
    const each = div(item.tare_weight_kg, units);
    if (cmp(mul(each, units), item.tare_weight_kg) === 0) return [each];
  }
  return tare.map(() => null);
}
