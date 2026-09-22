/** One tare line on a reweigh line — a tare type and how many units of it. */
interface ReweighItemTare {
  tare_type_id: string;
  tare_type_name?: string;
  units: number;
}

/**
 * One line of a reweigh — mirrors the backend's `ReweighItemResponse`. Every
 * weight field is a STRING — `numeric` carried end to end so no value passes
 * through a binary float, same discipline as `entities/intake`'s items.
 * `products`/`grades` on `Reweigh` are what a screen sums against; this is
 * the individual weighing that produced them, kept (or, with
 * `includeVoided`, kept AND its voided siblings) for the audit trail.
 */
export interface ReweighItem {
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
  tare: ReweighItemTare[];
  weighed_by_user_id: string;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  created_at: string;
}

/**
 * §8.2's звірка for one PRODUCT — the intake's kilograms next to the
 * reweigh's. `state`/`missing_kg`/`missing_amount` are the base's verdict on
 * that product, computed server-side; a product the shift never reweighed
 * still appears here (`state: 'not_reweighed'`), never dropped.
 */
export interface ReconciliationProduct {
  product_id: string;
  product_name: string;
  intake_net_kg: string;
  reweigh_net_kg: string;
  state: 'weighed' | 'not_reweighed';
  missing_kg: string | null;
  missing_amount: string | null;
}

/**
 * The same звірка one level down, per GRADE rather than per product —
 * `reweigh_net_kg` is `'0.00'` (never `null`) when nothing was weighed for
 * that grade, so a table can render it without a null check.
 */
export interface ReconciliationGrade {
  product_grade_id: string;
  product_grade_name: string;
  product_id: string;
  product_name: string;
  intake_net_kg: string;
  reweigh_net_kg: string;
}

/** `GET /shifts/:shiftId/reweigh` — one shift's reconciliation: its reweigh
 *  lines plus the product- and grade-level summaries derived from them. */
export interface Reweigh {
  shift_id: string;
  closed_at: string | null;
  accepted_anything: boolean;
  items: ReweighItem[];
  products: ReconciliationProduct[];
  grades: ReconciliationGrade[];
}
