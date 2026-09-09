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

/**
 * POST body. `collection_point_id` is sent ONLY by a network owner (they have
 * no point of their own and must name one); a point operator OMITS it and the
 * server derives the point from their token. `phone`/`note` carry `null` to
 * mean "none".
 */
export interface CreateSupplierInput {
  collection_point_id?: string;
  first_name: string;
  last_name: string;
  phone?: string | null;
  note?: string | null;
  kind?: SupplierKind;
}

/**
 * PATCH body. All optional and NO `collection_point_id` — a supplier cannot be
 * re-pointed (that would move a money balance between points; §3.9). Send
 * `first_name`/`last_name`/`kind`/`is_active` ONLY when changed and NEVER as
 * `null` (they back NOT NULL columns); `phone`/`note` may be `null` to clear.
 */
export interface UpdateSupplierInput {
  id: string;
  first_name?: string;
  last_name?: string;
  phone?: string | null;
  note?: string | null;
  kind?: SupplierKind;
  is_active?: boolean;
}

/**
 * Form values — all strings/booleans for the controls. `phone` is '' when
 * blank; `hasNoPhone` toggles the "no number" case (disables + clears phone,
 * submits `null`); `collection_point_id` is '' when unset (owner-only);
 * `kind` defaults to `none`.
 */
export interface SupplierFormValues {
  first_name: string;
  last_name: string;
  phone: string;
  hasNoPhone: boolean;
  kind: SupplierKind;
  note: string;
  collection_point_id: string;
  is_active: boolean;
}
