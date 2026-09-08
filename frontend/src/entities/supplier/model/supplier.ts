/**
 * §2.11 — a REPORTING marker on the person, nothing more. `wholesale` never
 * changes a price; it is a label the owner reads. Values match the backend
 * `supplier_kind` Postgres enum exactly.
 */
export type SupplierKind = 'none' | 'wholesale' | 'farmer';

/** Shared list envelope returned by the paginated GET endpoints. */
export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Mirrors the backend `SupplierResponse`. `collection_point_id` is always a
 * concrete point (a supplier is nailed to one point — §3.9); `phone` and
 * `note` are the only nullable fields ("no phone" is meaningful, not absent).
 * Suppliers are never deleted — deactivate via `is_active`.
 */
export interface Supplier {
  id: string;
  collection_point_id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  note: string | null;
  kind: SupplierKind;
  is_active: boolean;
  created_at: string;
}

/** One row of `GET /supplier-balances` — the debts list of a point. */
export interface SupplierBalanceRow {
  supplier_id: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  collection_point_id: string;
  debt: string;
}

export const supplierName = (s: { first_name: string; last_name: string }) =>
  `${s.first_name} ${s.last_name}`;
