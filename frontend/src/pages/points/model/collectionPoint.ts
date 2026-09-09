export type PointKind = 'reception' | 'base';

/** Shared list envelope returned by the paginated GET endpoints. */
export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Mirrors the backend `CollectionPointResponse`. `target_cash` is a decimal
 * STRING (numeric(12,2) carried as string); `target_crates` is a number. Both
 * `null` mean "not set" — render "—", never `0`.
 */
export interface CollectionPoint {
  id: string;
  name: string;
  kind: PointKind;
  target_cash: string | null;
  target_crates: number | null;
  is_active: boolean;
  created_at: string;
}

/** POST body. `name` required; omit a target (undefined) to leave it unset. */
export interface CreateCollectionPointInput {
  name: string;
  kind?: PointKind;
  target_cash?: string | null;
  target_crates?: number | null;
}

/**
 * PATCH body. All optional. Never send `name`/`kind`/`is_active` as `null`
 * (400 — NOT NULL columns); send a target as `null` to clear it. `reason`
 * becomes the audit-log note for the change.
 */
export interface UpdateCollectionPointInput {
  name?: string;
  kind?: PointKind;
  target_cash?: string | null;
  target_crates?: number | null;
  is_active?: boolean;
  reason?: string;
}

/** Form values — strings for text inputs; '' means "not set" → null on submit. */
export interface CollectionPointFormValues {
  name: string;
  kind: PointKind;
  target_cash: string;
  target_crates: string;
  is_active: boolean;
}
