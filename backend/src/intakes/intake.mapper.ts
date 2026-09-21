import { Intake } from './intake.entity';
import { IntakeItem } from './intake-item.entity';
import type { BuiltIntake } from './intake-lines';
import type { IntakeRowExtras } from './intake-row-extras';
import { Shift } from '../shifts/shift.entity';
import type { Payout } from '../payouts/payout.entity';

/**
 * `collection_point_id` and `business_date` are JOINED IN from the shift and
 * stored nowhere — see `Intake`'s header. This is not a second copy of a fact:
 * nothing persists them, the mapper composes them, and without them every
 * client would have to fetch the shift to render a list row.
 */
export interface IntakeResponse {
  id: string;
  code: string;
  shift_id: string;
  collection_point_id: string;
  business_date: string;
  supplier_id: string;
  amount: string;
  received_by_user_id: string;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  created_at: string;
  /** Σ items.net_kg — kilograms on the list row (programme §6). */
  net_kg: string;
  lines_count: number;
  /** «first last», trimmed; present even for a deactivated supplier. */
  supplier_name: string;
  /** Σ live payouts handed over with this receipt (`payouts.intake_id`); '0.00' when none. */
  paid_amount: string;
}

export interface IntakeItemTareResponse {
  tare_type_id: string;
  units: number;
}

export interface IntakeItemResponse {
  id: string;
  item_order: number;
  product_grade_id: string;
  gross_kg: string;
  pallet_kg: string;
  tare_weight_kg: string;
  net_kg: string;
  price: string;
  bonus: string;
  amount: string;
  tare: IntakeItemTareResponse[];
}

export interface IntakePayoutResponse {
  id: string;
  code: string;
  amount: string;
  voided_at: string | null;
}

export function toIntakePayoutResponse(payout: Payout): IntakePayoutResponse {
  return {
    id: payout.id,
    code: payout.code,
    amount: payout.amount,
    voided_at: payout.voided_at ? payout.voided_at.toISOString() : null,
  };
}

export interface IntakeDetailResponse extends IntakeResponse {
  items: IntakeItemResponse[];
  /** Payouts handed over WITH this receipt (§2.1 ⑥) — `intake_id` = this id,
   *  voided ones included so the receipt can say a payout was cancelled. */
  payouts: IntakePayoutResponse[];
  /** «Приймав» on the printed receipt. `null` only if the user row is gone. */
  received_by_name: string | null;
}

export function toIntakeResponse(
  intake: Intake,
  shift: Shift,
  extras: IntakeRowExtras,
): IntakeResponse {
  return {
    id: intake.id,
    code: intake.code,
    shift_id: intake.shift_id,
    collection_point_id: shift.collection_point_id,
    business_date: shift.business_date,
    supplier_id: intake.supplier_id,
    amount: intake.amount,
    received_by_user_id: intake.received_by_user_id,
    voided_at: intake.voided_at ? intake.voided_at.toISOString() : null,
    voided_by_user_id: intake.voided_by_user_id,
    void_reason: intake.void_reason,
    created_at: intake.created_at.toISOString(),
    net_kg: extras.net_kg,
    lines_count: extras.lines_count,
    supplier_name: extras.supplier_name,
    paid_amount: extras.paid_amount,
  };
}

export function toIntakeItemResponse(item: IntakeItem): IntakeItemResponse {
  return {
    id: item.id,
    item_order: item.item_order,
    product_grade_id: item.product_grade_id,
    gross_kg: item.gross_kg,
    pallet_kg: item.pallet_kg,
    tare_weight_kg: item.tare_weight_kg,
    net_kg: item.net_kg,
    price: item.price,
    bonus: item.bonus,
    amount: item.amount,
    tare: (item.tare ?? []).map((t) => ({ tare_type_id: t.tare_type_id, units: t.units })),
  };
}

export function toIntakeDetailResponse(
  intake: Intake,
  shift: Shift,
  items: IntakeItem[],
  extras: IntakeRowExtras,
  payouts: Payout[],
  receivedByName: string | null,
): IntakeDetailResponse {
  return {
    ...toIntakeResponse(intake, shift, extras),
    // Ordered by `item_order` so the response reads like the paper, whatever
    // order the database returned the rows in.
    items: [...items].sort((a, b) => a.item_order - b.item_order).map(toIntakeItemResponse),
    payouts: [...payouts]
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
      .map(toIntakePayoutResponse),
    received_by_name: receivedByName,
  };
}

/** An item as `POST /intakes/preview` returns it: `IntakeItemResponse` minus
 *  `id`, because nothing was written and there is no row to name. */
export type PreviewIntakeItemResponse = Omit<IntakeItemResponse, 'id'>;

/**
 * `POST /intakes/preview`'s answer — the COMPUTED part of `IntakeDetailResponse`
 * and nothing that exists only once a row does: no `id`, no `code`, no
 * `shift_id`, no `received_by_user_id`, no void trio, no `created_at`.
 * `collection_point_id`, `supplier_id` and `business_date` are echoed back
 * because the screen renders them beside the numbers, and the point and the
 * date were resolved server-side rather than typed.
 */
export interface PreviewIntakeResponse {
  collection_point_id: string;
  supplier_id: string;
  business_date: string;
  amount: string;
  items: PreviewIntakeItemResponse[];
}

export function toPreviewIntakeResponse(
  target: { collection_point_id: string; supplier_id: string; business_date: string },
  built: BuiltIntake,
): PreviewIntakeResponse {
  return {
    collection_point_id: target.collection_point_id,
    supplier_id: target.supplier_id,
    business_date: target.business_date,
    amount: built.amount,
    // Field by field rather than spreading the `BuiltLine`: the wire shape is
    // THIS list, and a field added to the pure module later must not reach the
    // client unreviewed.
    items: built.items.map((line) => ({
      item_order: line.item_order,
      product_grade_id: line.product_grade_id,
      gross_kg: line.gross_kg,
      pallet_kg: line.pallet_kg,
      tare_weight_kg: line.tare_weight_kg,
      net_kg: line.net_kg,
      price: line.price,
      bonus: line.bonus,
      amount: line.amount,
      tare: line.tare.map((t) => ({ tare_type_id: t.tare_type_id, units: t.units })),
    })),
  };
}
