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
  /** Σ items.net_kg, a decimal string — the row can show kilograms. */
  net_kg: string;
  lines_count: number;
  /** «first last», present even for a deactivated supplier. */
  supplier_name: string;
  /** Σ live payouts handed over with this receipt; '0.00' when none. */
  paid_amount: string;
  /** Present ONLY when the read asked for `expand=items`; `undefined`
   *  otherwise, which is not the same as a receipt with no lines. */
  items?: IntakeItem[];
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
  /** Joined by the server at read time — a rename is retroactive, by design. */
  product_name: string;
  grade_name: string;
  gross_kg: string;
  pallet_kg: string;
  tare_weight_kg: string;
  net_kg: string;
  price: string;
  bonus: string;
  amount: string;
  tare: IntakeItemTare[];
}

/** One payout handed over with a receipt, as listed on its detail view —
 *  voided ones are INCLUDED so the page can show them struck through. Not
 *  exported: only `IntakeDetail.payouts` (below, same file) names it. */
interface IntakePayout {
  id: string;
  code: string;
  amount: string;
  voided_at: string | null;
}

/** `GET /intakes/:id` — the header (`Intake`) plus its lines, ordered like the
 *  paper. `GET /intakes` (the list) never nests items; only the detail read does. */
export interface IntakeDetail extends Intake {
  items: IntakeItem[];
  payouts: IntakePayout[];
  received_by_name: string | null;
}

/** Re-exported so existing `../model/intake` importers keep working — see `@/shared/api/pagination.ts`. */
export type { Paginated } from '@/shared/api';

export interface DocumentFilter {
  shiftId?: string;
  supplierId?: string;
  pointId?: string;
  /** `YYYY-MM-DD` business date bounds — both together are a valid scope on their own. */
  from?: string;
  to?: string;
  includeVoided?: boolean;
  page?: number;
  limit?: number;
  /** Ask the server to nest each row's lines (`expand=items`). Off for every
   *  other caller: the day feed, reception and the dashboard read the same
   *  endpoint and would pay for lines they never render. */
  expandItems?: boolean;
}
