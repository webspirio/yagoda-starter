import { ReweighItem } from './reweigh-item.entity';

export interface ReweighItemTareResponse {
  tare_type_id: string;
  tare_type_name?: string;
  units: number;
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
    tare: (item.tare ?? []).map((t) => ({
      tare_type_id: t.tare_type_id,
      tare_type_name: t.tare_type?.name,
      units: t.units,
    })),
    weighed_by_user_id: item.weighed_by_user_id,
    voided_at: item.voided_at ? item.voided_at.toISOString() : null,
    voided_by_user_id: item.voided_by_user_id,
    void_reason: item.void_reason,
    created_at: item.created_at.toISOString(),
  };
}
