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
