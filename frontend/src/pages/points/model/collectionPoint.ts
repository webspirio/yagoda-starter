export type PointKind = 'reception' | 'base';

/** Re-exported so existing `../model/collectionPoint` importers keep working — see `@/shared/api/pagination.ts`. */
export type { Paginated } from '@/shared/api';

/**
 * Mirrors the backend `CollectionPointResponse`. `target_cash` is a decimal
 * STRING (numeric(12,2) carried as string); `target_crates` is a number. Both
 * `null` mean "not set" — render "—", never `0`.
 */
export interface CollectionPoint {
  id: string;
  name: string;
  /** 2–8 A–Z/0–9 — the first segment of every receipt code written at this point (§6.2). */
  code: string;
  kind: PointKind;
  target_cash: string | null;
  target_crates: number | null;
  is_active: boolean;
  created_at: string;
}

/** POST body. `name` required; omit a target (undefined) to leave it unset. */
export interface CreateCollectionPointInput {
  name: string;
  code: string;
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
  code?: string;
  kind?: PointKind;
  target_cash?: string | null;
  target_crates?: number | null;
  is_active?: boolean;
  reason?: string;
}

/** Form values — strings for text inputs; '' means "not set" → null on submit. */
export interface CollectionPointFormValues {
  name: string;
  code: string;
  kind: PointKind;
  target_cash: string;
  target_crates: string;
  is_active: boolean;
}
