export interface Payout {
  id: string;
  code: string;
  shift_id: string;
  collection_point_id: string;
  business_date: string;
  supplier_id: string;
  amount: string;
  paid_by_user_id: string;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  return_settled_at: string | null;
  return_settled_by_user_id: string | null;
  return_note: string | null;
  created_at: string;
}

/**
 * Duplicated from `entities/intake/model/intake.ts` rather than imported —
 * FSD forbids a same-layer cross-import (`entities/payout` -> `entities/intake`).
 * Two small duplicate types are the recorded FSD-correct price; keep them in
 * sync by hand if the shape ever changes.
 */
export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

/** Duplicated from `entities/intake/model/intake.ts` — see `Paginated` above for why. */
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
}
