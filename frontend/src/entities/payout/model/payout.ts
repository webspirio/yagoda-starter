export interface Payout {
  id: string;
  code: string;
  shift_id: string;
  collection_point_id: string;
  business_date: string;
  supplier_id: string;
  amount: string;
  paid_by_user_id: string;
  /** The receipt this payout was handed over with, if any — §-linked at the DB, not always present. */
  intake_id: string | null;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  return_settled_at: string | null;
  return_settled_by_user_id: string | null;
  return_note: string | null;
  created_at: string;
}

/** Re-exported so existing `../model/payout` importers keep working — see `@/shared/api/pagination.ts`. */
export type { Paginated } from '@/shared/api';

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
