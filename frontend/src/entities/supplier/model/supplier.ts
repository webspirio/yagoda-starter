/**
 * §2.11 — a REPORTING marker on the person, nothing more. `wholesale` never
 * changes a price; it is a label the owner reads. Values match the backend
 * `supplier_kind` Postgres enum exactly.
 */
export type SupplierKind = 'none' | 'wholesale' | 'farmer';

/** Re-exported so existing `../model/supplier` importers keep working — see `@/shared/api/pagination.ts`. */
export type { Paginated } from '@/shared/api';

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

/**
 * Mirrors the backend `SupplierBalanceResponse` (`GET /suppliers/:id/balance`,
 * `supplier-balance/supplier-balance.mapper.ts`) — §3.1's «Разом», now WITH
 * what it is made of (#103): the three terms of `debt`, plus the season
 * counters the card's tiles read instead of summing a page that truncates
 * past 100 documents. Every money and weight field is a decimal STRING;
 * `debt` is legitimately negative after a voided receipt that had already
 * been paid for. Only THIS single-supplier read widened — `SupplierBalanceRow`
 * above (`GET /supplier-balances`, the list) did not.
 */
export interface SupplierBalanceOne {
  supplier_id: string;
  debt: string;
  intakes_total: string;
  top_ups_total: string;
  payouts_total: string;
  intakes_count: number;
  kg_total: string;
  /** Business date of the most recent LIVE receipt; `null` when there is none. */
  last_intake_date: string | null;
}

export const supplierName = (s: { first_name: string; last_name: string }) =>
  `${s.first_name} ${s.last_name}`;
