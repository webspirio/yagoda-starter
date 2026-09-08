import { Intake } from './intake.entity';
import { IntakeItem } from './intake-item.entity';
import { Shift } from '../shifts/shift.entity';

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

export interface IntakeDetailResponse extends IntakeResponse {
  items: IntakeItemResponse[];
}

export function toIntakeResponse(intake: Intake, shift: Shift): IntakeResponse {
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
): IntakeDetailResponse {
  return {
    ...toIntakeResponse(intake, shift),
    // Ordered by `item_order` so the response reads like the paper, whatever
    // order the database returned the rows in.
    items: [...items].sort((a, b) => a.item_order - b.item_order).map(toIntakeItemResponse),
  };
}
