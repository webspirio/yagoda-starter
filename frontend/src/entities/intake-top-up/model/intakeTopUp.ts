/**
 * Mirrors the backend `IntakeTopUpResponse`
 * (`backend/src/intake-top-ups/intake-top-up.mapper.ts`).
 *
 * A TOP-UP HAS NO CODE, NO BUSINESS DATE AND NO SHIFT. All three come through
 * `intake`, two hops to the supplier — the owner writes one from their desk
 * against a receipt whose shift closed days ago, which is exactly the #61
 * scenario and why a shift of its own would have been wrong. A screen that
 * wants a date or a point for a top-up must take it from the parent, and a
 * screen that wants a code must print the PARENT's.
 *
 * `amount` is a decimal STRING, positive only — a negative row would reduce a
 * debt with no cash leaving the drawer, which §3.2 forbids «для ЖОДНОЇ ролі».
 */
export interface IntakeTopUp {
  id: string;
  amount: string;
  /** REQUIRED and non-blank. #61's second requirement, and the reason the row
   *  is worth anything to whoever reads the history later. */
  reason: string;
  /**
   * FALSE when EITHER this row or its PARENT INTAKE is voided.
   *
   * The asymmetry matters: a top-up the owner voided and a top-up whose parent
   * was voided look identical on a balance and are completely different
   * events. A row whose parent was voided is still LIVE — it simply counts for
   * nothing — and hiding it is precisely the silence this flag exists to
   * prevent. Never filter a list on it; caption the row with it.
   */
  counts_toward_balance: boolean;
  /** The receipt this money is for. `voided_at` here is the PARENT's. */
  intake: { id: string; code: string; voided_at: string | null };
  created_by_user_id: string;
  created_at: string;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
}

/** The filters `GET /intake-top-ups` accepts. `supplierId` and `intakeId` are
 *  applied through a TWO-HOP join, since neither this table nor `intakes` has
 *  a point column. */
export interface TopUpFilter {
  supplierId?: string;
  intakeId?: string;
  pointId?: string;
  page?: number;
  limit?: number;
}
