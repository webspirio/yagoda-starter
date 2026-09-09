/**
 * Mirrors the backend `TareTypeResponse`.
 *
 * `weight_kg` AND `deposit_price` ARE STRINGS, and that is not negotiable. They
 * are `numeric` columns carried as strings from database to JSON so no value
 * ever passes through a binary float — this is a cash business whose own rules
 * say a one-kopiyka discrepancy is the same problem as a 350 ₴ one, and these
 * numbers are snapshotted into receipts that are never recalculated. Typing
 * either as `number` would compile, look harmless, and reintroduce float error
 * at the exact point the schema spent its design effort avoiding.
 */
export interface TareType {
  id: string;
  name: string;
  weight_kg: string;
  deposit_price: string;
  is_crate: boolean;
  is_active: boolean;
  created_at: string;
}

/** POST body. Both numbers are required (decimal strings); `is_crate` is
 *  optional (defaults false server-side); there is no `is_active` on create — a
 *  new tare type is active. */
export interface CreateTareTypeInput {
  name: string;
  weight_kg: string;
  deposit_price: string;
  is_crate?: boolean;
}

/** PATCH body. All optional; the two numbers stay decimal strings. */
export interface UpdateTareTypeInput {
  name?: string;
  weight_kg?: string;
  deposit_price?: string;
  is_crate?: boolean;
  is_active?: boolean;
}

/** RHF values for the tare-type dialog. */
export interface TareTypeFormValues {
  name: string;
  weight_kg: string;
  deposit_price: string;
  is_crate: boolean;
  is_active: boolean;
}
