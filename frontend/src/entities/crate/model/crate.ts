/**
 * The crates wire types, mirroring `backend/src/crates/*.mapper.ts` and
 * `crate-balance.service.ts`.
 *
 * TWO KINDS OF NUMBER LIVE HERE AND MUST NOT BE MIXED. `units` and
 * `outstanding_units` are row COUNTS — plain integers. Everything named
 * `deposit_*` or `per_unit` is `numeric` carried as a STRING, so no money
 * value passes through a binary float. Adding one to the other is always a
 * bug, and the types are what makes it a compile error.
 */

/**
 * How the crates were taken.
 *
 * §6.4 — «різниця лише в грошах»: both put crates on the person's balance
 * identically. `deposit` means money changed hands; `receipt` means a paper
 * розписка was signed and there is **no cash cover at all**, which is why a
 * receipt issuance stores `deposit_per_unit: '0.00'`.
 */
export type CrateIssuanceMode = 'deposit' | 'receipt';

export interface CrateIssuance {
  id: string;
  code: string;
  shift_id: string;
  collection_point_id: string;
  business_date: string;
  supplier_id: string;
  units: number;
  mode: CrateIssuanceMode;
  deposit_per_unit: string;
  deposit_taken: string;
  issued_by_user_id: string;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  created_at: string;
}

/**
 * One tranche a return consumed, with the issuance's `mode` and `code` joined
 * on — that is what makes «20 × 120,00 ₴» distinguishable from «25 за
 * розпискою, без грошей» when a single return spans both.
 */
export interface CrateAllocation {
  issuance_id: string;
  units: number;
  per_unit: string;
  amount: string;
  mode: CrateIssuanceMode;
  code: string;
}

export interface CrateReturn {
  id: string;
  shift_id: string;
  collection_point_id: string;
  business_date: string;
  supplier_id: string;
  units: number;
  deposit_refund: string;
  allocations: CrateAllocation[];
  accepted_by_user_id: string;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  created_at: string;
}

/**
 * `POST /crate-returns/preview` — the split the SERVER would make, before
 * anything is written.
 *
 * `shortfall` is how many of the requested units had no open tranche to come
 * from: the person is handing back more than they took. It is reported, never
 * silently clamped, because a screen that quietly accepted 25 crates from
 * someone who took 20 would be hiding a counting mistake.
 */
export interface CrateReturnPreview {
  allocations: CrateAllocation[];
  deposit_refund: string;
  shortfall: number;
}

/** One open tranche of one person's balance, oldest first. */
export interface CrateTranche {
  issuance_id: string;
  code: string;
  remaining_units: number;
  per_unit: string;
  mode: CrateIssuanceMode;
  issued_at: string;
}

/** `GET /suppliers/:id/crate-balance` — one person. */
export interface CrateBalance {
  supplier_id: string;
  outstanding_units: number;
  deposit_held: string;
  tranches: CrateTranche[];
}

/**
 * `GET /crate-balances` — one row per person still holding crates at a point.
 *
 * READ `has_receipt` BEFORE `deposit_held`. A holder of розписка tranches only
 * reads `'0.00'`, and so does someone whose deposit came back in full; the
 * screen shows «—» for the first and a plain zero for the second, and
 * `deposit_held` alone cannot tell them apart.
 */
export interface CrateBalanceRow {
  supplier_id: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  collection_point_id: string;
  outstanding_units: number;
  deposit_held: string;
  has_receipt: boolean;
}

/** Filters `GET /crate-issuances` and `GET /crate-returns` accept. */
export interface CrateDocumentFilter {
  pointId?: string;
  supplierId?: string;
  mode?: CrateIssuanceMode;
  includeVoided?: boolean;
  page?: number;
  limit?: number;
}
