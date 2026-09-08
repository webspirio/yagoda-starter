/** Mirrors the backend's `IntakeResponse` (header only — `GET /intakes` never nests items). */
export interface Intake {
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

/** One tare line on a receipt item — a tare type and how many units of it. */
export interface IntakeItemTare {
  tare_type_id: string;
  units: number;
}

/**
 * One line of a receipt. Mirrors the backend's `IntakeItemResponse`
 * (`intakes/intake.mapper.ts`). Every weight and money field is a STRING —
 * `numeric` carried end to end so no value passes through a binary float,
 * same discipline as `Intake.amount`. `tare` lists the tare types applied to
 * this line (§2.5's automatic weight subtraction), never empty on a real
 * item but not guaranteed non-empty by the type.
 */
export interface IntakeItem {
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
  tare: IntakeItemTare[];
}

/** `GET /intakes/:id` — the header (`Intake`) plus its lines, ordered like the
 *  paper. `GET /intakes` (the list) never nests items; only the detail read does. */
export interface IntakeDetail extends Intake {
  items: IntakeItem[];
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface DocumentFilter {
  shiftId?: string;
  supplierId?: string;
  pointId?: string;
  includeVoided?: boolean;
  limit?: number;
}
